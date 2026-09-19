import { withAgentDatabase } from "../memory/database.js";
import { parseTimestamp } from "../executor/handlers/metrics-arguments.js";

export interface AgentMetrics {
  // Workflow-scoped (only workflow actions, excludes observability/orchestration)
  workflowActionFailureRate: number;
  /**
   * Failed workflow tool_calls — counts tool_calls where category IS NULL OR
   * category = 'workflow' and status = 'failed'. This is a TOOL-CALL metric:
   * it counts individual tool invocations that returned errors.
   * Scoped by taskId, from/to, tool, status, category filters.
   */
  workflowFailedActions: number;
  workflowTotalActions: number;
  // Legacy fields (kept for backward compat, same as workflow-scoped)
  recoverySuccessRate: number | null;
  toolFailureRate: number;
  averageRecoveryTimeMs: number | null;
  /**
   * Failed task-step executions — counts rows in the executions table where
   * status = 'failed'. This is a STEP-EXECUTION metric: it counts how many
   * times a task step (closed-agent-loop iteration) finished with failure.
   *
   * Semantics differ from workflowFailedActions:
   * - workflowFailedActions = failed tool invocations (finer grain)
   * - failedActions = failed step executions (coarser grain, one step may
   *   involve multiple tool calls)
   *
   * Scoped by taskId and from/to only (executions have no tool/category columns).
   */
  failedActions: number;
  /** Top 10 tools by failed tool_calls matching the current filters. */
  mostFailedTools: Array<{ tool: string; failures: number }>;
  // Recovery counters — computed from persisted recovery_attempt executions
  // joined to the final persisted state of their target task step.
  recoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  // Snapshot pagination
  recentCalls: Array<{
    tool: string;
    success: boolean;
    durationMs: number;
    sessionId: string;
    taskId?: string;
    timestamp: string;
    error?: string;
    category: string;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    snapshotAt: string;
  };
}

export interface AgentMetricsOptions {
  taskId?: string;
  tool?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  category?: string;
}

