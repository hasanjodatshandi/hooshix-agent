import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listWorkspaceDirectory } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerListDirectoryTool(server: McpServer) {
  server.registerTool("list_directory", {
    title: "List Directory",
    description: "List files and directories inside the HooshiX workspace",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string().default("."),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("list_directory", traceId, taskId, async () => {
      const entries = await listWorkspaceDirectory(path, traceId);
      return { content: [{ type: "text" as const, text: entries.join("\n") }], _meta: { correlationId: traceId } };
    });
  });
}
