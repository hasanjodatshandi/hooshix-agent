import { withAgentDatabase } from "./database.js";

export function saveCheckpoint(input: {
  taskId: string;
  stepId: number;
  stepIndex: number;
  state: unknown;
  correlationId?: string;
}) {
  withAgentDatabase((db) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO agent_checkpoints
      (task_id, step_id, step_index, state, correlation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.taskId, input.stepId, input.stepIndex, JSON.stringify(input.state), input.correlationId ?? null, now, now);
  });
}

export function getLatestCheckpoint(taskId: string) {
  return withAgentDatabase((db) => db.prepare(`
      SELECT * FROM agent_checkpoints
      WHERE task_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(taskId));
}
