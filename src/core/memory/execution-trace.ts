import { withAgentDatabase } from "./database.js";

export interface ExecutionTraceEvent {
  id: string;
  correlationId: string;
  taskId?: string;
  source: "runtime" | "tool" | "governance" | "checkpoint";
  type: string;
  timestamp: string;
  payload: unknown;
  /** @deprecated Use payload. */
  data?: unknown;
}

function deserializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...row };
  for (const field of ["result", "state"]) {
    if (typeof normalized[field] !== "string") continue;
    try {
      normalized[field] = JSON.parse(normalized[field] as string);
    } catch {
      // Preserve legacy or corrupted values for audit instead of hiding the row.
    }
  }
  return normalized;
}

export function getExecutionTrace(correlationId: string): ExecutionTraceEvent[] {
  return withAgentDatabase((db) => {
    const events: ExecutionTraceEvent[] = [];
    const addRows = (source: ExecutionTraceEvent["source"], type: string, rows: Array<Record<string, unknown>>, preferUpdated = false) => {
      for (const [index, row] of rows.entries()) {
        const timestamp = preferUpdated ? row.updated_at ?? row.created_at : row.created_at ?? row.updated_at;
        if (typeof timestamp === "string") {
          const payload = deserializeRow(row);
          events.push({
            id: `${type}:${String(row.id ?? index)}`,
            correlationId,
            taskId: typeof row.task_id === "string" ? row.task_id : type === "task" && typeof row.id === "string" ? row.id : undefined,
            source,
            type,
            timestamp,
            payload,
            data: payload
          });
        }
      }
    };
    addRows("runtime", "task", db.prepare("SELECT * FROM tasks WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>, true);
    addRows("runtime", "execution", db.prepare("SELECT * FROM executions WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("governance", "decision", db.prepare("SELECT * FROM decisions WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("checkpoint", "checkpoint", db.prepare("SELECT * FROM agent_checkpoints WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("governance", "approval", db.prepare("SELECT * FROM approval_requests WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("tool", "tool_call", db.prepare("SELECT * FROM tool_calls WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  });
}
