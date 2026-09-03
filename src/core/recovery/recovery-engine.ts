import type { TaskStep } from "../planner/task-planner.js";
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
