import { withAgentDatabase } from "../../../../../core/memory/database/index.js";

/**
 * CI-G3 — the control-plane audit sink (SQLite implementation).
 *
 * Every Context resolution — allowed or refused — is recorded here in SHADOW
 * mode and beyond. The row never contains secrets: only ids, the action, the
 * decision and a trace id. This is what lets an operator compare the old and
 * the new policy on real traffic before enforcement is turned on (design 10
 * §2), and what makes a later refusal auditable rather than silent.
 */

export interface ControlPlaneAuditRecord {
  readonly ownerId: string | null;
  readonly contextId: string | null;
  readonly bindingId: string | null;
  readonly action: string;
  readonly decision: "ALLOW" | "DENY";
  readonly traceId: string | null;
  readonly occurredAt: string;
}

export function recordControlPlaneAudit(record: ControlPlaneAuditRecord): void {
  withAgentDatabase((db) =>
    db
      .prepare(
        "INSERT INTO security_audit(owner_id, context_id, binding_id, action, decision, trace_id, occurred_at)" +
          " VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        record.ownerId,
        record.contextId,
        record.bindingId,
        record.action,
        record.decision,
        record.traceId,
        record.occurredAt,
      ),
  );
}

/** Count audit rows for a Context — used by the SHADOW-mode tests. */
export function countControlPlaneAudit(contextId: string): number {
  const row = withAgentDatabase((db) =>
    db.prepare("SELECT COUNT(*) AS n FROM security_audit WHERE context_id=?").get(contextId),
  ) as { n: number };
  return row.n;
}

/** The ControlPlaneAuditSink port implementation. Async per the port contract. */
export async function recordControlPlaneAuditFromPort(input: {
  readonly ownerId?: string;
  readonly contextId?: string;
  readonly bindingId?: string;
  readonly action: string;
  readonly decision: "ALLOW" | "DENY";
  readonly traceId: string;
}): Promise<void> {
  recordControlPlaneAudit({
    ownerId: input.ownerId ?? null,
    contextId: input.contextId ?? null,
    bindingId: input.bindingId ?? null,
    action: input.action,
    decision: input.decision,
    traceId: input.traceId,
    occurredAt: new Date().toISOString(),
  });
}
