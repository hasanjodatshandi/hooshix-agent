import type { Task, TaskState } from "../../../domain/task/task.js";
import type { TaskId, IdempotencyKey } from "../../../domain/shared/ids.js";
export interface TaskRepository {
  create(task: Task): Promise<void>;
  get(id: TaskId): Promise<Task | null>;
  list(limit: number): Promise<readonly Task[]>;
  save(task: Task): Promise<void>;
  saveTransition(task: Task, expected: TaskState): Promise<boolean>;
  findByIdempotencyKey(key: IdempotencyKey): Promise<Task | null>;
  findInterruptedTaskIds(): Promise<readonly TaskId[]>;
  updateHeartbeat(id: TaskId, at: string): Promise<void>;
}
