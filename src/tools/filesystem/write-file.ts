import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerWriteFileTool(server: McpServer) {
  server.registerTool("write_file", {
    title: "Write File",
    description: "✏️ WRITE — Overwrite a file with new content (creates or replaces). Atomic; returns backupId for undo. Sensitive files rejected; content ≤1MB. ifMatchSha256 (hex) is a precondition — the write throws STALE_WRITE if the current file hash differs, for read-modify-write safety. idempotencyKey caches the response so a retried write is not re-applied.\n\nExample: { \"path\": \"src/index.ts\", \"content\": \"import ...\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({
      path: z.string(),
      content: z.string().max(1024 * 1024),
      ifMatchSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      idempotencyKey: z.string().min(1).max(200).optional(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
