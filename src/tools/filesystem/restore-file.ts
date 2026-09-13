import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { restoreWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerRestoreFileTool(server: McpServer) {
  server.registerTool("restore_file", {
    title: "Restore File",
    description: "↩️ UNDO — Restore a file to its exact pre-operation state from a backupId returned by write/create/modify/delete.\n\nExample: { \"backupId\": \"550e8400-...\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({ backupId: z.string().uuid(), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  }, async ({ backupId, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("restore_file", traceId, taskId, async () => {
      const result = await restoreWorkspaceFile(backupId, traceId);
      const flat = { backupId, restored: true, path: result.path, displacedBackupId: result.displacedBackupId ?? null };
      return { ...flat, content: [{ type: "text" as const, text: JSON.stringify(flat) }], _meta: { correlationId: traceId } };
    });
  });
}
