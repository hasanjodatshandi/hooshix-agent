import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import type { TaskExecutionContext } from "../../../application/dto/legacy-task-plan.js";

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
