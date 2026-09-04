import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerCreateFileTool(server: McpServer) {
  server.registerTool("create_file", {
    title: "Create File",
    description: "Create a new file without overwriting an existing file. Fails if file already exists.\n\nExamples:\n  path: src/utils.ts, content: export function foo() {}\n  path: D:/Projects/new-file.txt, content: hello\n\nUse write_file to overwrite existing files. Supports absolute paths.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({ path: z.string(), content: z.string().max(1024 * 1024), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  }, async ({ path, content, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("create_file", traceId, taskId, async () => {
      await createWorkspaceFile(path, content, traceId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ path, created: true }) }], _meta: { correlationId: traceId } };
    });
  });
}
