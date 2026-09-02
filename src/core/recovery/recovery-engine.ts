import type { TaskPlan, TaskStep } from "../planner/task-planner.js";

export interface RecoveryAction {
  type: "retry" | "create_step" | "stop";
  reason: string;
  step?: TaskStep;
}

export function analyzeFailure(error: Error): RecoveryAction {
  const message = error.message.toLowerCase();

  if (message.includes("test") || message.includes("build")) {
    return {
      type: "create_step",
      reason: "verification failed, create diagnostic step",
      step: {
        id: Date.now(),
        action: "analyze failure and fix issue",
        status: "pending"
      }
    };
  }

  return {
    type: "stop",
    reason: error.message
  };
}

export function applyRecovery(plan: TaskPlan, action: RecoveryAction) {
  if (action.type === "create_step" && action.step) {
    plan.steps.push(action.step);
  }

  return plan;
}
