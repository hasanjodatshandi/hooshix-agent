import { withAgentDatabase } from "../../../../../core/memory/database.js";

/** Legacy package snapshot persistence. Mutation/rollback semantics remain unchanged. */
export interface StoredPackageSnapshot {
  readonly id: string;
  readonly cwd: string;
  readonly snapshot: string;
  readonly status: string;
}
export interface NewPackageSnapshotRow {
  readonly id: string;
  readonly correlationId: string;
  readonly manager: string;
  readonly action: string;
  readonly packageName: string;
  readonly cwd: string;
  readonly snapshot: unknown;
}
export function insertPackageSnapshot(row: NewPackageSnapshotRow): void {
  withAgentDatabase(db => db.prepare(`
    INSERT INTO package_snapshots(id, correlation_id, manager, action, package_name, cwd, snapshot, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)
  `).run(row.id, row.correlationId, row.manager, row.action, row.packageName,
    row.cwd, JSON.stringify(row.snapshot), new Date().toISOString()));
}
export function updateStoredPackageSnapshot(id: string, status: "committed" | "rolled_back" | "rollback_failed"): void {
  withAgentDatabase(db => db.prepare(
    "UPDATE package_snapshots SET status=?, restored_at=? WHERE id=?"
  ).run(status, status === "committed" ? null : new Date().toISOString(), id));
}
export function findPackageSnapshot(id: string): StoredPackageSnapshot | undefined {
  return withAgentDatabase(db => db.prepare(
    "SELECT id, cwd, snapshot, status FROM package_snapshots WHERE id = ?"
  ).get(id) as StoredPackageSnapshot | undefined);
}
