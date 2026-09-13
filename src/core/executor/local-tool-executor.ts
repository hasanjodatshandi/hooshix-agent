import type { TaskStep } from "../planner/task-planner.js";
import { validateToolName, type ToolName } from "../orchestrator/tool-orchestrator.js";
import { auditToolCall } from "../memory/tool-audit.js";
import { runWithPolicyApproval } from "../governance/policy-decision-point.js";
import { dispatchToHandler } from "./handlers/index.js";

/**
 * Tools whose handler returns a subset of fields that need enrichment
 * to match the MCP tool registration output (used by template resolver).
 */
const FILE_TOOLS_WITH_PATH = new Set<ToolName>([
  "read_file", "write_file", "create_file", "modify_file",
  "delete_file", "restore_file", "list_directory", "search_files",
]);

/**
 * Enrich raw handler result with context fields so template resolver
 * can access {{stepN.output.path}}, {{stepN.output.backupId}}, etc.
 * This makes local executor output consistent with MCP tool output.
 */
function enrichResult(tool: ToolName, args: Record<string, unknown>, raw: unknown): unknown {
  if (raw === undefined || raw === null) return raw;
  // If the handler already returned a rich object, don't override
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    // Already has meaningful fields (backupId, text, etc.) — merge missing context
    if (FILE_TOOLS_WITH_PATH.has(tool) && "path" in args && !("path" in obj)) {
      return { ...obj, path: args.path };
    }
    if (tool === "create_file" && "path" in args && !("path" in obj)) {
      return { ...obj, path: args.path, created: true };
    }
    return raw;
  }
  // read_file returns a string — leave as-is (template resolver doesn't need {{stepN.output.text}})
  // list_directory and search_files return arrays — leave as-is
  return raw;
}

import type { TaskExecutionContext } from "../planner/task-planner.js";

export function createLocalToolExecutor(correlationId: string, taskId?: string, executionContext?: TaskExecutionContext) {
  return async (tool: string, step: TaskStep, signal?: AbortSignal): Promise<unknown> => {
    const validatedTool = validateToolName(tool);
    const input = step.arguments ?? {};
    const raw = await runWithPolicyApproval(validatedTool, () =>
      auditToolCall(tool, correlationId, taskId, () =>
        dispatchToHandler(validatedTool, input, correlationId, executionContext, signal)
      )
    );
    return enrichResult(validatedTool, input, raw);
  };
}












