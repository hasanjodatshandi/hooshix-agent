import { z } from "zod";

/**
 * Canonical agent_metrics argument schema — the single source of truth shared
 * by the direct MCP tool (tools/system/agent-metrics.ts) and the Task executor
 * handler (handlers/system-handler.ts). Previously the Task path hand-rolled
 * its own coercion and drifted from the direct path (Stage 21 regression:
 * Task limit=1 resolved to 100 while direct limit=1 worked).
 *
 * from/to accept full ISO 8601 timestamps or plain dates (YYYY-MM-DD); anything
 * else is rejected with an explicit validation error instead of being silently
 * compared as a string and returning a misleading empty result.
 */
export const agentMetricsArguments = z
  .object({
    correlationId: z.string().min(1).optional(),
    taskId: z.string().uuid().optional(),
    tool: z.string().optional(),
    status: z.enum(["success", "failed"]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
    category: z.enum(["workflow", "observability", "orchestration", "governance"]).optional(),
  })
  .superRefine((args, ctx) => {
    // from/to must be parseable timestamps — SQLite comparisons are string
    // comparisons, so "not-a-date" would otherwise silently match nothing.
    const parsedFrom = parseTimestamp(args.from);
    if (args.from !== undefined && parsedFrom === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "from must be an ISO 8601 date (YYYY-MM-DD) or UTC timestamp (e.g. 2026-09-01T00:00:00.000Z)",
      });
    }
    const parsedTo = parseTimestamp(args.to);
    if (args.to !== undefined && parsedTo === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to must be an ISO 8601 date (YYYY-MM-DD) or UTC timestamp (e.g. 2026-09-13T03:00:00.000Z)",
      });
    }
    if (parsedFrom !== null && parsedTo !== null && parsedFrom > parsedTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "from must be <= to",
      });
    }
  });

/**
 * Parse an ISO 8601 timestamp or plain date — strictly. Accepted forms:
 *   YYYY-MM-DD               (interpreted as UTC midnight)
 *   YYYY-MM-DDTHH:MM:SS[.fff]Z (full UTC timestamp)
 * Returns epoch ms, or null for anything else (including V8-lenient strings
 * like "2026/09/13" or reduced-precision "2026-09") so the SQL string
 * comparison can never be fed a non-normalized value.
 */
export function parseTimestamp(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export type AgentMetricsArguments = z.infer<typeof agentMetricsArguments>;
