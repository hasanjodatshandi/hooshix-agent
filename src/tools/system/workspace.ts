import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registrations. Workspace state changes occur behind R2 gateway. */
export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "set_workspace",
    {
      title: "Set Workspace",
      description: "📂 WORKSPACE — Select the ACTIVE workspace from the allowed roots pool. Does NOT add or remove roots — the path must already be allowed (add it with add_workspace_roots first). File tools operate in the active workspace only — this tool cannot and will never expand that scope.\n\nExample: { \"path\": \"D:/Projects/my-app\" }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.strictObject({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
  server.registerTool(
    "get_workspace",
    {
      title: "Get Workspace",
      description: "📂 WORKSPACE — Show the active workspace and all allowed roots.\n\nExample: {}",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
  server.registerTool(
    "add_workspace_roots",
    {
      title: "Add Workspace Roots",
      description: "📂 WORKSPACE — Add one or more directories to the persistent allowed workspace roots pool (idempotent). Roots must exist on disk. Allowed roots survive service restarts; the active workspace is session state and may reset to null after restart. Does NOT switch the active workspace — use set_workspace for that.\n\nExample: { \"paths\": [\"D:/Projects/app-a\", \"D:/Projects/app-b\"] }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(50).describe("Absolute directory paths to allow."),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
  server.registerTool(
    "remove_workspace_root",
    {
      title: "Remove Workspace Root",
      description: "📂 WORKSPACE — Remove a directory from the allowed roots pool. The ACTIVE workspace cannot be removed (file tools operate there) — select another allowed root with set_workspace first.\n\nExample: { \"path\": \"D:/Projects/old-project\" }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
}
