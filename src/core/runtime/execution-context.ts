import { randomUUID } from "node:crypto";

export interface ExecutionContext {
  correlationId: string;
  taskId?: string;
  sessionId?: string;
  createdAt: string;
  instanceId?: string;
}

export const serviceInstanceId = randomUUID();

export function createExecutionContext(input?: Partial<ExecutionContext>): ExecutionContext {
  return {
    correlationId: input?.correlationId ?? randomUUID(),
    taskId: input?.taskId,
    sessionId: input?.sessionId,
    createdAt: input?.createdAt ?? new Date().toISOString(),
    instanceId: input?.instanceId ?? serviceInstanceId
  };
}
