import { withAgentDatabase } from "../../../../../core/memory/database.js";

/** SQLite-only persistence for legacy filesystem backup/idempotency operations. */
export interface StoredFileBackup {
  readonly id: string;
  readonly path: string;
  readonly content: Buffer;
  readonly restored_at: string | null;
}
export function persistFileBackup(
  id: string, correlationId: string, canonicalPath: string, content: Buffer, revision: string,
): void {
  withAgentDatabase(db => {
    try {
      db.prepare(`
        INSERT INTO file_backups(id, correlation_id, path, content, created_at, file_revision)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, correlationId, canonicalPath, content, new Date().toISOString(), revision);
    } catch {
      // Legacy compatibility; migration-only schema hardening is handled in R6.
      db.prepare(`
        INSERT INTO file_backups(id, correlation_id, path, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, correlationId, canonicalPath, content, new Date().toISOString());
    }
  });
}
export function persistAbsentFileBackup(id: string, correlationId: string, canonicalPath: string): void {
  withAgentDatabase(db => db.prepare(`
    INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(id, correlationId, canonicalPath, Buffer.alloc(0), new Date().toISOString()));
  withAgentDatabase(db => db.prepare(
    "UPDATE file_backups SET restored_at = 'absent' WHERE id = ?"
  ).run(id));
}
export function getStoredIdempotentResponse(key: string, operation: string, requestHash: string): unknown | undefined {
  return withAgentDatabase(db => {
    const row = db.prepare(
      "SELECT response FROM idempotency_responses WHERE id = ? AND operation = ? AND request_hash = ?"
    ).get(key, operation, requestHash) as { response: string } | undefined;
    return row ? JSON.parse(row.response) as unknown : undefined;
  });
}
export function persistIdempotentResponse(key: string, operation: string, requestHash: string, response: unknown): void {
  withAgentDatabase(db => db.prepare(
    "INSERT OR IGNORE INTO idempotency_responses(id, operation, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(key, operation, requestHash, JSON.stringify(response), new Date().toISOString()));
}
export function getStoredFileBackup(id: string): StoredFileBackup | undefined {
  return withAgentDatabase(db => db.prepare(
    "SELECT id, path, content, restored_at FROM file_backups WHERE id = ?"
  ).get(id) as StoredFileBackup | undefined);
}
export function markFileBackupRestored(id: string): void {
  withAgentDatabase(db => db.prepare(
    "UPDATE file_backups SET restored_at=? WHERE id=?"
  ).run(new Date().toISOString(), id));
}
