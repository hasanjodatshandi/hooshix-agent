import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerRestoreFileTool(server: McpServer) {
  server.registerTool("restore_file", {
    title: "Restore File",
    description: "↩️ UNDO — Restore a file to its exact pre-operation state from a backupId returned by write/create/modify/delete.\n\nExample: { \"backupId\": \"550e8400-...\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({ backupId: z.string().uuid(), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
