import { withAgentDatabase } from "../../../../../core/memory/database/index.js";

/** SQLite-only persistence; classification and result semantics belong to the caller. */
export interface ToolCallAuditRow {
  readonly tool: string;
  readonly correlationId: string;
  readonly taskId?: string;
  readonly status: "success" | "failed";
  readonly category: "workflow" | "observability" | "orchestration" | "governance";
  readonly startedAt: string;
  readonly durationMs: number;
  readonly errorName: string | null;
}
export function insertToolCallAuditRow(row: ToolCallAuditRow): void {
  withAgentDatabase((db) => {
    db.prepare(`
      INSERT INTO tool_calls(correlation_id, task_id, tool, status, created_at, completed_at, duration_ms, error, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.correlationId, row.taskId ?? null, row.tool, row.status,
      row.startedAt, new Date().toISOString(), row.durationMs, row.errorName, row.category);
  });
}
