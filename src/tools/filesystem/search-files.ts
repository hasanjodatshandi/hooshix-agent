import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerSearchFilesTool(server: McpServer) {
  server.registerTool("search_files", {
    title: "Search Files",
    description: "📖 READ — Search text inside workspace files. Returns matching lines with file paths. Case-sensitive; max 1000 results / 10000 files; lines truncated at 512 bytes. Sensitive files (.env, .token, keys, credentials) are always skipped and never appear in results.\n\nExamples: { \"query\": \"TODO\" } · { \"query\": \"function\", \"path\": \"src\" }",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string().default("."),
      query: z.string().min(1),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
