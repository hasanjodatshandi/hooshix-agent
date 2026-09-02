import { randomUUID } from "node:crypto";

export interface ExecutionContext {
  correlationId: string;
  taskId?: string;
  sessionId?: string;
  createdAt: string;
}

export function createExecutionContext(input?: Partial<ExecutionContext>): ExecutionContext {
  return {
    correlationId: input?.correlationId ?? randomUUID(),
    taskId: input?.taskId,
    sessionId: input?.sessionId,
    createdAt: input?.createdAt ?? new Date().toISOString()
  };
}
