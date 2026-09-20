import type { ToolHandler } from "./tool-handler.js";
import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import type { TaskExecutionContext } from "../../../application/dto/legacy-task-plan.js";

/** Pure dispatcher factory: concrete handlers are constructed in composition only. */
export function createHandlerDispatcher(handlers: readonly ToolHandler[]) {
  const cache = new Map<ToolName, ToolHandler>();
  return function dispatchToHandler(
    tool: ToolName,
    input: Record<string, unknown>,
    correlationId: string,
    executionContext?: TaskExecutionContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let handler = cache.get(tool);
    if (!handler) {
      handler = handlers.find(candidate => candidate.canHandle(tool));
      if (!handler) throw new Error(`No handler for tool: ${tool}`);
      cache.set(tool, handler);
    }
    return handler.handle({ tool, input, correlationId, executionContext, signal });
  };
}