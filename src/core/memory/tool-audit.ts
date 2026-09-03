import { withAgentDatabase } from "./database.js";

function record(tool: string, correlationId: string, taskId: string | undefined, status: "success" | "failed", startedAt: string, durationMs: number, error?: unknown): void {
  withAgentDatabase((db) => db.prepare(`
    INSERT INTO tool_calls(correlation_id, task_id, tool, status, created_at, completed_at, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(correlationId, taskId ?? null, tool, status, startedAt, new Date().toISOString(), durationMs,
    error instanceof Error ? error.name : error === undefined ? null : "UnknownError"));
}

export async function auditToolCall<T>(
  tool: string,
  correlationId: string,
  taskId: string | undefined,
  operation: () => Promise<T> | T
): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const result = await operation();
    record(tool, correlationId, taskId, "success", startedAt, Math.max(0, Math.round(performance.now() - started)));
    return result;
  } catch (error) {
    record(tool, correlationId, taskId, "failed", startedAt, Math.max(0, Math.round(performance.now() - started)), error);
    throw error;
  }
}
