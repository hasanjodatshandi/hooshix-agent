import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { runClosedAgentLoop, type ClosedLoopResult } from "./closed-agent-loop.js";
import { restorePlanPosition } from "./plan-resume.js";
import { canResumeApprovedTask } from "./resume-engine.js";
import { consumeApprovedRequest } from "../governance/approval-memory.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import type { RecoveryProvider } from "../trace/unified-recovery-service.js";

export { canResumeApprovedTask } from "./resume-engine.js";
export { restorePlanPosition } from "./plan-resume.js";

/**
 * Resume an approved task at its paused step.
 * (Consolidates the former resume-controller/resume-engine/plan-resume layers.)
 */
export async function resumeApprovedTask(
  approvalId: number,
  plan: TaskPlan,
  executor: (tool: string, step: TaskStep) => Promise<unknown>,
  recoveryProvider?: RecoveryProvider
): Promise<ClosedLoopResult | null> {
  const context = canResumeApprovedTask(approvalId);

  if (!context) {
    return null;
  }

  const approvedStep = plan.steps[context.stepIndex];
  if (plan.id !== context.taskId || !approvedStep || approvedStep.id !== context.stepId || approvedStep.action !== context.action) {
    return null;
  }

  // Validate the plan is resumable BEFORE consuming the approval — otherwise a
  // cancelled/invalid state burns the approval on a run that immediately throws.
  const resumableStates = ["waiting_approval", "resuming", "failed", "verifying"];
  if (!resumableStates.includes(plan.state ?? "")) {
    return null;
  }

  if (!consumeApprovedRequest({ id: approvalId, taskId: context.taskId, stepId: context.stepId, action: context.action })) {
    return null;
  }

  // Mark the approved step pending and keep prior statuses intact (unlike the
  // old restorePlanPosition which force-marked failed/cancelled steps completed).
  const restoredPlan = restorePlanPosition(plan, context);
  const startIndex = context.stepIndex;

  return runClosedAgentLoop(
    restoredPlan,
    executor,
    restoredPlan.maxRecovery ?? 1,
    startIndex,
    createExecutionContext({ taskId: context.taskId, correlationId: context.correlationId }),
    recoveryProvider,
    undefined,
    context.stepId
  );
}
