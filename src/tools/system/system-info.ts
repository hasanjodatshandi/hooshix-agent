import os from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { assertToolPermission } from "../../security/permission.js";

export function registerSystemInfoTool(server: McpServer){
  server.registerTool(
    "get_system_info",
    {
      title: "Get System Information",
      description: "Get local computer information",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        correlationId: z.string().min(1).optional(),
        taskId: z.string().optional()
      })
    },
    async({ correlationId, taskId })=>{
      assertToolPermission("get_system_info");
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("get_system_info", traceId, taskId, () => ({ content:[{
        type:"text",
        text: JSON.stringify({
          platform: os.platform(),
          cpu: os.cpus()[0]?.model,
          memory: os.totalmem()
        }, null, 2)
      }], _meta: { correlationId: traceId } }));
    }
  );
}
