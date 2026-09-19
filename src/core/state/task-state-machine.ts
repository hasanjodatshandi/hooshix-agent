/** R1 compatibility facade; implementation is now pure Domain. */
export {
  canTransition,
  transitionTask,
} from "../../domain/task/legacy-task-state-machine.js";
export type {
  LegacyTaskState,
  TaskState,
} from "../../domain/task/legacy-task-state-machine.js";
