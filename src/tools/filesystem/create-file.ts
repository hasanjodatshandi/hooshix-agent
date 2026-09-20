import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only registration. Runtime effects are dispatched from the authorized R2 gateway. */
export function registerCreateFileTool(server: McpServer) {
  server.registerTool("create_file", {
    title: "Create File",
    description: "✏️ WRITE — Create a NEW file; fails if it already exists (use write_file to overwrite). Atomic.\n\nExamples: { \"path\": \"src/utils.ts\", \"content\": \"export function foo() {}\" } · { \"path\": \"D:/Projects/new-file.txt\", \"content\": \"hello\" }",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({ path: z.string(), content: z.string().max(1024 * 1024), correlationId: z.string().min(1).optional(), taskId: z.string().optional() })
  } , async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
