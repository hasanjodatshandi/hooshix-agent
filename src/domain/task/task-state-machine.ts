/**
 * Canonical Task state machine — the single authority on legal Task lifecycle
 * transitions. Pure domain behavior (no I/O/framework imports).
 *
 * R3 convergence: the legacy transitional states were folded onto the canonical
 * aggregate by migration 20 (`consolidate-canonical-task-states`):
 *
 *   legacy `created`       -> `planning`    (the plan factory now starts here)
 *   legacy `checkpointing` -> `executing`   (was a lightweight per-step marker)
 *   legacy `resuming`      -> `executing`   (was the resume entry state)
 *
 * Nothing may reintroduce those values; `TaskState` is the sole union.
 */
import type { TaskState } from "./task.js";
export type { TaskState };

const transitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  planning: ["waiting_approval", "executing", "failed", "cancelled"],
  ready: ["executing", "cancelled"],
  waiting_approval: ["executing", "failed", "cancelled"],
  executing: ["waiting_approval", "recovering", "verifying", "failed", "cancelled"],
  reconciling: ["executing", "planning", "failed", "cancelled"],
  recovering: ["executing", "waiting_approval", "failed", "cancelled"],
  verifying: ["executing", "completed", "recovering", "failed", "cancelled"],
  completed: ["planning"],
  failed: ["executing", "cancelled", "planning"],
  cancelled: ["planning"],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return transitions[from].includes(to);
}

export function transitionTask(from: TaskState, to: TaskState): TaskState {
  if (!canTransition(from, to)) throw new Error(`Invalid transition ${from} -> ${to}`);
  return to;
}
