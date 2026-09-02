import type { TaskPlan } from "../planner/task-planner.js";
import type { RecoveryAction } from "../recovery/recovery-engine.js";

export function applySelfHealing(plan: TaskPlan, action: RecoveryAction, insertionIndex = plan.steps.length): TaskPlan {
  if (action.type === "create_step" && action.step) {
    const usedIds = new Set(plan.steps.map((step) => step.id));
    const step = { ...action.step };
    if (usedIds.has(step.id)) step.id = Math.max(0, ...usedIds) + 1;
    plan.steps.splice(insertionIndex, 0, step);
  }

  return plan;
}

export function canAutoRecover(action: RecoveryAction): boolean {
  return action.type === "retry" || action.type === "create_step";
}

export function shouldContinueAfterRecovery(action: RecoveryAction): boolean {
  return canAutoRecover(action);
}
