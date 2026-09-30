import { randomUUID } from "node:crypto";
import type { ExecutionContextFactory } from "../../application/dto/execution-context.js";

/**
 * Infrastructure-owned identity/time factory. Application owns only the DTO.
 * This keeps node:crypto and the system clock outside Domain/Application.
 */
export function createExecutionContextFactory(input?: {
  readonly serviceInstanceId?: string;
  readonly now?: () => string;
  readonly uuid?: () => string;
}): ExecutionContextFactory {
  const uuid = input?.uuid ?? randomUUID;
  const now = input?.now ?? (() => new Date().toISOString());
  const serviceInstanceId = input?.serviceInstanceId ?? uuid();
  return {
    serviceInstanceId,
    create(context) {
      return {
        correlationId: context?.correlationId ?? uuid(),
        taskId: context?.taskId,
        sessionId: context?.sessionId,
        createdAt: context?.createdAt ?? now(),
        instanceId: context?.instanceId ?? serviceInstanceId,
      };
    },
  };
}

export const processExecutionContextFactory = createExecutionContextFactory();
