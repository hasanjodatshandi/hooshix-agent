import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerReadFileTool(server: McpServer) {
  server.registerTool("read_file", {
    title: "Read File",
    description: "Read a file and return its content as text.\n\nPaths:\n  - Relative: { \"path\": \"src/index.ts\" } (relative to workspace)\n  - Absolute: { \"path\": \"D:/Projects/my-api/src/index.ts\" }\n  - Parent: { \"path\": \"../other-project/file.ts\" }\n\nUse set_workspace first to change the working directory. Absolute paths work if within configured workspace roots.",
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
