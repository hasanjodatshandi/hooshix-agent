import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeShellCommand } from "../../services/shell/shell-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerExecuteCommandTool(server: McpServer) {
  server.registerTool("execute_command", {
    title: "Execute Command",
    description: "Execute an allowed development command without a system shell. Only whitelisted commands are permitted.\n\nAllowed commands (command field):\n  node — Run Node.js scripts. Example: { command: node, args: [-e, console.log(hi)] }\n  npm — NPM package manager. Example: { command: npm, args: [install, lodash] }\n  pnpm — PNPM package manager. Example: { command: pnpm, args: [run, build] }\n  git — Git version control. Example: { command: git, args: [log, --oneline, -5] }\n  python — Python 3 interpreter. Example: { command: python, args: [-c, print(hi)] }\n  py — Python alias (Windows). Same as python.\n  powershell — PowerShell (Windows). Example: { command: powershell, args: [Get-Date] }\n\nOptional: cwd (default .), timeout (default 30000ms, max 120000ms).",
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
