import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerDeleteFileTool(server: McpServer) {
  server.registerTool("delete_file", {
    title: "Delete File",
    description: "🗑️ DELETE — Delete a file after saving a recoverable backup. Requires approval (task step). Sensitive files and files >1MB rejected.\n\nExample: { \"path\": \"old-file.ts\" } → { backupId } — undo with restore_file.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({ path: z.string(), idempotencyKey: z.string().min(1).max(200).optional(), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
