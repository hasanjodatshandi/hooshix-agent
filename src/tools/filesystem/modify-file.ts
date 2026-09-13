import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { modifyWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerModifyFileTool(server: McpServer) {
  server.registerTool("modify_file", {
    title: "Modify File",
    description: "✏️ WRITE — Find & replace text in a file: replaces ALL literal occurrences (no regex). Returns backupId + replacedOccurrences. Read the file first to get the exact search string.\n\nExample: { \"path\": \"src/index.ts\", \"search\": \"old name\", \"replacement\": \"new name\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({
      path: z.string(),
      search: z.string().min(1).max(1024 * 1024),
      replacement: z.string().max(1024 * 1024),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ path, search, replacement, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("modify_file", traceId, taskId, async () => {
      const result = await modifyWorkspaceFile(path, search, replacement, traceId);
      const flat = { path, ...result };
      return { ...flat, content: [{ type: "text" as const, text: JSON.stringify(flat) }], _meta: { correlationId: traceId } };
    });
  });
}
