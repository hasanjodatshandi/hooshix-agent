import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerReadFileTool(server: McpServer) {
  server.registerTool("read_file", {
    title: "Read File",
    description: "📖 READ — Read a file's text content. Sensitive files (.env, .token, keys) always rejected; files >1MB rejected.\n\nExamples: { \"path\": \"src/index.ts\" } · { \"path\": \"D:/Projects/my-api/src/index.ts\" } — relative paths resolve against the active workspace.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("read_file", traceId, taskId, async () => {
      const result = await readWorkspaceFile(path, traceId);
      const fileContent = typeof result === "string" ? result : result.content;
      return {
        path, text: fileContent, length: fileContent.length,
        content: [{ type: "text" as const, text: fileContent }],
        _meta: { correlationId: traceId }
      };
    });
  });
}
