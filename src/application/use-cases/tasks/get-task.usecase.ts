import type { Task } from "../../../domain/task/task.js";
import type { TaskId } from "../../../domain/shared/ids.js";
import type { TaskRepository } from "../../ports/outbound/task-repository.port.js";
export function createGetTaskUseCase(tasks: TaskRepository): { execute(id: TaskId): Promise<Task | null> } {
 return { execute(id) { return tasks.get(id); } };
}
