import { withAgentDatabase } from "../memory/database.js";
import { parseTimestamp } from "../executor/handlers/metrics-arguments.js";

function ensureExtraColumns(db: any): void {
  // tool_calls: add category column if missing
  const toolCols = new Set((db.prepare("PRAGMA table_info(tool_calls)").all() as Array<{ name: string }>).map((c) => c.name));
  if (!toolCols.has("category")) {
    try { db.prepare("ALTER TABLE tool_calls ADD COLUMN category TEXT DEFAULT 'workflow'").run(); } catch { /* ignore */ }
  }
  // recovery_events: add task_id column if missing
  try {
    const recCols = new Set((db.prepare("PRAGMA table_info(recovery_events)").all() as Array<{ name: string }>).map((c) => c.name));
    if (!recCols.has("task_id")) {
      try { db.prepare("ALTER TABLE recovery_events ADD COLUMN task_id TEXT").run(); } catch { /* ignore */ }
    }
  } catch { /* table may not exist */ }
}

export interface AgentMetrics {
  // Workflow-scoped (only workflow actions, excludes observability/orchestration)
  workflowActionFailureRate: number;
  workflowFailedActions: number;
  workflowTotalActions: number;
  // Legacy fields (kept for backward compat, same as workflow-scoped)
  recoverySuccessRate: number | null;
  toolFailureRate: number;
  averageRecoveryTimeMs: number | null;
  /**
   * Failed task-step executions (from the executions table). Affected by the
   * taskId and from/to filters; tool/status/category filters do NOT apply
   * here because executions are step records, not tool calls.
   */
  failedActions: number;
  /** Top 10 tools by failed tool_calls matching the current filters. */
  mostFailedTools: Array<{ tool: string; failures: number }>;
  // Recovery explicit counters
  recoveryAttempts: number;
  successfulRecoveries: number;
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
    ensureExtraColumns(db);
    // Recovery events — scoped by task_id
    const recoveryTaskFilter = taskId ? "AND task_id = ?" : "";
    const recoveryArgs = taskId ? [taskId] : [];
    const recovery = db.prepare(`
      SELECT
        COUNT(DISTINCT recovery_id) AS total,
        COUNT(DISTINCT CASE WHEN status = 'completed' THEN recovery_id END) AS completed,
        AVG(CASE 
          WHEN completed_at IS NOT NULL 
            AND started_at IS NOT NULL
            AND julianday(completed_at) > julianday(started_at)
            AND (julianday(completed_at) - julianday(started_at)) * 86400000 < 300000
          THEN (julianday(completed_at) - julianday(started_at)) * 86400000 
        END) AS average_ms
      FROM recovery_events
      WHERE started_at > datetime('now', '-7 days') ${recoveryTaskFilter}
    `).get(...recoveryArgs) as { total: number; completed: number; average_ms: number | null };
    
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
    const executionConds: string[] = ["status = 'failed'"];
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
    
    // Recovery counters
    const recoveryAttempts = recovery.total;
    const successfulRecoveries = recovery.completed;
    const recoverySuccessRate = recoveryAttempts === 0 ? null : recovery.completed / recovery.total;
    const rawAvg = recovery.average_ms ?? 0;
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
