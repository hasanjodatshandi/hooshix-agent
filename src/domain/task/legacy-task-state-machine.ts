/**
 * Compatibility state machine for the currently shipped Task runtime.
 * It is pure domain behavior (no I/O/framework imports).
 *
 * R3 owns convergence from these legacy transitional states
 * (created/checkpointing/resuming) to the canonical final Task aggregate.
 */
export type LegacyTaskState =
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

export type TaskState = LegacyTaskState;

const transitions: Readonly<Record<LegacyTaskState, readonly LegacyTaskState[]>> = {
  created: ["planning", "cancelled"],
  planning: ["waiting_approval", "executing", "failed", "cancelled"],
  waiting_approval: ["resuming", "failed", "cancelled"],
  executing: ["checkpointing", "waiting_approval", "recovering", "verifying", "failed", "cancelled"],
  checkpointing: ["executing", "waiting_approval", "recovering", "verifying", "failed", "cancelled"],
  recovering: ["executing", "waiting_approval", "failed", "cancelled"],
  resuming: ["executing", "recovering", "failed", "cancelled", "planning"],
  verifying: ["executing", "completed", "recovering", "failed", "cancelled"],
  completed: ["planning"],
  failed: ["resuming", "cancelled", "planning"],
  cancelled: ["planning"],
};

export function canTransition(from: LegacyTaskState, to: LegacyTaskState): boolean {
  return transitions[from].includes(to);
}

export function transitionTask(from: LegacyTaskState, to: LegacyTaskState): LegacyTaskState {
  if (!canTransition(from, to)) throw new Error(`Invalid transition ${from} -> ${to}`);
  return to;
}
