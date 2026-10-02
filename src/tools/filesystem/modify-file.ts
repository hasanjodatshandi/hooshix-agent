import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerModifyFileTool(server: McpServer) {
  server.registerTool("modify_file", {
    title: "Modify File",
    description: "✏️ WRITE — Find & replace text in a file: replaces ALL literal occurrences (no regex). Returns backupId + replacedOccurrences. Read the file first to get the exact search string. ifMatchSha256 (hex) is a precondition — the edit throws STALE_WRITE if the current file hash differs, for read-modify-write safety.\n\nExample: { \"path\": \"src/index.ts\", \"search\": \"old name\", \"replacement\": \"new name\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({
      path: z.string(),
      search: z.string().min(1).max(1024 * 1024),
      replacement: z.string().max(1024 * 1024),
      ifMatchSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
