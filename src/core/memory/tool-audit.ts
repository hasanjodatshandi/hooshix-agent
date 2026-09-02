import { withAgentDatabase } from "./database.js";

function record(tool: string, correlationId: string, taskId: string | undefined, status: "success" | "failed"): void {
  withAgentDatabase((db) => db.prepare(`
    INSERT INTO tool_calls(correlation_id, task_id, tool, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(correlationId, taskId ?? null, tool, status, new Date().toISOString()));
}

export async function auditToolCall<T>(
  tool: string,
  correlationId: string,
  taskId: string | undefined,
  operation: () => Promise<T> | T
): Promise<T> {
  try {
    const result = await operation();
    record(tool, correlationId, taskId, "success");
    return result;
  } catch (error) {
    record(tool, correlationId, taskId, "failed");
    throw error;
  }
}
