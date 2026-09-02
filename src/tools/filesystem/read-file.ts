import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerReadFileTool(server: McpServer) {
  server.registerTool("read_file", {
    title: "Read File",
    description: "Read a file inside the HooshiX workspace",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("read_file", traceId, taskId, async () => ({
      content: [{ type: "text", text: await readWorkspaceFile(path, traceId) }],
      _meta: { correlationId: traceId }
    }));
  });
}
