/** R1 compatibility facade; remove after legacy core imports migrate. */
import type { ExecutionContext } from "../../application/dto/execution-context.js";
import { processExecutionContextFactory } from "../../infrastructure/composition/execution-context-factory.js";

export type { ExecutionContext };
export const serviceInstanceId = processExecutionContextFactory.serviceInstanceId;
export function createExecutionContext(input?: Partial<ExecutionContext>): ExecutionContext {
  return processExecutionContextFactory.create(input);
}
