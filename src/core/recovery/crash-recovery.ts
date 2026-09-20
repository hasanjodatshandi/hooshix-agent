/**
 * Crash Recovery Service
 *
 * Detects tasks that were interrupted by a process crash/restart
 * and automatically resumes them from the last completed step.
 *
 * Called once on server startup.
 */
import { findInterruptedTasks, getTaskPlan, markTaskRecovered, updateTaskHeartbeat } from "../memory/task-repository.js";
import {withTaskExecutionLease} from "../runtime/task-lease-runner.js";
import { createLocalToolExecutor } from "../executor/local-tool-executor.js";
import { runClosedAgentLoop } from "../loop/closed-agent-loop.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import { saveTaskPlan, finishStepExecutionReceipt } from "../memory/task-repository.js";
import { finalizeMutationReceipt } from "../loop/execution-receipt.js";
import { OPERATION_CATALOG } from "../../application/services/operation-catalog.js";
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

/** Reconstruct the authoritative effect class from the R2 catalog. Missing
 * or invalid historical Tool IDs are NEVER treated as read-only. */
function isProvenReadOnly(tool:unknown):boolean {
  return typeof tool==="string"&&Object.hasOwn(OPERATION_CATALOG,tool)&&
    OPERATION_CATALOG[tool as keyof typeof OPERATION_CATALOG].effect==="read_only";
}

/**
 * Scan for interrupted tasks and attempt to resume them.
 * Returns a summary of what was recovered.
 */
export async function recoverInterruptedTasks(): Promise<CrashRecoveryResult[]> {
  const interrupted = findInterruptedTasks();
  if (interrupted.length === 0) return [];

  console.error(`🔄 Crash recovery: found ${interrupted.length} interrupted task(s)`);

  const results: CrashRecoveryResult[] = [];

  for (const discovered of interrupted) {
    try {
      // A prior process may still own this Task, even when its state is
      // executing. Acquire the SAME durable lease as normal run/resume BEFORE
      // reading current state, changing a receipt or resuming any effect.
      await withTaskExecutionLease(discovered.id,async()=>{
        const plan=getTaskPlan(discovered.id);
        if(!plan||!["executing","checkpointing","recovering","resuming","verifying"].includes(plan.state??"")){
          results.push({taskId:discovered.id,title:discovered.task,resumedFrom:0,
            totalSteps:discovered.steps.length,status:"skipped",
            reason:"Task no longer requires crash recovery"});
          return;
        }
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
        return;
      }

      const step = plan.steps[startIndex];

      if(plan.steps.some(s=>s.status==="outcome_unknown")){
        saveTaskPlan(plan,"failed",plan.correlationId);
        results.push({taskId:plan.id,title:plan.task,resumedFrom:startIndex,
          totalSteps:plan.steps.length,status:"failed",
          reason:"Task contains an unresolved external effect; reconciliation required"});
        return;
      }

      // Read-only stale calls are safe to retry. Mutating calls become
      // outcome_unknown because their side effect may already have happened.
      if (step.status === "running") {
        if (isProvenReadOnly(step.tool)) {
          step.status = "pending";
        } else {
          // The receipt might have been persisted before the crash even if
          // the Step row still says running. Terminal results do not prove the
          // Task output/state committed. Preserve that evidence but never replay.
          const receipt=step.lastReceipt;
          if(receipt?.status==="started"){
            const unknown=finalizeMutationReceipt(receipt,"outcome_unknown");
            finishStepExecutionReceipt(plan.id,unknown);
            step.lastReceipt=unknown;
          }
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
          return;
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
        return;
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
      });
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      // A live owner or expired/fenced recovery MUST NOT be marked failed by
      // an out-of-lease handler: that would corrupt the authoritative result.
      const contention=message==="task_lease_conflict"||message==="task_lease_fenced";
      results.push({taskId:discovered.id,title:discovered.task,resumedFrom:0,
        totalSteps:discovered.steps.length,status:contention?"skipped":"failed",
        reason:contention?"Live Task owner holds the execution lease":
          "Recovery failed without an unguarded Task state write: "+message});
      console.error("Crash recovery attempt skipped/failed: "+(contention?"lease held":message));
    }
  }

  return results;
}