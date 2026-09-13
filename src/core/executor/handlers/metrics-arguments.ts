import { z } from "zod";

/**
 * Canonical agent_metrics argument schema — the single source of truth shared
 * by the direct MCP tool (tools/system/agent-metrics.ts) and the Task executor
 * handler (handlers/system-handler.ts). Previously the Task path hand-rolled
 * its own coercion and drifted from the direct path (Stage 21 regression:
 * Task limit=1 resolved to 100 while direct limit=1 worked).
 */
export const agentMetricsArguments = z.object({
  correlationId: z.string().min(1).optional(),
  taskId: z.string().uuid().optional(),
  tool: z.string().optional(),
  status: z.enum(["success", "failed"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  category: z.enum(["workflow", "observability", "orchestration", "governance"]).optional(),
});

export type AgentMetricsArguments = z.infer<typeof agentMetricsArguments>;
