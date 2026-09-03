import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import type { RecoveryObservabilitySink } from "../trace/recovery-observability.js";

export interface RecoveryAction {
  type: "retry" | "rollback" | "modify_input" | "change_tool" | "replan" | "ask_approval" | "create_step" | "stop";
  reason: string;
  step?: TaskStep;
}

export interface RecoveryExecutionContext {
  correlationId: string;
  taskId?: string;
  sink?: RecoveryObservabilitySink;
  stepIndex?: number;
  retryCount?: number;
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
