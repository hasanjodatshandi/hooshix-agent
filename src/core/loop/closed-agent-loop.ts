import type { ExecutionContext } from "../runtime/execution-context.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { executeToolStep } from "../orchestrator/tool-orchestrator.js";
import { UnifiedRecoveryService, type RecoveryDecisionProvider } from "../trace/unified-recovery-service.js";
import { getExecutionTrace } from "../memory/execution-trace.js";
import { saveDecisionWithContext, saveExecutionWithContext, saveTaskWithContext } from "../memory/context-memory.js";
import { checkStepGovernance } from "../governance/step-governance.js";
import { createApprovalRequest } from "../governance/approval-memory.js";
import { checkpointStep } from "./checkpoint-integration.js";
import { recoverAndContinue } from "../recovery/self-healing-recovery.js";
import { PersistentRecoveryObservability } from "../trace/persistent-recovery-observability.js";
import type { RecoveryObservabilitySink } from "../trace/recovery-observability.js";
import { saveTaskPlan, saveTaskStep } from "../memory/task-repository.js";

const MAX_PERSISTED_RESULT_BYTES = 128 * 1024;
const MAX_RESULT_PREVIEW_CHARACTERS = 32 * 1024;

function boundedResult(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes <= MAX_PERSISTED_RESULT_BYTES) return value;
    return { truncated: true, originalBytes: bytes, preview: serialized.slice(0, MAX_RESULT_PREVIEW_CHARACTERS) };
  } catch {
    return { unserializable: true, preview: String(value).slice(0, 1000) };
  }
}

export interface ClosedLoopResult {
  status: "completed" | "failed" | "pending_approval";
  plan: TaskPlan;
  completedSteps: TaskStep[];
  correlationId: string;
  approvalId?: number;
}

export async function runClosedAgentLoop(
  plan: TaskPlan,
  executor: (tool: string, step: TaskStep) => Promise<unknown>,
  maxRecovery = 1,
  startIndex = 0,
  context?: ExecutionContext,
  recoveryService?: RecoveryDecisionProvider,
  recoverySink: RecoveryObservabilitySink = new PersistentRecoveryObservability(),
  approvedStepId?: number
): Promise<ClosedLoopResult> {
  const runtimeContext = context ?? createExecutionContext({ taskId: plan.id });
  runtimeContext.taskId = plan.id;
  const completedSteps = plan.steps.filter((step, index) => index < startIndex && step.status === "completed");
  let recoveries = 0;
  let index = startIndex;

  plan.correlationId = runtimeContext.correlationId;
  saveTaskPlan(plan, "executing", runtimeContext.correlationId);

  while (index < plan.steps.length) {
    const step = plan.steps[index];
    const persistStep = () => saveTaskStep(plan.id, step, index);
    checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "running", context: runtimeContext });

    const governance = checkStepGovernance(step);
    if (governance.decision === "approval_required" && step.id !== approvedStepId) {
      step.status = "pending_approval";
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "pending_approval", context: runtimeContext });
      const approvalId = createApprovalRequest({
        taskId: plan.id,
        stepId: step.id,
        action: step.action,
        risk: governance.risk,
        reason: governance.reason,
        context: runtimeContext
      });
      saveTaskWithContext({ id: plan.id, description: plan.description ?? plan.task, status: "paused", context: runtimeContext });
      return { status: "pending_approval", plan, completedSteps, correlationId: runtimeContext.correlationId, approvalId };
    }

    if (governance.decision === "blocked") {
      step.status = "blocked";
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "blocked", context: runtimeContext });
      saveDecisionWithContext({ taskId: plan.id, reason: governance.reason, action: "blocked", context: runtimeContext });
      saveTaskWithContext({ id: plan.id, description: plan.task, status: "failed", context: runtimeContext });
      return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
    }

    step.status = "running";
    persistStep();
    try {
      const result = boundedResult(await executeToolStep(step, executor));
      step.status = "completed";
      step.output = result;
      step.error = undefined;
      persistStep();
      completedSteps.push(step);
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "completed", context: runtimeContext });
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result, status: "completed", context: runtimeContext });
      index++;
    } catch (error) {
      step.status = "failed";
      step.error = error instanceof Error ? error.message : String(error);
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "failed", context: runtimeContext });
      const message = error instanceof Error ? error.message : String(error);
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message }, status: "failed", context: runtimeContext });

      if (recoveries >= maxRecovery) {
        saveTaskWithContext({ id: plan.id, description: plan.task, status: "failed", context: runtimeContext });
        return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
      }

      const recovery = recoveryService ?? new UnifiedRecoveryService({ getTrace: () => getExecutionTrace(runtimeContext.correlationId) });
      const action = recovery.decide(runtimeContext.correlationId);

      saveDecisionWithContext({ taskId: plan.id, reason: action.reason, action: action.type, context: runtimeContext });
      if (action.type === "stop" || !recoverAndContinue(plan, action, {
        correlationId: runtimeContext.correlationId,
        taskId: plan.id,
        sink: recoverySink,
        stepIndex: index,
        retryCount: recoveries + 1
      })) {
        saveTaskWithContext({ id: plan.id, description: plan.task, status: "failed", context: runtimeContext });
        return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
      }

      recoveries++;
      step.status = "pending";
      saveTaskPlan(plan, "executing", runtimeContext.correlationId);
      // retry stays at this index; create_step inserts its corrective step at this index.
    }
  }

  saveTaskWithContext({ id: plan.id, description: plan.task, status: "completed", context: runtimeContext });
  return { status: "completed", plan, completedSteps, correlationId: runtimeContext.correlationId };
}
