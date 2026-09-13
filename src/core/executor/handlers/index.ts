import type { ToolHandler } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { FileToolHandler } from "./file-handler.js";
import { GitToolHandler } from "./git-handler.js";
import { PackageToolHandler } from "./package-handler.js";
import { ShellToolHandler } from "./shell-handler.js";
import { SystemToolHandler } from "./system-handler.js";
import { TaskSnapshotToolHandler } from "./task-snapshot-handler.js";

const handlers: ToolHandler[] = [
  new SystemToolHandler(),
  new FileToolHandler(),
  new GitToolHandler(),
  new PackageToolHandler(),
  new ShellToolHandler(),
  new TaskSnapshotToolHandler()
];

const handlerCache = new Map<ToolName, ToolHandler>();

function findHandler(tool: ToolName): ToolHandler {
  const cached = handlerCache.get(tool);
  if (cached) return cached;
  const handler = handlers.find((h) => h.canHandle(tool));
  if (!handler) throw new Error(`No handler for tool: ${tool}`);
  handlerCache.set(tool, handler);
  return handler;
}

import type { TaskExecutionContext } from "../../planner/task-planner.js";

export function dispatchToHandler(tool: ToolName, input: Record<string, unknown>, correlationId: string, executionContext?: TaskExecutionContext, signal?: AbortSignal): Promise<unknown> {
  const handler = findHandler(tool);
  return handler.handle({ tool, input, correlationId, executionContext, signal });
}
