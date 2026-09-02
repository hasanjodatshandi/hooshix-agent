import { withAgentDatabase } from "./database.js";

export function saveTaskMemory(input: { id:string; description:string; status:string; correlationId?:string }) {
  withAgentDatabase((db) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO tasks(id, title, description, status, correlation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET description=excluded.description, status=excluded.status,
        correlation_id=COALESCE(excluded.correlation_id, tasks.correlation_id), updated_at=excluded.updated_at
    `).run(input.id, input.description, input.description, input.status, input.correlationId ?? null, now, now);
  });
}

export function saveExecutionMemory(input: { taskId?:string; stepId:number; action:string; result:unknown; status?:"completed"|"failed"; correlationId?:string }) {
  withAgentDatabase((db) => {
    db.prepare(`INSERT INTO executions(task_id, step_id, action, result, status, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`) 
      .run(input.taskId ?? null, input.stepId, input.action, JSON.stringify(input.result), input.status ?? "completed", input.correlationId ?? null, new Date().toISOString());
  });
}

export function saveDecisionMemory(input: { taskId?:string; reason:string; action:string; correlationId?:string }) {
  withAgentDatabase((db) => {
    db.prepare(`INSERT INTO decisions(task_id, reason, action, correlation_id, created_at) VALUES (?, ?, ?, ?, ?)`) 
      .run(input.taskId ?? null, input.reason, input.action, input.correlationId ?? null, new Date().toISOString());
  });
}

export function getExecutionMemory() {
  return withAgentDatabase((db) => db.prepare("SELECT * FROM executions ORDER BY id ASC").all());
}
