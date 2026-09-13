import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerCreateFileTool(server: McpServer) {
  server.registerTool("create_file", {
    title: "Create File",
    description: "✏️ WRITE — Create a NEW file; fails if it already exists (use write_file to overwrite). Atomic.\n\nExamples: { \"path\": \"src/utils.ts\", \"content\": \"export function foo() {}\" } · { \"path\": \"D:/Projects/new-file.txt\", \"content\": \"hello\" }",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({ path: z.string(), content: z.string().max(1024 * 1024), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  }, async ({ path, content, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("create_file", traceId, taskId, async () => {
      await createWorkspaceFile(path, content, traceId);
      const flat = { path, created: true };
      return { ...flat, content: [{ type: "text" as const, text: JSON.stringify(flat) }], _meta: { correlationId: traceId } };
    });
  });
}