export function getAgentMetrics(opts: AgentMetricsOptions = {}): AgentMetrics {
  const { taskId, tool, status, limit = 100, offset = 0, category } = opts;

  // Normalize date bounds. Plain dates (YYYY-MM-DD) become explicit day
  // boundaries so `to: "2026-09-13"` includes the whole day instead of
  // silently excluding everything after 00:00:00. Values are already
  // validated by agentMetricsArguments (invalid dates never reach here).
  const fromMs = parseTimestamp(opts.from);
  const toMs = parseTimestamp(opts.to);
  const from = fromMs === null || opts.from === undefined ? undefined : new Date(fromMs).toISOString();
  const to = toMs === null || opts.to === undefined
    ? undefined
    : /^\d{4}-\d{2}-\d{2}$/.test(opts.to)
      ? new Date(toMs + 86_399_999).toISOString()
      : new Date(toMs).toISOString();

  // Build WHERE clause for tool_calls
  const conditions: string[] = [];
  const args: unknown[] = [];
  
  if (taskId) { conditions.push("task_id = ?"); args.push(taskId); }
  if (tool) { conditions.push("tool = ?"); args.push(tool); }
  if (status) { conditions.push("status = ?"); args.push(status); }
  if (from) { conditions.push("created_at >= ?"); args.push(from); }
  if (to) { conditions.push("created_at <= ?"); args.push(to); }
  if (category) { conditions.push("category = ?"); args.push(category); }
  const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
  
  // Snapshot timestamp — all queries use this for consistency
  const snapshotAt = new Date().toISOString();
  
  return withAgentDatabase((db) => {
    // Recovery duration is derived from recovery_events; success/failure is
    // derived from persisted recovery_attempt executions + final step state.
    const recoveryEventConds: string[] = [];
    const recoveryEventArgs: unknown[] = [];
    if (taskId) { recoveryEventConds.push("task_id = ?"); recoveryEventArgs.push(taskId); }
    if (from) { recoveryEventConds.push("started_at >= ?"); recoveryEventArgs.push(from); }
    if (to) { recoveryEventConds.push("started_at <= ?"); recoveryEventArgs.push(to); }
    if (!from && !to) recoveryEventConds.push("started_at > datetime('now', '-7 days')");
    const recoveryDuration = db.prepare(`
      SELECT AVG(CASE
        WHEN completed_at IS NOT NULL
          AND started_at IS NOT NULL
          AND julianday(completed_at) > julianday(started_at)
          AND (julianday(completed_at) - julianday(started_at)) * 86400000 < 300000
        THEN (julianday(completed_at) - julianday(started_at)) * 86400000
      END) AS average_ms
      FROM recovery_events
      WHERE ${recoveryEventConds.length > 0 ? recoveryEventConds.join(" AND ") : "1=1"}
    `).get(...recoveryEventArgs) as { average_ms: number | null };

    const recoveryAttemptConds: string[] = ["e.action LIKE 'recovery_attempt_%'"];
    const recoveryAttemptArgs: unknown[] = [];
    if (taskId) { recoveryAttemptConds.push("e.task_id = ?"); recoveryAttemptArgs.push(taskId); }
    if (from) { recoveryAttemptConds.push("e.created_at >= ?"); recoveryAttemptArgs.push(from); }
    if (to) { recoveryAttemptConds.push("e.created_at <= ?"); recoveryAttemptArgs.push(to); }
    const recoveryAttemptsRows = db.prepare(`
      SELECT e.task_id, e.step_id, s.status AS step_status
      FROM executions e
      LEFT JOIN task_steps s ON s.task_id = e.task_id AND s.step_id = e.step_id
      WHERE ${recoveryAttemptConds.join(" AND ")}
    `).all(...recoveryAttemptArgs) as Array<{ task_id: string | null; step_id: number; step_status: string | null }>;
    
    // Workflow-only stats (excludes observability/orchestration calls)
    const workflowStats = db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tool_calls WHERE (category IS NULL OR category = 'workflow') ${whereClause}
    `).get(...args) as { total: number; failed: number | null };
    
    // All-call stats (for backward compat)
    const allStats = db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tool_calls WHERE 1=1 ${whereClause}
    `).get(...args) as { total: number; failed: number | null };
    
    // Top failed tools — scoped by the same filters as toolFailureRate so the
    // response is internally consistent (previously this hardcoded the
    // workflow category, which contradicted category=orchestration results).
    const mostFailedTools = db.prepare(`
      SELECT tool, COUNT(*) AS failures FROM tool_calls
      WHERE status = 'failed' ${whereClause} GROUP BY tool ORDER BY failures DESC, tool LIMIT 10
    `).all(...args) as Array<{ tool: string; failures: number }>;
    
    // Failed task-step executions. Executions are step records (no tool/
    // category columns), so only taskId and date bounds apply here.
    // Exclude recovery bookkeeping events (action starts with "recovery_")
    // because they are not actual task-step executions (BUG: failedActions overcount).
    const executionConds: string[] = ["status = 'failed'", "action NOT LIKE 'recovery_%'"];
    const executionArgs: unknown[] = [];
    if (taskId) { executionConds.push("task_id = ?"); executionArgs.push(taskId); }
    if (from) { executionConds.push("created_at >= ?"); executionArgs.push(from); }
    if (to) { executionConds.push("created_at <= ?"); executionArgs.push(to); }
    const failedExecutions = db.prepare(`SELECT COUNT(*) AS count FROM executions WHERE ${executionConds.join(" AND ")}`).get(...executionArgs) as { count: number };
    
    // Recent calls with pagination
    const recentCalls = db.prepare(`
      SELECT tool, status, duration_ms, correlation_id, task_id, created_at, error, category
      FROM tool_calls WHERE created_at <= ? ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(snapshotAt, ...args, limit, offset) as Array<{
      tool: string; status: string; duration_ms: number; correlation_id: string;
      task_id: string | null; created_at: string; error: string | null; category: string | null;
    }>;
    
    const totalCalls = db.prepare(`SELECT COUNT(*) AS count FROM tool_calls WHERE created_at <= ? ${whereClause}`).get(snapshotAt, ...args) as { count: number };
    
    // Recovery counters are valid both globally and task-scoped. Each persisted
    // recovery_attempt is successful only when its target step eventually
    // reached completed; scheduling a retry by itself is not success.
    const recoveryAttempts = recoveryAttemptsRows.length;
    const successfulRecoveries = recoveryAttemptsRows.filter((row) => row.step_status === "completed").length;
    const failedRecoveries = recoveryAttempts - successfulRecoveries;
    const recoverySuccessRate = recoveryAttempts === 0 ? null : successfulRecoveries / recoveryAttempts;
    const rawAvg = recoveryDuration.average_ms ?? 0;
    const averageRecoveryTimeMs = recoveryAttempts === 0 ? null : Math.max(0, Math.min(300000, Math.round(rawAvg)));
    
    const workflowFailed = workflowStats.failed ?? 0;
    const workflowTotal = workflowStats.total;
    
    return {
      // New workflow-scoped fields
      workflowActionFailureRate: workflowTotal === 0 ? 0 : workflowFailed / workflowTotal,
      workflowFailedActions: workflowFailed,
      workflowTotalActions: workflowTotal,
      // Recovery
      recoverySuccessRate,
      averageRecoveryTimeMs,
      recoveryAttempts,
      successfulRecoveries,
      failedRecoveries,
      // Legacy (all-call)
      toolFailureRate: allStats.total === 0 ? 0 : (allStats.failed ?? 0) / allStats.total,
      failedActions: failedExecutions.count,
      mostFailedTools,
      recentCalls: recentCalls.map((c) => ({
        tool: c.tool,
        success: c.status === "success",
        durationMs: c.duration_ms,
        sessionId: c.correlation_id,
        taskId: c.task_id ?? undefined,
        timestamp: c.created_at,
        error: c.error ?? undefined,
        category: c.category ?? "workflow",
      })),
      pagination: {
        total: totalCalls.count,
        limit,
        offset,
        hasMore: offset + limit < totalCalls.count,
        snapshotAt,
      },
    };
  });
}
