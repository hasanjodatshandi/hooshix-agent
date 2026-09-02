import type { ExecutionContext } from "../runtime/execution-context.js";
import { saveDecisionMemory, saveExecutionMemory, saveTaskMemory } from "../memory/sqlite-memory.js";

export function saveTaskWithContext(input: { id:string; description:string; status:string; context?:ExecutionContext }) {
  saveTaskMemory({ id: input.id, description: input.description, status: input.status, correlationId: input.context?.correlationId });
}

export function saveExecutionWithContext(input: { taskId?:string; stepId:number; action:string; result:unknown; status?:"completed"|"failed"; context?:ExecutionContext }) {
  saveExecutionMemory({ taskId: input.taskId ?? input.context?.taskId, stepId: input.stepId, action: input.action, result: input.result, status: input.status, correlationId: input.context?.correlationId });
}

export function saveDecisionWithContext(input: { taskId?:string; reason:string; action:string; context?:ExecutionContext }) {
  saveDecisionMemory({ taskId: input.taskId, reason: input.reason, action: input.action, correlationId: input.context?.correlationId });
}
