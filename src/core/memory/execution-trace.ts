import { withAgentDatabase } from "./database.js";

export interface ExecutionTraceEvent {
  type: string;
  timestamp: string;
  data: unknown;
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
    const addRows = (type: string, rows: Array<Record<string, unknown>>, preferUpdated = false) => {
      for (const row of rows) {
        const timestamp = preferUpdated ? row.updated_at ?? row.created_at : row.created_at ?? row.updated_at;
        if (typeof timestamp === "string") events.push({ type, timestamp, data: deserializeRow(row) });
      }
    };
    addRows("task", db.prepare("SELECT * FROM tasks WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>, true);
    addRows("execution", db.prepare("SELECT * FROM executions WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("decision", db.prepare("SELECT * FROM decisions WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("checkpoint", db.prepare("SELECT * FROM agent_checkpoints WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("approval", db.prepare("SELECT * FROM approval_requests WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    addRows("tool_call", db.prepare("SELECT * FROM tool_calls WHERE correlation_id = ?").all(correlationId) as Array<Record<string, unknown>>);
    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  });
}
