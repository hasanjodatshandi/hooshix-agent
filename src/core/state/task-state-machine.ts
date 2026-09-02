export type TaskState =
  | "created"
  | "planning"
  | "executing"
  | "verifying"
  | "completed"
  | "failed";

const transitions: Record<TaskState, TaskState[]> = {
  created: ["planning"],
  planning: ["executing", "failed"],
  executing: ["verifying", "failed"],
  verifying: ["completed", "failed"],
  completed: [],
  failed: []
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
