import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { agentMetricsArguments } from "../../core/executor/handlers/metrics-arguments.js";

/** Schema-only: metrics are dispatched by the R2 application gateway. */
export function registerAgentMetricsTool(server: McpServer): void {
  server.registerTool("agent_metrics", {
    title: "Agent Metrics",
    description: "📊 OBSERVABILITY — Tool reliability dashboard: success rates, errors, recovery attempts, latency.\n\nFilters: taskId, tool, status (success|failed), from/to (ISO 8601 date or timestamp; invalid dates and from>to are rejected), category (workflow|observability|orchestration|governance). Paginate with limit (≤500) + offset.\n\nTwo distinct failure metrics:\n- workflowFailedActions: failed TOOL CALLS where category IS NULL or category='workflow' (legacy rows carry no category). Counts individual tool invocations that returned errors. Honors all filters.\n- failedActions: failed STEP EXECUTIONS (executions table). Counts task-step iterations that finished with failure. Only honors taskId + from/to.\n\nRecovery metrics (recoveryAttempts, successfulRecoveries, failedRecoveries, recoverySuccessRate) count persisted recovery-attempt executions. An attempt is successful only if its target step eventually reached `completed`; global and task-scoped views use the same rule.\n\nExamples: {} · { \"tool\": \"delete_file\", \"status\": \"failed\" } · { \"limit\": 20, \"offset\": 20 }",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: agentMetricsArguments,
  }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
