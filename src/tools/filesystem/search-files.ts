import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchWorkspaceFiles } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerSearchFilesTool(server: McpServer) {
  server.registerTool("search_files", {
    title: "Search Files",
    description: "📖 READ — Search text inside workspace files. Returns matching lines with file paths. Case-sensitive; max 1000 results / 10000 files; lines truncated at 512 bytes. Sensitive files (.env, .token, keys, credentials) are always skipped and never appear in results.\n\nExamples: { \"query\": \"TODO\" } · { \"query\": \"function\", \"path\": \"src\" }",
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
      const result = await searchWorkspaceFiles(path, query, traceId);
      const text = result.matches.length === 0
        ? "No matches found"
        : JSON.stringify(result, null, 2);
      return { content: [{ type: "text" as const, text }], _meta: { correlationId: traceId } };
    });
  });
}
