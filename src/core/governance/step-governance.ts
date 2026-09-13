import type { TaskStep } from "../planner/task-planner.js";
import { policyDecisionPoint } from "./policy-decision-point.js";
import { selectTool, type ToolName } from "../orchestrator/tool-orchestrator.js";
import { evaluateAction } from "./governance-engine.js";
import { validateWorkspace, classifyCommandCwd } from "../../security/workspace-guard.js";

/** File tools whose `path` argument is hard-scoped to the active workspace. */
const FILE_PATH_TOOLS = new Set<ToolName>([
  "read_file", "write_file", "create_file", "modify_file",
  "delete_file", "list_directory", "search_files",
]);
/** Git tools whose `cwd` argument is hard-scoped to the active workspace. */
const GIT_CWD_TOOLS = new Set<ToolName>([
  "git_status", "git_diff", "git_commit", "git_branch", "git_checkout", "git_add", "git_log",
]);

/**
 * Classify a step's policy posture BEFORE execution. For execute_command, an
 * explicit cwd outside the active workspace is derived inside the PDP; an
 * omitted/`.` cwd is resolved here against the task's persisted workspace so
 * governance sees the EFFECTIVE cwd the handler will use (executionContext.
 * workspace) — never the server process cwd.
 */
export function checkStepGovernance(step: TaskStep | string, effectiveCwd?: string) {
  if (typeof step === "string") return evaluateAction(step);

  const tool = selectTool(step);
  const args = { ...(step.arguments ?? {}) } as Record<string, unknown>;

  // Hard-scope classification BEFORE approval: file tools can never touch
  // paths outside the active workspace (no approval legitimizes it), so such
  // steps are BLOCKED up-front instead of pausing for a doomed approval.
  // Mirrors the enforcement error message in workspace-guard.
  if (FILE_PATH_TOOLS.has(tool) && typeof args.path === "string") {
    try {
      validateWorkspace(args.path);
    } catch (error) {
      return {
        decision: "blocked" as const,
        risk: "high" as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (GIT_CWD_TOOLS.has(tool) && typeof args.cwd === "string" && args.cwd !== ".") {
    if (!classifyCommandCwd(args.cwd).inside) {
      return {
        decision: "blocked" as const,
        risk: "high" as const,
        reason: `Access denied: cwd outside workspace. Allowed: active workspace only.`,
      };
    }
  }

  if (tool === "execute_command" && effectiveCwd) {
    const raw = args.cwd;
    if (typeof raw !== "string" || raw.length === 0 || raw === ".") args.cwd = effectiveCwd;
  }
  const result = policyDecisionPoint.evaluate({ tool, arguments: args });
  return {
    decision: !result.allowed ? "blocked" as const : result.requiresApproval ? "approval_required" as const : "allow" as const,
    risk: result.risk,
    reason: result.reason
  };
}
