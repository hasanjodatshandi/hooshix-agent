import type { ToolName } from "../../orchestrator/tool-orchestrator.js";

export interface ToolHandlerContext {
  tool: ToolName;
  input: Record<string, unknown>;
  correlationId: string;
}

export interface ToolHandler {
  canHandle(tool: ToolName): boolean;
  handle(context: ToolHandlerContext): Promise<unknown>;
}
