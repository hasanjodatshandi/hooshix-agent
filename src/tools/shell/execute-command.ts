import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeShellCommand } from "../../services/shell/shell-service.js";
import { getWorkspaceRoot } from "../../security/workspace-guard.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";

export function registerExecuteCommandTool(server: McpServer) {
  server.registerTool("execute_command", {
    title: "Execute Command",
    description: "⚙️ EXECUTE — Run a whitelisted command: node, npm, pnpm, git, python, py, gh. argv-separated (no shell).\n\nSCOPE: cwd defaults to the active workspace; a cwd OUTSIDE the active workspace runs the command against the whole filesystem and REQUIRES APPROVAL (approved task step).\n\nAuto-allowed (read-only): git status/diff/log, gh pr list/view, node --version. Everything else (scripts, npm run, git/gh mutations) requires an approved task step.\n\nExamples: { \"command\": \"git\", \"args\": [\"status\"] } · { \"command\": \"gh\", \"args\": [\"pr\", \"list\"] }\n\ntimeout: ms, default 30000, max 120000.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({
      command: z.enum(["node", "npm", "pnpm", "git", "python", "py", "gh"]),
      args: z.array(z.string()).max(100).default([]),
      cwd: z.string().default("."),
      timeout: z.number().int().min(100).max(120000).default(30000),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async ({ command, args, cwd, timeout, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("execute_command", traceId, taskId, async () => {
      // "." (or unset) means "the active workspace", not the server's process
      // cwd — so a workspace switch keeps direct calls scoped correctly. With
      // the empty-by-default pool, null propagates: executeShellCommand fails
      // closed with "no active workspace".
      const active = getWorkspaceRoot();
      const effectiveCwd = !cwd || cwd === "." ? (active ?? ".") : cwd;
      const result = await executeShellCommand(command, args, effectiveCwd, timeout, traceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], _meta: { correlationId: traceId } };
    });
  });
}
