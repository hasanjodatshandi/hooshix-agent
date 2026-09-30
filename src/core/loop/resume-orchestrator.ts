import type { TaskPlan, TaskStep } from "../../application/dto/legacy-task-plan.js";
import { runClosedAgentLoop, type ClosedLoopResult } from "./closed-agent-loop.js";
import { restorePlanPosition } from "./plan-resume.js";
import { canResumeApprovedTask } from "./resume-engine.js";
import { consumeApprovedRequest, getApprovalRequest } from "../governance/approval-memory.js";
import { fingerprintTaskEffect, resolveApprovedTaskArgs } from "../governance/r2-approval-fingerprint.js";
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
  // R3: legacy `resuming` folded into `executing` by migration 20.
  const resumableStates = ["waiting_approval", "executing", "failed", "verifying"];
  if (!resumableStates.includes(plan.state ?? "")) {
    return null;
  }

  // Refuse historical unbound approvals, changed arguments/tool/scope, or expired
  // requests BEFORE the atomic consume. The caller must request a fresh grant.
  const stored=getApprovalRequest(approvalId);
  if(!stored?.tool_id || !stored.request_fingerprint || !stored.principal_id ||
     !stored.session_id || !stored.expires_at || stored.expires_at<=new Date().toISOString() ||
     !plan.executionContext || stored.principal_id!==plan.executionContext.principalId ||
     stored.session_id!==plan.executionContext.sessionId) return null;
  let actualFingerprint:string;
  try {
    const completed=plan.steps.filter((step,index)=>index<context.stepIndex&&step.status==="completed");
    actualFingerprint=fingerprintTaskEffect({
      taskId:plan.id,stepId:approvedStep.id,action:approvedStep.action,
      toolId:approvedStep.tool??stored.tool_id,
      args:resolveApprovedTaskArgs(approvedStep,completed),
      context:plan.executionContext,
    });
  } catch { return null; }
  if(stored.tool_id!==(approvedStep.tool??stored.tool_id) ||
     actualFingerprint!==stored.request_fingerprint) return null;
  if (!consumeApprovedRequest({
    id: approvalId,taskId: context.taskId,stepId: context.stepId,
    action: context.action,requestFingerprint:actualFingerprint,
  })) return null;

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
    context.stepId,
    approvalId
  );
}