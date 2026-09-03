import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { canResumeApprovedTask } from "./resume-engine.js";
import { preparePlanForResume, getResumeStartIndex } from "./resume-controller.js";
import { runClosedAgentLoop, type ClosedLoopResult } from "./closed-agent-loop.js";
import { consumeApprovedRequest } from "../governance/approval-memory.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import type { RecoveryProvider } from "../trace/unified-recovery-service.js";

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

  if (!consumeApprovedRequest({ id: approvalId, taskId: context.taskId, stepId: context.stepId, action: context.action })) {
    return null;
  }

  const restoredPlan = preparePlanForResume(plan, context);
  const startIndex = getResumeStartIndex(context);

  return runClosedAgentLoop(
    restoredPlan,
    executor,
    1,
    startIndex,
    createExecutionContext({ taskId: context.taskId, correlationId: context.correlationId }),
    recoveryProvider,
    undefined,
    context.stepId
  );
}
