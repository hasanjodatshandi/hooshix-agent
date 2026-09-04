import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { managePackage, type PackageAction } from "../../services/package/package-service.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";

const schema = z.object({
  manager: z.enum(["npm", "pnpm", "pip", "winget", "choco"]),
  name: z.string().min(1).max(214),
  cwd: z.string().default("."),
  timeout: z.number().int().min(1000).max(600000).default(300000),
  correlationId: z.string().min(1).optional(),
  taskId: z.string().optional()
});

function register(server: McpServer, tool: "install_package" | "remove_package" | "update_package", action: PackageAction) {
  const title = action[0].toUpperCase() + action.slice(1) + " Package";
  const desc = action + " a package with npm, pnpm, pip, winget, or Chocolatey.\n\nManagers (\"manager\" field):\n  \"npm\"    — Node.js packages. Example: { \"manager\": \"npm\", \"name\": \"lodash\" }\n  \"pnpm\"   — PNPM packages. Example: { \"manager\": \"pnpm\", \"name\": \"express\" }\n  \"pip\"    — Python packages. Example: { \"manager\": \"pip\", \"name\": \"requests\" }\n  \"winget\" — Windows packages. Example: { \"manager\": \"winget\", \"name\": \"Git.Git\" }\n  \"choco\"  — Chocolatey packages. Example: { \"manager\": \"choco\", \"name\": \"nodejs\" }\n\nOptional: cwd (default \".\"), timeout (default 300000ms, max 600000ms).";
  server.registerTool(tool, {
    title,
    description: desc,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: schema
  }, async ({ manager, name, cwd, timeout, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall(tool, traceId, taskId, async () => {
      const value = await managePackage({ manager, action, name, cwd, timeout, correlationId: traceId });
      return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], _meta: { correlationId: traceId } };
    });
  });
}

export function registerPackageTools(server: McpServer) {
  register(server, "install_package", "install");
  register(server, "remove_package", "remove");
  register(server, "update_package", "update");
}
