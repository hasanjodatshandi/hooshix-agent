import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerReadFileTool(server: McpServer) {
  server.registerTool("read_file", {
    title: "Read File",
    description: "📖 READ — Read a file's text content. Sensitive files (.env, .token, keys) always rejected; files >1MB rejected.\n\nExamples: { \"path\": \"src/index.ts\" } · { \"path\": \"D:/Projects/my-api/src/index.ts\" } — relative paths resolve against the active workspace.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      path: z.string(),
      includeSha256: z.boolean().optional(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
