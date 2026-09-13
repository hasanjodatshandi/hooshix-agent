import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerDeleteFileTool(server: McpServer) {
  server.registerTool("delete_file", {
    title: "Delete File",
    description: "🗑️ DELETE — Delete a file after saving a recoverable backup. Requires approval (task step). Sensitive files and files >1MB rejected.\n\nExample: { \"path\": \"old-file.ts\" } → { backupId } — undo with restore_file.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({ path: z.string(), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  }, async ({ path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("delete_file", traceId, taskId, async () => {
      const result = await deleteWorkspaceFile(path, traceId);
      const flat = { path, deleted: true, ...result };
      return { ...flat, content: [{ type: "text" as const, text: JSON.stringify(flat) }], _meta: { correlationId: traceId } };
    });
  });
}
