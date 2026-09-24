import { withAgentDatabase } from "../../../../../core/memory/database/index.js";
export interface TaskReflectionExecutionRow {
  readonly action: string;
  readonly result: string | null;
  readonly status: string;
}
/** Persistence query only; causal interpretation remains in ReflectionEngine. */
export function readTaskReflectionExecutions(taskId: string): TaskReflectionExecutionRow[] {
  return withAgentDatabase((db) => db.prepare(
    "SELECT action, result, status FROM executions WHERE task_id = ? ORDER BY id"
  ).all(taskId) as TaskReflectionExecutionRow[]);
}
