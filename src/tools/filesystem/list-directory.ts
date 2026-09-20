import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerListDirectoryTool(server: McpServer) {
  server.registerTool("list_directory", {
    title: "List Directory",
    description: "📖 READ — List a directory: one entry per line, `[DIR]`/`[FILE]` prefix. Max 5000 entries.\n\nExamples: { \"path\": \".\" } · { \"path\": \"src\" } — relative to the active workspace.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string().default("."),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
