import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerDeleteFileTool(server: McpServer) {
  server.registerTool("delete_file", {
    title: "Delete File",
    description: "Delete a file after saving a recoverable backup. Use the returned backupId with restore_file to undo.\n\nExamples:\n  { \"tool\": \"delete_file\", \"arguments\": { \"path\": \"old-file.ts\" } }\n  { \"tool\": \"delete_file\", \"arguments\": { \"path\": \"D:/Projects/obsolete.ts\" } }\n\nIMPORTANT: This tool requires approval through a task step. Direct calls will fail.\nReturns: { backupId: \"uuid\" } - use with restore_file to undo.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({ path: z.string(), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  }, async ({ path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("delete_file", traceId, taskId, async () => {
      const result = await deleteWorkspaceFile(path, traceId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ path, deleted: true, ...result }) }], _meta: { correlationId: traceId } };
    });
  });
}
