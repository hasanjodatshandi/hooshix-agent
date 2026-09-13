import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import type { TaskExecutionContext } from "../../planner/task-planner.js";

export interface ToolHandlerContext {
  tool: ToolName;
  input: Record<string, unknown>;
  correlationId: string;
  executionContext?: TaskExecutionContext;
  signal?: AbortSignal;
}

export interface ToolHandler {
  canHandle(tool: ToolName): boolean;
  handle(context: ToolHandlerContext): Promise<unknown>;
}
