import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only MCP registrar. Process dispatch is available exclusively via R2 gateway. */
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
  }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
