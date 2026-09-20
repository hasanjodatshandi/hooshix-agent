import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only: executable system info flows solely through the approved R2 gateway. */
export function registerSystemInfoTool(server: McpServer){
  server.registerTool(
    "get_system_info",
    {
      title: "Get System Information",
      description: "🖥️ SYSTEM — Local machine info: platform, CPU model, total memory.\n\nExample: {}",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        correlationId: z.string().min(1).optional(),
        taskId: z.string().optional()
      })
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
}