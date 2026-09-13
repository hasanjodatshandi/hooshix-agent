import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentMetrics } from "../../core/trace/metrics-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { agentMetricsArguments } from "../../core/executor/handlers/metrics-arguments.js";

export function registerAgentMetricsTool(server: McpServer): void {
  server.registerTool("agent_metrics", {
    title: "Agent Metrics",
    description: "📊 OBSERVABILITY — Tool reliability dashboard: success rates, errors, recovery attempts, latency.\n\nFilters: taskId, tool, status (success|failed), from/to (ISO date), category. Paginate with limit (≤500) + offset.\n\nExamples: {} · { \"tool\": \"delete_file\", \"status\": \"failed\" } · { \"limit\": 20, \"offset\": 20 }",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: agentMetricsArguments,
  }, async ({ correlationId, taskId, tool: toolName, status, from, to, limit, offset, category }) => {
    const traceId = resolveCorrelationId(correlationId);
    policyDecisionPoint.assertAllowed({ tool: "agent_metrics", arguments: {}, correlationId: traceId });
    return auditToolCall("agent_metrics", traceId, taskId, () => ({
      content: [{ type: "text" as const, text: JSON.stringify(getAgentMetrics({ taskId, tool: toolName, status, from, to, limit, offset, category }), null, 2) }],
      _meta: { correlationId: traceId }
    }));
  });
}
