import type { ExecutionContext } from "../runtime/execution-context.js";
import { saveCheckpoint } from "../memory/checkpoint-memory.js";

export function checkpointStep(input: {
  taskId: string;
  stepId: number;
  stepIndex: number;
  status: string;
  context?: ExecutionContext;
  correlationId?: string;
}) {
  saveCheckpoint({
    taskId: input.taskId,
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    state: {
      status: input.status
    },
    correlationId: input.context?.correlationId ?? input.correlationId
  });
}


