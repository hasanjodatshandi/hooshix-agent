export type TaskState =
  | "created"
  | "planning"
  | "waiting_approval"
  | "executing"
  | "checkpointing"
  | "recovering"
  | "resuming"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

const transitions: Record<TaskState, TaskState[]> = {
  created: ["planning", "cancelled"],
  planning: ["waiting_approval", "executing", "failed", "cancelled"],
  waiting_approval: ["resuming", "failed", "cancelled"],
  executing: ["checkpointing", "waiting_approval", "recovering", "verifying", "failed", "cancelled"],
  checkpointing: ["executing", "waiting_approval", "recovering", "verifying", "failed", "cancelled"],
  recovering: ["executing", "waiting_approval", "failed", "cancelled"],
  resuming: ["executing", "recovering", "failed", "cancelled"],
  verifying: ["completed", "recovering", "failed", "cancelled"],
  completed: [],
  failed: ["resuming", "cancelled"],
  cancelled: []
};

export function canTransition(from: TaskState, to: TaskState) {
  return transitions[from].includes(to);
}

export function transitionTask(from: TaskState, to: TaskState) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition ${from} -> ${to}`);
  }

  return to;
}
