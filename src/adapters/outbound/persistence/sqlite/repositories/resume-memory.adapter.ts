import { withAgentDatabase } from "../../../../../core/memory/database/index.js";
import { getTaskPlan } from "./task-repository.adapter.js";
import type { TaskPlan } from "../../../../../application/dto/legacy-task-plan.js";

/** Return canonical aggregates, never raw incomplete task table rows. */
export function getResumableTasks():TaskPlan[] {
  const ids=withAgentDatabase(db=>db.prepare(`
    SELECT id FROM tasks WHERE status != 'completed' ORDER BY updated_at ASC
  `).all() as Array<{id:string}>);
  return ids.map(row=>getTaskPlan(row.id)).filter((plan):plan is TaskPlan=>plan!==null);
}

export function getTaskExecutions(taskId: string) {
  return withAgentDatabase((db) => db.prepare(`
    SELECT * FROM executions
    WHERE task_id = ?
    ORDER BY executions.id ASC
  `).all(taskId));
}

export function getResumePoint(taskId: string) {
  const row = withAgentDatabase((db) => db.prepare(`
    SELECT * FROM agent_checkpoints
    WHERE task_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(taskId) as { state?: string } | undefined);
  if (!row?.state) return null;
  try {
    const state = JSON.parse(row.state) as { status?: string };
    return state.status === "completed" ? null : row;
  } catch {
    return null;
  }
}