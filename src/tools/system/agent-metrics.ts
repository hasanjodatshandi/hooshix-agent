import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentMetrics } from "../../core/trace/metrics-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";

export function registerAgentMetricsTool(server: McpServer): void {
  server.registerTool("agent_metrics", {
    title: "Agent Metrics",
    description: "Return the local recovery and tool reliability dashboard. Shows tool call success rates, error counts, recovery attempts, and performance metrics.\n\nExample: { \"tool\": \"agent_metrics\", \"arguments\": {} }\n\nOptional: pass taskId to filter metrics for a specific task.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({ correlationId: z.string().min(1).optional(), taskId: z.string().uuid().optional() })
  }, async ({ correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    policyDecisionPoint.assertAllowed({ tool: "agent_metrics", arguments: {}, correlationId: traceId });
    return auditToolCall("agent_metrics", traceId, taskId, () => ({
      content: [{ type: "text" as const, text: JSON.stringify(getAgentMetrics(), null, 2) }],
      _meta: { correlationId: traceId }
    }));
  });
}
