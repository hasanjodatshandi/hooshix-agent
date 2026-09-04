import { withAgentDatabase } from "../memory/database.js";

export interface AgentMetrics {
  recoverySuccessRate: number;
  toolFailureRate: number;
  averageRecoveryTimeMs: number;
  failedActions: number;
  mostFailedTools: Array<{ tool: string; failures: number }>;
}

export function getAgentMetrics(): AgentMetrics {
  return withAgentDatabase((db) => {
    // Only count recovery events from the last 7 days with valid timestamps
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
      WHERE started_at > datetime('now', '-7 days')
    `).get() as { total: number; completed: number; average_ms: number | null };
    
    const tools = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM tool_calls`)
      .get() as { total: number; failed: number | null };
    
    const mostFailedTools = db.prepare(`
      SELECT tool, COUNT(*) AS failures FROM tool_calls
      WHERE status = 'failed' GROUP BY tool ORDER BY failures DESC, tool LIMIT 10
    `).all() as Array<{ tool: string; failures: number }>;
    
    const failedExecutions = db.prepare("SELECT COUNT(*) AS count FROM executions WHERE status = 'failed'").get() as { count: number };
    
    // Clamp average to reasonable bounds (0-5 minutes)
    const rawAvg = recovery.average_ms ?? 0;
    const clampedAvg = Math.max(0, Math.min(300000, Math.round(rawAvg)));
    
    return {
      recoverySuccessRate: recovery.total === 0 ? 0 : recovery.completed / recovery.total,
      toolFailureRate: tools.total === 0 ? 0 : (tools.failed ?? 0) / tools.total,
      averageRecoveryTimeMs: clampedAvg,
      failedActions: failedExecutions.count,
      mostFailedTools
    };
  });
}
