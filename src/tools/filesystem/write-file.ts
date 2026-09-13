import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerWriteFileTool(server: McpServer) {
  server.registerTool("write_file", {
    title: "Write File",
    description: "✏️ WRITE — Overwrite a file with new content (creates or replaces). Atomic; returns backupId for undo. Sensitive files rejected; content ≤1MB.\n\nExample: { \"path\": \"src/index.ts\", \"content\": \"import ...\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({
      path: z.string(),
      content: z.string().max(1024 * 1024),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ path, content, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("write_file", traceId, taskId, async () => {
      const result = await writeWorkspaceFile(path, content, traceId);
      const flat = { path, ...result };
      return { ...flat, content: [{ type: "text" as const, text: JSON.stringify(flat) }], _meta: { correlationId: traceId } };
    });
  });
}
