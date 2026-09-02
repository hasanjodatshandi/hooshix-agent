import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeShellCommand } from "../../services/shell/shell-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerExecuteCommandTool(server: McpServer) {
  server.registerTool("execute_command", {
    title: "Execute Command",
    description: "Execute an allowed development command without a system shell",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({
      command: z.enum(["node", "npm", "pnpm", "git", "python", "py", "powershell"]),
      args: z.array(z.string()).max(100).default([]),
      cwd: z.string().default("."),
      timeout: z.number().int().min(100).max(120000).default(30000),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ command, args, cwd, timeout, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("execute_command", traceId, taskId, async () => {
      const result = await executeShellCommand(command, args, cwd, timeout, traceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], _meta: { correlationId: traceId } };
    });
  });
}
