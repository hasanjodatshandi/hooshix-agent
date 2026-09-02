import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchWorkspaceFiles } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerSearchFilesTool(server: McpServer) {
  server.registerTool("search_files", {
    title: "Search Files",
    description: "Search text inside workspace files",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string().default("."),
      query: z.string().min(1),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ path, query, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("search_files", traceId, taskId, async () => {
      const results = await searchWorkspaceFiles(path, query, traceId);
      return { content: [{ type: "text" as const, text: results.join("\n") || "No matches found" }], _meta: { correlationId: traceId } };
    });
  });
}
