import { withAgentDatabase } from "./database.js";

export function getResumableTasks() {
  return withAgentDatabase((db) => db.prepare(`
    SELECT * FROM tasks
    WHERE status != 'completed'
    ORDER BY updated_at ASC
  `).all());
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
