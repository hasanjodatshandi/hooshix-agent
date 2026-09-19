import type { CorrelationId, SessionId, TaskId } from "../../domain/shared/ids.js";

export interface ExecutionContext {
  correlationId: CorrelationId | string;
  taskId?: TaskId | string;
  sessionId?: SessionId | string;
  createdAt: string;
  instanceId?: string;
}

export interface ExecutionContextFactory {
  readonly serviceInstanceId: string;
  create(input?: Partial<ExecutionContext>): ExecutionContext;
}
