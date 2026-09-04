import type { ExecutionContext } from "../runtime/execution-context.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { executeToolStep } from "../orchestrator/tool-orchestrator.js";
import { UnifiedRecoveryService, type RecoveryProvider } from "../trace/unified-recovery-service.js";
import { getExecutionTrace } from "../memory/execution-trace.js";
import { saveDecisionWithContext, saveExecutionWithContext, saveTaskWithContext } from "../memory/context-memory.js";
import { checkStepGovernance } from "../governance/step-governance.js";
import { createApprovalRequest } from "../governance/approval-memory.js";
import { checkpointStep } from "./checkpoint-integration.js";
import { PersistentRecoveryObservability } from "../trace/persistent-recovery-observability.js";
import type { RecoveryObservabilitySink } from "../trace/recovery-observability.js";
import { saveTaskPlan, saveTaskStep } from "../memory/task-repository.js";
import { transitionTask, type TaskState } from "../state/task-state-machine.js";
import { runWithPolicyApproval } from "../governance/policy-decision-point.js";
import { selectTool } from "../orchestrator/tool-orchestrator.js";
import { buildStepContext, resolveTemplates, hasTemplates, validateTemplates, MissingVariableError } from "../runtime/template-resolver.js";

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
  status: "completed" | "failed" | "pending_approval" | "blocked";
  plan: TaskPlan;
  completedSteps: TaskStep[];
  correlationId: string;
  approvalId?: number;
}

function move(plan: TaskPlan, to: TaskState): void {
  const from = plan.state ?? "planning";
  if (from !== to) plan.state = transitionTask(from, to);
  saveTaskPlan(plan, plan.state, plan.correlationId);
}

export async function runClosedAgentLoop(
  plan: TaskPlan,
  executor: (tool: string, step: TaskStep) => Promise<unknown>,
  maxRecovery = 1,
  startIndex = 0,
  context?: ExecutionContext,
  recoveryService?: RecoveryProvider,
  recoverySink: RecoveryObservabilitySink = new PersistentRecoveryObservability(),
  approvedStepId?: number
): Promise<ClosedLoopResult> {
  const runtimeContext = context ?? createExecutionContext({ taskId: plan.id });
  runtimeContext.taskId = plan.id;
  const completedSteps = plan.steps.filter((step, index) => index < startIndex && step.status === "completed");
  let recoveries = 0;
  let index = startIndex;

  plan.correlationId = runtimeContext.correlationId;
  if (!plan.state) plan.state = "planning";
  if (plan.state === "created") move(plan, "planning");
  if (plan.state === "waiting_approval" || plan.state === "failed") move(plan, "resuming");
  if (plan.state !== "executing") move(plan, "executing");
  const recovery = recoveryService ?? new UnifiedRecoveryService({ getTrace: () => getExecutionTrace(runtimeContext.correlationId) }, recoverySink);

  while (index < plan.steps.length) {
    const step = plan.steps[index];
    const persistStep = () => saveTaskStep(plan.id, step, index);
    move(plan, "checkpointing");
    checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "running", context: runtimeContext });
    move(plan, "executing");

    const governance = checkStepGovernance(step);
    if (governance.decision === "approval_required" && step.id !== approvedStepId) {
      step.status = "pending_approval";
      persistStep();
      move(plan, "waiting_approval");
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "pending_approval", context: runtimeContext });
      const approvalId = createApprovalRequest({
        taskId: plan.id,
        stepId: step.id,
        action: step.action,
        risk: governance.risk,
        reason: governance.reason,
        context: runtimeContext
      });
      saveTaskWithContext({ id: plan.id, description: plan.description ?? plan.task, status: "waiting_approval", context: runtimeContext });
      return { status: "pending_approval", plan, completedSteps, correlationId: runtimeContext.correlationId, approvalId };
    }

    if (governance.decision === "blocked") {
      step.status = "blocked";
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "blocked", context: runtimeContext });
      saveDecisionWithContext({ taskId: plan.id, reason: governance.reason, action: "blocked", context: runtimeContext });
      move(plan, "failed");
      return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
    }

    step.status = "running";
    persistStep();
    try {
      // Resolve template references in step arguments using completed step outputs
      const stepContext = buildStepContext(completedSteps);
      if (step.arguments && hasTemplates(step.arguments)) {
        // Validate all variables exist before resolving
        validateTemplates(step.arguments, stepContext);
        step.arguments = resolveTemplates(step.arguments, stepContext);
      }
      const execute = () => executeToolStep(step, executor);
      const result = boundedResult(await (governance.decision === "approval_required"
        ? runWithPolicyApproval(selectTool(step), execute)
        : execute()));
      step.status = "completed";
      step.output = result;
      step.error = undefined;
      persistStep();
      completedSteps.push(step);
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "completed", context: runtimeContext });
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result, status: "completed", context: runtimeContext });
      index++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isMissingVariable = error instanceof MissingVariableError;
      const isSecurityBlock = message.includes("Access denied") || message.includes("Approval required");
      
      // Classify error type
      if (isMissingVariable) {
        step.status = "failed";
        step.error = message;
        step.errorType = "MISSING_CONTEXT_VARIABLE";
        persistStep();
        checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "failed", context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message, errorType: "MISSING_CONTEXT_VARIABLE", variable: (error as MissingVariableError).variable }, status: "failed", context: runtimeContext });
        // Missing variables are not recoverable
        move(plan, "failed");
        return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
      }
      
      if (isSecurityBlock) {
        step.status = "blocked";
        step.error = message;
        step.errorType = "SECURITY_POLICY";
        persistStep();
        checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "blocked", context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message, errorType: "SECURITY_POLICY", recoverable: false }, status: "blocked", context: runtimeContext });
        // Security blocks are not recoverable
        move(plan, "failed");
        return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
      }
      
      // Regular execution error
      step.status = "failed";
      step.error = message;
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "failed", context: runtimeContext });
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message }, status: "failed", context: runtimeContext });

      if (recoveries >= maxRecovery) {
        move(plan, "failed");
        return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
      }

      move(plan, "recovering");
      const action = recovery.decideRecovery(recovery.analyzeFailure(runtimeContext.correlationId));

      saveDecisionWithContext({ taskId: plan.id, reason: action.reason, action: action.type, context: runtimeContext });
      const recovered = recovery.executeRecovery(plan, action, {
        correlationId: runtimeContext.correlationId,
        taskId: plan.id,
        sink: recoverySink,
        stepIndex: index,
        retryCount: recoveries + 1
      });
      if (action.type === "stop" || !recovered) {
        move(plan, "failed");
        return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
      }

      recoveries++;
      step.status = "pending";
      move(plan, "executing");
      // retry stays at this index; create_step inserts its corrective step at this index.
    }
  }

  move(plan, "verifying");
  move(plan, "completed");
  return { status: "completed", plan, completedSteps, correlationId: runtimeContext.correlationId };
}
