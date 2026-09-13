import { withAgentDatabase } from "../memory/database.js";
import { getTaskPlan } from "../memory/task-repository.js";

export interface ReflectionReport {
  problem: string;
  cause: string;
  solution: string;
  confidence: number;
  futureRecommendation: string;
  /** Summary of what was accomplished (populated for successful tasks) */
  summary?: {
    actions: string[];
    toolsUsed: string[];
    artifacts?: string[];
  };
  /** For recovered tasks: the actual corrective mutation that fixed the failure */
  correctiveAction?: {
    tool: string;
    path?: string;
    summary: string;
  };
}

function executionError(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  try {
    const parsed = JSON.parse(result) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export function analyzeTaskHistory(taskId: string): ReflectionReport {
  // Check if the task itself is cancelled — produce a specific reflection for that
  const plan = getTaskPlan(taskId);
  if (plan?.state === "cancelled") {
    const completedSteps = plan.steps.filter((s) => s.status === "completed").length;
    const blockedSteps = plan.steps.filter((s) => s.status === "blocked").length;
    const pendingApprovalSteps = plan.steps.filter((s) => s.status === "pending_approval").length;
    return {
      problem: "Task was cancelled",
      cause: `Explicit cancellation. Completed: ${completedSteps}, Blocked: ${blockedSteps}, Pending approval: ${pendingApprovalSteps}`,
      solution: "Task was intentionally cancelled. No corrective action needed unless the cancellation was in error.",
      confidence: 1.0,
      futureRecommendation: "Review the cancellation reason in task memory. If the task should have been allowed to run, recreate it with the corrected plan.",
      summary: {
        actions: [`Cancelled with ${completedSteps} completed and ${plan.steps.length - completedSteps} remaining`],
        toolsUsed: [],
      },
    };
  }

  return withAgentDatabase((db) => {
    const rows = db.prepare("SELECT action, result, status FROM executions WHERE task_id = ? ORDER BY id")
      .all(taskId) as Array<{ action: string; result: string | null; status: string }>;
    const failures = rows.filter((row) => row.status === "failed" || row.status === "outcome_unknown");
    const blocked = rows.filter((row) => row.status === "blocked");
    const successes = rows.filter((row) => row.status === "completed");
    const latestIssue = failures.at(-1) ?? blocked.at(-1);
    const isBlocked = latestIssue?.status === "blocked";    const recovered = latestIssue ? rows.slice(rows.indexOf(latestIssue) + 1).some((row) => row.status === "completed") : false;
    const hasIssue = failures.length > 0 || blocked.length > 0;

    // For recovered tasks, find the actual corrective action (mutation after failure)
    let correctiveAction: { tool: string; path?: string; summary: string } | undefined;
    if (latestIssue && recovered) {
      const issueIdx = rows.indexOf(latestIssue);
      const postFailure = rows.slice(issueIdx + 1);
      // Look for file mutations (the actual fix) after the failure
      const mutations = postFailure.filter((r) => ["modify_file", "write_file", "create_file"].includes(r.action) && r.status === "completed");
      if (mutations.length > 0) {
        const fix = mutations[0];
        let path = "";
        try {
          const r = JSON.parse(fix.result ?? "{}") as Record<string, unknown>;
          path = String(r.path ?? "");
        } catch { /* ignore */ }
        correctiveAction = { tool: fix.action, path: path || undefined, summary: `${fix.action}${path ? ` on ${path}` : ""}` };
      } else {
        // No explicit mutation found — the last successful action after failure
        const lastSuccess = postFailure.filter((r) => r.status === "completed").at(-1);
        if (lastSuccess) {
          correctiveAction = { tool: lastSuccess.action, summary: lastSuccess.action };
        }
      }
    }

    // Build success summary for clean tasks
    let summary: ReflectionReport["summary"] | undefined;
    if (!hasIssue && successes.length > 0) {
      const toolsUsed = [...new Set(successes.map((s) => s.action))];
      const fileActions = successes.filter((s) => ["create_file", "write_file", "modify_file", "delete_file", "restore_file"].includes(s.action));
      const gitActions = successes.filter((s) => s.action.startsWith("git_"));
      const commandActions = successes.filter((s) => s.action === "execute_command");
      const actions: string[] = [];
      if (fileActions.length > 0) actions.push(`Modified ${fileActions.length} file(s)`);
      if (gitActions.length > 0) actions.push(`Performed ${gitActions.length} git operation(s)`);
      if (commandActions.length > 0) actions.push(`Ran ${commandActions.length} command(s)`);
      if (actions.length === 0) actions.push(`Completed ${successes.length} action(s)`);

      // Extract commit hashes and file paths from results
      const artifacts: string[] = [];
      for (const s of successes) {
        if (!s.result || typeof s.result !== "string") continue;
        try {
          const r = JSON.parse(s.result) as Record<string, unknown>;
          if (r.commit) artifacts.push(`commit:${String(r.commit).slice(0, 7)}`);
          if (r.path) artifacts.push(String(r.path));
          if (s.action === "git_commit" && r.hash) artifacts.push(`commit:${String(r.hash).slice(0, 7)}`);
        } catch { /* not JSON */ }
      }

      summary = { actions, toolsUsed, artifacts: artifacts.length > 0 ? artifacts : undefined };
    }

    return {
      problem: isBlocked
        ? `Step blocked by governance policy: ${latestIssue!.action}`
        : latestIssue?.action ?? "No execution failure recorded",
      cause: isBlocked
        ? executionError(latestIssue!.result) ?? "Governance policy blocked this operation"
        : executionError(latestIssue?.result) ?? (latestIssue ? "Tool execution failed" : "No failure detected"),
      solution: recovered
        ? correctiveAction?.summary ?? "Recovery succeeded but corrective action could not be identified"
        : hasIssue
          ? isBlocked
            ? "Adjust governance policy or use a different tool at an allowed privilege level"
            : "No verified solution yet — ask ChatGPT for a corrective plan"
          : "Existing execution path succeeded",
      confidence: rows.length === 0 ? 0 : !hasIssue ? 1 : recovered ? 0.8 : isBlocked ? 1.0 : 0.4,
      futureRecommendation: !hasIssue
        ? "Reuse the explicit tool plan and keep current governance checks"
        : recovered
          ? "Prefer the successful follow-up action when the same failure pattern appears"
          : isBlocked
            ? "Ensure tools are permitted at the current governance level before including them in tasks"
            : "Ask ChatGPT for an explicit corrective plan before retrying",
      summary,
      correctiveAction,
    };
  });
}
