import type { TaskStep } from "../planner/task-planner.js";
import type { ExecutionContext } from "../runtime/execution-context.js";
import type { ToolName } from "./tool-orchestrator.js";

export interface McpToolInvoker {
  callTool(name: ToolName, args: Record<string, unknown>): Promise<unknown>;
}

export function createMcpToolExecutor(invoker: McpToolInvoker, context?: ExecutionContext) {
  return async (tool: string, step: TaskStep) => {
    const result = await invoker.callTool(tool as ToolName, {
      ...step.arguments,
      correlationId: context?.correlationId ?? crypto.randomUUID(),
      taskId: context?.taskId
    });
    if (result && typeof result === "object" && "isError" in result && result.isError === true) {
      const content = "content" in result && Array.isArray(result.content)
        ? result.content.map((item) => item && typeof item === "object" && "text" in item ? String(item.text) : "").filter(Boolean).join("\n")
        : "";
      throw new Error(content || `MCP tool failed: ${tool}`);
    }
    return result;
  };
}

