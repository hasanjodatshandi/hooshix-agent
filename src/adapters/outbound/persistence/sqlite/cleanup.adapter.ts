import { withAgentDatabase } from "../../../../core/memory/database/index.js";

export function cleanupAgentData(retentionDays = 90): Record<string, number> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Retention must be a positive number of days");
  }
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  return withAgentDatabase((db) =>
    db.transaction(() => ({
      toolCalls: db.prepare("DELETE FROM tool_calls WHERE created_at < ?").run(cutoff).changes,
      checkpoints: db
        .prepare(
          "DELETE FROM agent_checkpoints WHERE created_at < ? AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed','failed','cancelled'))",
        )
        .run(cutoff).changes,
      recoveryEvents: db
        .prepare("DELETE FROM recovery_events WHERE started_at < ? AND status != 'started'")
        .run(cutoff).changes,
      approvals: db
        .prepare("DELETE FROM approval_requests WHERE created_at < ? AND status = 'consumed'")
        .run(cutoff).changes,
      restoredBackups: db
        .prepare("DELETE FROM file_backups WHERE created_at < ? AND restored_at IS NOT NULL AND restored_at != 'absent'")
        .run(cutoff).changes,
    }))(),
  );
}