import fs from "node:fs/promises";

/**
 * R-P18: shared size-bounded rotation for the append-only audit logs.
 *
 * Both `command-audit.ts` and `file-audit.ts` carried byte-identical copies of
 * this logic, so a fix to one would silently drift from the other. Audit lines
 * are append-only, so an unbounded file is a real operational hazard on a
 * long-running host.
 *
 * The rotation is not a retention policy (nothing is deleted by age), only a
 * size bound: keep the current file as `.1` and truncate. An operator with
 * stronger retention needs archives the `.1`.
 */
export const MAX_AUDIT_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB

export async function rotateAuditLogIfNeeded(destination: string): Promise<void> {
  let size: number;
  try { size = (await fs.stat(destination)).size; } catch { return; } // absent on first write
  if (size < MAX_AUDIT_LOG_BYTES) return;
  await fs.rename(destination, destination + ".1");
}
