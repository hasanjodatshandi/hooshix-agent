import { withAgentDatabase } from "../../../../../core/memory/database.js";

/** Durable storage only; Git snapshot validity and rollback policy stay with their caller. */
export function storeTaskGitSnapshot(
  id: string, correlationId: string, cwd: string, encodedSnapshot: Buffer
): void {
  withAgentDatabase((db) => db.prepare(
    "INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, correlationId, `__task_snapshot__:${cwd}`, encodedSnapshot, new Date().toISOString()));
}
export function findTaskGitSnapshot(id: string): { path: string; content: Buffer } | undefined {
  return withAgentDatabase((db) => db.prepare(
    "SELECT path, content FROM file_backups WHERE id = ?"
  ).get(id) as { path: string; content: Buffer } | undefined);
}
