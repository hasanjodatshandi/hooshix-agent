import { randomUUID } from "node:crypto";
import { applySelfHealing, shouldContinueAfterRecovery } from "../trace/self-healing-controller.js";
import { RecoveryLifecycleTracker } from "../trace/recovery-lifecycle.js";
import type { RecoveryObservabilitySink } from "../trace/recovery-observability.js";
import type { TaskPlan } from "../planner/task-planner.js";
import type { RecoveryAction } from "./recovery-engine.js";

export interface RecoveryRuntimeContext {
  correlationId: string;
  taskId?: string;
  sink?: RecoveryObservabilitySink;
  stepIndex?: number;
  retryCount?: number;
}

export function recoverAndContinue(
  plan: TaskPlan,
  action: RecoveryAction,
  context?: RecoveryRuntimeContext
): boolean {
  if (!shouldContinueAfterRecovery(action)) {
    return false;
  }

  const tracker = context?.sink ? new RecoveryLifecycleTracker(context.sink) : undefined;
  const baseEvent = {
    recoveryId: randomUUID(),
    correlationId: context?.correlationId ?? plan.id,
    action: action.type,
    reason: action.reason,
    retryCount: context?.retryCount ?? 1,
    startedAt: new Date().toISOString()
  };

  tracker?.start(baseEvent);

  try {
    applySelfHealing(plan, action, context?.stepIndex);
    tracker?.complete({ ...baseEvent, completedAt: new Date().toISOString() });
    return true;
  } catch (error) {
    tracker?.fail({ ...baseEvent, completedAt: new Date().toISOString() });
    return false;
  }
}
