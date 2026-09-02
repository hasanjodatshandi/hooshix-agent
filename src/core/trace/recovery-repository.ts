import type { RecoveryEvent } from "./recovery-observability.js";
import { withAgentDatabase } from "../memory/database.js";

export class PersistentRecoveryRepository {
  save(event: RecoveryEvent): void {
    withAgentDatabase((db) => db.prepare(`
        INSERT INTO recovery_events
        (recovery_id, correlation_id, action, reason, retry_count, started_at, completed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event.recoveryId, event.correlationId, event.action, event.reason, event.retryCount, event.startedAt, event.completedAt ?? null, event.status));
  }

  findByCorrelationId(correlationId: string): RecoveryEvent[] {
    const rows = withAgentDatabase((db) => db.prepare(`SELECT * FROM recovery_events WHERE correlation_id = ? ORDER BY id`).all(correlationId)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      recoveryId: String(row.recovery_id),
      correlationId: String(row.correlation_id),
      action: String(row.action),
      reason: String(row.reason),
      retryCount: Number(row.retry_count),
      startedAt: String(row.started_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
      status: row.status as RecoveryEvent["status"]
    }));
  }
}
