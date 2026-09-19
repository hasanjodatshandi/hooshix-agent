import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentMetrics } from "../../core/trace/metrics-service.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { agentMetricsArguments } from "../../core/executor/handlers/metrics-arguments.js";

export function registerAgentMetricsTool(server: McpServer): void {
  server.registerTool("agent_metrics", {
    title: "Agent Metrics",
    description: "📊 OBSERVABILITY — Tool reliability dashboard: success rates, errors, recovery attempts, latency.\n\nFilters: taskId, tool, status (success|failed), from/to (ISO 8601 date or timestamp; invalid dates and from>to are rejected), category. Paginate with limit (≤500) + offset.\n\nTwo distinct failure metrics:\n- workflowFailedActions: failed TOOL CALLS (category=workflow). Counts individual tool invocations that returned errors. Honors all filters.\n- failedActions: failed STEP EXECUTIONS (executions table). Counts task-step iterations that finished with failure. Only honors taskId + from/to.\n\nRecovery metrics (recoveryAttempts, successfulRecoveries, failedRecoveries, recoverySuccessRate) count persisted recovery-attempt executions. An attempt is successful only if its target step eventually reached `completed`; global and task-scoped views use the same rule.\n\nExamples: {} · { \"tool\": \"delete_file\", \"status\": \"failed\" } · { \"limit\": 20, \"offset\": 20 }",
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
