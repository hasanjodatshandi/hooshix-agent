import { saveExecutionMemory as saveExecution } from "./sqlite-memory.js";
import { withAgentDatabase } from "./database.js";

export function saveExecutionMemory(input: {
  taskId?: string;
  stepId: number;
  action: string;
  result: unknown;
  correlationId?: string;
}) {
  saveExecution(input);
}

export function findExecutionsByCorrelationId(correlationId: string) {
  return withAgentDatabase((db) => db.prepare("SELECT * FROM executions WHERE correlation_id = ? ORDER BY id").all(correlationId));
}
