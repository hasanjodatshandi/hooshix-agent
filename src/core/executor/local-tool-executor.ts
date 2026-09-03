import type { TaskStep } from "../planner/task-planner.js";
import { validateToolName } from "../orchestrator/tool-orchestrator.js";
import { auditToolCall } from "../memory/tool-audit.js";
import { runWithPolicyApproval } from "../governance/policy-decision-point.js";
import { dispatchToHandler } from "./handlers/index.js";

export function createLocalToolExecutor(correlationId: string, taskId?: string) {
  return async (tool: string, step: TaskStep): Promise<unknown> => {
    const validatedTool = validateToolName(tool);
    const input = step.arguments ?? {};
    return runWithPolicyApproval(validatedTool, () =>
      auditToolCall(tool, correlationId, taskId, () =>
        dispatchToHandler(validatedTool, input, correlationId)
      )
    );
  };
}






