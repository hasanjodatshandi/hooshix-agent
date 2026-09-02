import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { restoreWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerRestoreFileTool(server: McpServer) {
  server.registerTool("restore_file", {
    title: "Restore File",
    description: "Restore a file from a backup ID returned by write, modify, or delete",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({ backupId: z.string().uuid(), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  }, async ({ backupId, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("restore_file", traceId, taskId, async () => {
      await restoreWorkspaceFile(backupId, traceId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ backupId, restored: true }) }], _meta: { correlationId: traceId } };
    });
  });
}
