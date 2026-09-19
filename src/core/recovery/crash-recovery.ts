/**
 * Crash Recovery Service
 *
 * Detects tasks that were interrupted by a process crash/restart
 * and automatically resumes them from the last completed step.
 *
 * Called once on server startup.
 */
import { findInterruptedTasks, markTaskRecovered, updateTaskHeartbeat } from "../memory/task-repository.js";
import { createLocalToolExecutor } from "../executor/local-tool-executor.js";
import { runClosedAgentLoop } from "../loop/closed-agent-loop.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import { saveTaskPlan } from "../memory/task-repository.js";
import type { TaskState } from "../state/task-state-machine.js";
import { resolveTaskWorkspace } from "../../security/task-workspace.js";
import { runWithWorkspaceScope } from "../../security/workspace-guard.js";

export interface CrashRecoveryResult {
  taskId: string;
  title: string;
  resumedFrom: number;
  totalSteps: number;
  status: "recovered" | "skipped" | "failed";
  reason?: string;
}

const READ_ONLY_TOOLS = new Set([
  "get_system_info", "agent_metrics", "list_directory", "read_file", "search_files",
  "git_status", "git_diff", "git_log", "get_workspace",
]);

/**
 * Scan for interrupted tasks and attempt to resume them.
 * Returns a summary of what was recovered.
 */
export async function recoverInterruptedTasks(): Promise<CrashRecoveryResult[]> {
  const interrupted = findInterruptedTasks();
  if (interrupted.length === 0) return [];

  console.error(`🔄 Crash recovery: found ${interrupted.length} interrupted task(s)`);

  const results: CrashRecoveryResult[] = [];

  for (const plan of interrupted) {
    try {
      // Find the first non-completed step
      const startIndex = plan.steps.findIndex((s) => s.status !== "completed");

      if (startIndex < 0) {
        // All steps completed but task state wasn't updated — mark as completed
        plan.state = "completed";
        saveTaskPlan(plan, "completed", plan.correlationId);
        results.push({
          taskId: plan.id,
          title: plan.task,
          resumedFrom: plan.steps.length,
          totalSteps: plan.steps.length,
          status: "recovered",
          reason: "All steps were completed; task state updated to completed",
        });
        console.error(`  ✅ ${plan.task}: all steps done, marking completed`);
        continue;
      }

      const step = plan.steps[startIndex];

      // Read-only stale calls are safe to retry. Mutating calls become
      // outcome_unknown because their side effect may already have happened.
      if (step.status === "running") {
        if (step.tool && READ_ONLY_TOOLS.has(step.tool)) {
          step.status = "pending";
        } else {
          step.status = "outcome_unknown";
          step.error = "Step was running in a previous service instance; mutation outcome requires reconciliation";
          step.errorType = "OUTCOME_UNKNOWN";
          saveTaskPlan(plan, "failed", plan.correlationId);
          results.push({
            taskId: plan.id,
            title: plan.task,
            resumedFrom: startIndex,
            totalSteps: plan.steps.length,
            status: "failed",
            reason: "Mutating step outcome is unknown and requires reconciliation",
          });
          continue;
        }
      }

      // Skip tasks with pending approval — they need human intervention
      if (step.status === "pending_approval") {
        results.push({
          taskId: plan.id,
          title: plan.task,
          resumedFrom: startIndex,
          totalSteps: plan.steps.length,
          status: "skipped",
          reason: "Step requires approval; needs human intervention",
        });
        console.error(`  ⏭️  ${plan.task}: waiting for approval at step ${startIndex + 1}`);
        continue;
      }

      // Resume execution from the interrupted step — pass the task's captured
      // execution context so resumed tasks use the workspace the plan was
      // created with, not the process's current global workspace.
      const context = createExecutionContext({ taskId: plan.id, correlationId: plan.correlationId });
      const executor = createLocalToolExecutor(context.correlationId, plan.id, plan.executionContext);
      const resolvedWorkspace = resolveTaskWorkspace(plan.executionContext);

      // Mark as resuming
      markTaskRecovered(plan.id);

      const execute = () => runClosedAgentLoop(
        plan,
        executor,
        1, // maxRecovery
        startIndex,
        context,
        undefined, // use default recovery provider
        undefined, // use default sink
        undefined  // no approvedStepId
      );
      const result = await (resolvedWorkspace.workspace
        ? runWithWorkspaceScope(resolvedWorkspace.workspace, execute)
        : execute());

      saveTaskPlan(plan, (result.status as TaskState) ?? "completed", context.correlationId);
      updateTaskHeartbeat(plan.id);

      results.push({
        taskId: plan.id,
        title: plan.task,
        resumedFrom: startIndex,
        totalSteps: plan.steps.length,
        status: result.status === "completed" ? "recovered" : "failed",
        reason: `Resumed from step ${startIndex + 1}: ${result.status}`,
      });

      console.error(
        `  ${result.status === "completed" ? "✅" : "❌"} ${plan.task}: ` +
        `resumed from step ${startIndex + 1}/${plan.steps.length} → ${result.status}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      saveTaskPlan(plan, "failed", plan.correlationId);
      results.push({
        taskId: plan.id,
        title: plan.task,
        resumedFrom: 0,
        totalSteps: plan.steps.length,
        status: "failed",
        reason: `Recovery failed: ${msg}`,
      });
      console.error(`  ❌ ${plan.task}: recovery failed — ${msg}`);
    }
  }

  return results;
}
