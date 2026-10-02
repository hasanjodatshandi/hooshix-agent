import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { PACKAGE_MANAGERS } from "../../application/services/package-managers.js";
type PackageAction = "install" | "remove" | "update";

const schema = z.object({
  manager: z.enum(PACKAGE_MANAGERS),
  name: z.string().min(1).max(214),
  cwd: z.string().default("."),
  timeout: z.number().int().min(1000).max(600000).default(300000),
  correlationId: z.string().min(1).optional(),
  taskId: z.string().optional()
});

function register(server: McpServer, tool: "install_package" | "remove_package" | "update_package", action: PackageAction) {
  const title = action[0].toUpperCase() + action.slice(1) + " Package";
  const desc = `📦 PACKAGE (${action}, needs approval) — ${action.charAt(0).toUpperCase() + action.slice(1)} a package. Managers: ${PACKAGE_MANAGERS.join(" · ")}. System-level managers (winget, choco, apt, dnf, pacman, zypper) require ADMIN_MODE.\n\nExamples: { \"manager\": \"npm\", \"name\": \"lodash\" } · { \"manager\": \"cargo\", \"name\": \"ripgrep\" }\n\nReturns snapshotId + verification result. Verification is SKIPPED (verificationSkipped: true) for managers with no verification command (go, maven). cwd/timeout optional (timeout 1000-600000ms, default 300000).`;
  server.registerTool(tool, {
    title,
    description: desc,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: schema
  }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}

export function registerPackageTools(server: McpServer) {
  register(server, "install_package", "install");
  register(server, "remove_package", "remove");
  register(server, "update_package", "update");
}
