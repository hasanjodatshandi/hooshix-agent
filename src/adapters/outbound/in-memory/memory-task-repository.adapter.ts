import type { Task, TaskState } from "../../../domain/task/task.js";
import type { TaskId, IdempotencyKey } from "../../../domain/shared/ids.js";
import type { TaskRepository } from "../../../application/ports/outbound/task-repository.port.js";
/** In-memory fake is test/bootstrap-only, not a substitute for durable persistence. */
export function createMemoryTaskRepository(): TaskRepository {
 const tasks = new Map<TaskId,Task>();
 return {
   async create(task) { if (tasks.has(task.id)) throw new Error("duplicate_task_id"); tasks.set(task.id, structuredClone(task)); },
   async get(id) { const task = tasks.get(id); return task ? structuredClone(task) : null; },
   async list(limit) { return [...tasks.values()].slice(0,limit).map(t=>structuredClone(t)); },
   async save(task) { if(!tasks.has(task.id)) throw new Error("task_not_found"); tasks.set(task.id,structuredClone(task)); },
   async saveTransition(task: Task, expected: TaskState) { const current=tasks.get(task.id); if (!current || current.state!==expected) return false; tasks.set(task.id,structuredClone(task));return true; },
   async findByIdempotencyKey(key: IdempotencyKey) { const t=[...tasks.values()].find(x=>x.idempotency?.key===key);return t ? structuredClone(t) : null; },
   async findInterruptedTaskIds() { return [...tasks.values()].filter(t=>t.state==="executing"||t.state==="recovering").map(t=>t.id); },
   async updateHeartbeat(id: TaskId) { if(!tasks.has(id)) throw new Error("task_not_found"); },
 };
}
