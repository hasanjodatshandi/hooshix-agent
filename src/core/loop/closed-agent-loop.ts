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
import { saveTaskPlan, saveTaskStep, saveTaskStatus, updateTaskHeartbeat } from "../memory/task-repository.js";
import { transitionTask, type TaskState } from "../state/task-state-machine.js";
import { runWithPolicyApproval } from "../governance/policy-decision-point.js";
import { selectTool } from "../orchestrator/tool-orchestrator.js";
import { buildStepContext, resolveTemplates, hasTemplates, validateTemplates, MissingVariableError } from "../runtime/template-resolver.js";
import { classifyError, isTransientError } from "../errors.js";

const MAX_PERSISTED_RESULT_BYTES = 128 * 1024;
const MAX_RESULT_PREVIEW_CHARACTERS = 32 * 1024;
/** Base delay before a retry (ms). Doubles per recovery attempt, capped. */
const RETRY_BACKOFF_BASE_MS = 1000;
const RETRY_BACKOFF_MAX_MS = 30_000;

/** Exponential backoff with a cap; full second retry delay after first failure. */
function backoffDelayMs(attempt: number): number {
  return Math.min(RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), RETRY_BACKOFF_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a step-level timeout that actually cancels the underlying operation.
 * Returns { result } on success or { timedOut: true } if timeout fires.
 * The AbortController signal is passed to the executor so it can kill child processes.
 *
 * IMPORTANT: This function requires the AbortController itself (not just its signal)
 * so it can call abort() which triggers execa's cancelSignal → process kill.
 */
function withStepTimeout<T>(promise: Promise<T>, timeoutMs: number, abortController?: AbortController): Promise<{ result?: T; timedOut: boolean }> {
  if (timeoutMs <= 0) return promise.then((result) => ({ result, timedOut: false }));
  return new Promise<{ result?: T; timedOut: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Abort the controller so execa's cancelSignal triggers process tree kill
      abortController?.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
    promise.then(
      (result) => { clearTimeout(timer); resolve({ result, timedOut: false }); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

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
  status: "completed" | "failed" | "pending_approval" | "blocked" | "cancelled" | "not_resumable";
  plan: TaskPlan;
  completedSteps: TaskStep[];
  correlationId: string;
  approvalId?: number;
}

/**
 * Transition plan state and persist. Cheap transitions (checkpointing ⇄
 * executing, verifying) write only the task status row — a full saveTaskPlan
 * rewrites every step row and caused ~200 full-plan rewrites per 100-step run.
 */
function move(plan: TaskPlan, to: TaskState): void {
  const from = plan.state ?? "planning";
  if (from !== to) plan.state = transitionTask(from, to);
  const lightweight = to === "checkpointing" || to === "executing" || to === "verifying";
  if (lightweight) {
    saveTaskStatus(plan.id, plan.state ?? from);
  } else {
    saveTaskPlan(plan, plan.state ?? from, plan.correlationId);
  }
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
  let failedAt = -1; // Track first failure index for runWhen handling

  plan.correlationId = runtimeContext.correlationId;
  if (!plan.state) plan.state = "planning";
  if (plan.state === "created") move(plan, "planning");
  if (plan.state === "waiting_approval" || plan.state === "failed") move(plan, "resuming");
  if (plan.state !== "executing") move(plan, "executing");
  const recovery = recoveryService ?? new UnifiedRecoveryService({ getTrace: () => getExecutionTrace(runtimeContext.correlationId) }, recoverySink);

  while (index < plan.steps.length) {
    const step = plan.steps[index];

    // Evaluate runWhen: skip step if its dependencies don't meet the condition
    if (step.dependsOn && step.dependsOn.length > 0) {
      const runWhen = step.runWhen ?? "success";
      const depSteps = step.dependsOn.map((depId) => plan.steps.find((s) => s.id === depId)).filter(Boolean) as TaskStep[];
      const anyDepFailed = depSteps.some((s) => s.status === "failed" || s.status === "blocked" || s.status === "cancelled");

      let shouldRun = true;
      if (runWhen === "success" && anyDepFailed) shouldRun = false;
      if (runWhen === "failure" && !anyDepFailed) shouldRun = false;
      // "always" always runs

      if (!shouldRun) {
        // Mark step as skipped (cancelled without execution) and move on
        step.status = "cancelled";
        step.error = `Skipped: runWhen=${runWhen}, dependencies not met`;
        saveTaskStep(plan.id, step, index);
        checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "cancelled", context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { skipped: true, reason: `runWhen=${runWhen}` }, status: "cancelled", context: runtimeContext });
        index++;
        continue;
      }
    }

    const persistStep = () => saveTaskStep(plan.id, step, index);
    move(plan, "checkpointing");
    checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "running", context: runtimeContext });
    move(plan, "executing");

    const governance = checkStepGovernance(step, plan.executionContext?.workspace);
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
      // Persist maxRecovery so task_resume can restore it
      plan.maxRecovery = maxRecovery;
      saveTaskPlan(plan, plan.state, plan.correlationId);
      saveTaskWithContext({ id: plan.id, description: plan.description ?? plan.task, status: "waiting_approval", context: runtimeContext });
      return { status: "pending_approval", plan, completedSteps, correlationId: runtimeContext.correlationId, approvalId };
    }

    if (governance.decision === "blocked") {
      step.status = "blocked";
      step.error = governance.reason;
      step.errorType = classifyError(new Error(governance.reason));
      step.failedAttempts = (step.failedAttempts ?? 0) + 1;
      step.attemptHistory = [...(step.attemptHistory ?? []), { attempt: step.attempts ?? 0, status: "failed" as const, error: governance.reason, timestamp: new Date().toISOString() }];
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "blocked", context: runtimeContext });
      saveDecisionWithContext({ taskId: plan.id, reason: governance.reason, action: "blocked", context: runtimeContext });
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: governance.reason, errorType: "GOVERNANCE_BLOCKED", blocked: true }, status: "blocked", context: runtimeContext });
      failedAt = failedAt === -1 ? index : failedAt;
      index++;
      continue; // Continue loop for runWhen=failure steps
    }

    step.status = "running";
    // Track attempt
    step.attempts = (step.attempts ?? 0) + 1;
    persistStep();
    try {
      // Resolve template references in step arguments using completed step outputs
      const stepContext = buildStepContext(completedSteps);
      if (step.arguments && hasTemplates(step.arguments)) {
        // Preserve original template arguments before resolution (immutable plan provenance)
        if (!step.templateArguments) {
          step.templateArguments = structuredClone(step.arguments);
        }
        // Validate all variables exist before resolving
        validateTemplates(step.arguments, stepContext);
        step.arguments = resolveTemplates(step.arguments, stepContext);
        // Persist resolved arguments so they survive restart
        persistStep();
      }
      // Use AbortController for real cancellation on timeout
      const stepAbort = new AbortController();
      const signal = stepAbort.signal;
      const execute = () => executeToolStep(step, executor, signal);
      const timeout = step.timeout ?? 30_000;
      const { result: raw, timedOut } = await withStepTimeout(
        governance.decision === "approval_required"
          ? runWithPolicyApproval(selectTool(step), execute)
          : execute(),
        timeout,
        stepAbort
      );
      if (timedOut) {
        // Use outcome_unknown instead of cancelled: the underlying process may
        // still be running or may have produced partial side effects. The
        // caller should reconcile before retrying.
        step.status = "outcome_unknown";
        step.error = `Step timed out after ${timeout}ms — operation outcome is unknown, may require reconciliation`;
        step.errorType = "TIMEOUT";
        step.failedAttempts = (step.failedAttempts ?? 0) + 1;
        step.attemptHistory = [...(step.attemptHistory ?? []), { attempt: step.attempts ?? 1, status: "failed" as const, error: step.error, timestamp: new Date().toISOString() }];
        persistStep();
        checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "outcome_unknown", context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: step.error, errorType: "TIMEOUT", timeout, reconciliationRequired: true }, status: "outcome_unknown", context: runtimeContext });
        if (recoveries >= maxRecovery) {
          failedAt = failedAt === -1 ? index : failedAt;
          index++;
          continue; // Continue loop for runWhen=failure steps
        }
        // Allow recovery on timeout (TimeoutError → classifyError → "retry")
        move(plan, "recovering");
        const action = recovery.decideRecovery(recovery.analyzeFailure(runtimeContext.correlationId));
        recoveries++;
        saveDecisionWithContext({ taskId: plan.id, reason: action.reason, action: action.type, context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: `recovery_attempt_${recoveries}`, result: { type: "recovery_attempt", attempt: recoveries, strategy: action.type, reason: "timeout", stepId: step.id, outcome: action.type === "stop" ? "not_recovered" : "retrying" }, status: action.type === "stop" ? "failed" : "completed", context: runtimeContext });
        const recovered = recovery.executeRecovery(plan, action, { correlationId: runtimeContext.correlationId, taskId: plan.id, sink: recoverySink, stepIndex: index, retryCount: recoveries });
        if (action.type === "stop" || !recovered) {
          failedAt = failedAt === -1 ? index : failedAt;
          index++;
          continue; // Continue loop for runWhen=failure steps
        }
        // Backoff before the hot retry loop hammers the same operation
        await sleep(backoffDelayMs(recoveries));
        step.status = "pending";
        move(plan, "executing");
        // retry stays at this index
        continue;
      }
      // Unwrap { tool, result } from executeToolStep so template resolver
      // can access flat fields like {{step1.output.path}} directly
      const result = boundedResult(
        raw && typeof raw === "object" && "tool" in raw && "result" in raw
          ? (raw as { tool: string; result: unknown }).result
          : raw
      );
      step.status = "completed";
      step.output = result;
      step.error = undefined;
      // Record attempt history
      step.attemptHistory = [...(step.attemptHistory ?? []), { attempt: step.attempts ?? 1, status: "completed" as const, timestamp: new Date().toISOString() }];
      persistStep();
      updateTaskHeartbeat(plan.id);
      completedSteps.push(step);
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "completed", context: runtimeContext });
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result, status: "completed", context: runtimeContext });
      index++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = classifyError(error);
      const isMissingVariable = errorCode === "MISSING_CONTEXT_VARIABLE" || error instanceof MissingVariableError;
      const isSecurityBlock = errorCode === "SECURITY_POLICY" || errorCode === "APPROVAL_REQUIRED" || errorCode === "GOVERNANCE_BLOCKED";

      // Classify error type
      if (isMissingVariable) {
        step.status = "failed";
        step.error = message;
        step.errorType = "MISSING_CONTEXT_VARIABLE";
        step.failedAttempts = (step.failedAttempts ?? 0) + 1;
        step.attemptHistory = [...(step.attemptHistory ?? []), { attempt: step.attempts ?? 1, status: "failed" as const, error: message, timestamp: new Date().toISOString() }];
        persistStep();
        checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "failed", context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message, errorType: "MISSING_CONTEXT_VARIABLE", variable: error instanceof MissingVariableError ? error.variable : undefined }, status: "failed", context: runtimeContext });
        // Missing variables are not recoverable, but continue for runWhen=failure steps
        failedAt = failedAt === -1 ? index : failedAt;
        index++;
        continue;
      }

      if (isSecurityBlock) {
        step.status = "blocked";
        step.error = message;
        step.errorType = "SECURITY_POLICY";
        step.failedAttempts = (step.failedAttempts ?? 0) + 1;
        step.attemptHistory = [...(step.attemptHistory ?? []), { attempt: step.attempts ?? 1, status: "failed" as const, error: message, timestamp: new Date().toISOString() }];
        persistStep();
        checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "blocked", context: runtimeContext });
        saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message, errorType: "SECURITY_POLICY", recoverable: false }, status: "blocked", context: runtimeContext });
        // Security blocks are not recoverable, but continue for runWhen=failure steps
        failedAt = failedAt === -1 ? index : failedAt;
        index++;
        continue;
      }

      // Regular execution error
      step.status = "failed";
      step.error = message;
      step.errorType = errorCode;
      step.failedAttempts = (step.failedAttempts ?? 0) + 1;
      step.attemptHistory = [...(step.attemptHistory ?? []), { attempt: step.attempts ?? 1, status: "failed" as const, error: message, timestamp: new Date().toISOString() }];
      persistStep();
      checkpointStep({ taskId: plan.id, stepId: step.id, stepIndex: index, status: "failed", context: runtimeContext });
      saveExecutionWithContext({ taskId: plan.id, stepId: step.id, action: step.action, result: { error: message, errorType: errorCode }, status: "failed", context: runtimeContext });

      if (recoveries >= maxRecovery) {
        failedAt = failedAt === -1 ? index : failedAt;
        index++;
        continue; // Continue loop for runWhen=failure steps
      }

      // Transient failures (timeout/network) are safe to retry; everything
      // else needs a corrective plan — retrying a deterministic failure in a
      // tight loop is wasted work.
      if (!isTransientError(error)) {
        failedAt = failedAt === -1 ? index : failedAt;
        index++;
        continue; // Continue loop for runWhen=failure steps
      }

      move(plan, "recovering");
      const action = recovery.decideRecovery(recovery.analyzeFailure(runtimeContext.correlationId));
      recoveries++;

      // Record the recovery attempt in the timeline
      saveExecutionWithContext({
        taskId: plan.id,
        stepId: step.id,
        action: `recovery_attempt_${recoveries}`,
        result: {
          type: "recovery_attempt",
          attempt: recoveries,
          strategy: action.type,
          reason: action.reason,
          stepId: step.id,
          outcome: action.type === "stop" ? "not_recovered" : "retrying"
        },
        status: action.type === "stop" ? "failed" : "completed",
        context: runtimeContext
      });
      saveDecisionWithContext({ taskId: plan.id, reason: action.reason, action: action.type, context: runtimeContext });
      const recovered = recovery.executeRecovery(plan, action, {
        correlationId: runtimeContext.correlationId,
        taskId: plan.id,
        sink: recoverySink,
        stepIndex: index,
        retryCount: recoveries
      });
      if (action.type === "stop" || !recovered) {
        failedAt = failedAt === -1 ? index : failedAt;
        index++;
        continue; // Continue loop for runWhen=failure steps
      }

      // Exponential backoff before the retry so transient outages get time to clear
      await sleep(backoffDelayMs(recoveries));
      step.status = "pending";
      move(plan, "executing");
      // retry stays at this index; create_step inserts its corrective step at this index.
    }
  }

  // Ensure valid state transition before final status
  if (plan.state === "recovering") move(plan, "executing");
  move(plan, "verifying");
  if (failedAt >= 0) {
    move(plan, "failed");
    return { status: "failed", plan, completedSteps, correlationId: runtimeContext.correlationId };
  }
  move(plan, "completed");
  return { status: "completed", plan, completedSteps, correlationId: runtimeContext.correlationId };
}
