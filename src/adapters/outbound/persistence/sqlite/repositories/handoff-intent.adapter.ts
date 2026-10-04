import {randomUUID, createHash} from "node:crypto";
import type Database from "better-sqlite3";
import {withAgentDatabase} from "../../../../../core/memory/database/index.js";
import type {HandoffKind, IntentState, TransferIntent} from "../../../../../domain/context/transfer-intent.js";
import {isIntentTerminal, rehydrateTransferIntent} from "../../../../../domain/context/transfer-intent.js";
import {rehydrateOwnershipLease} from "../../../../../domain/context/ownership-lease.js";
import {rehydrateContext, transitionContextState, type Context, type ContextState} from "../../../../../domain/context/context.js";
import type {ContextId} from "../../../../../domain/shared/ids.js";
import type {TransferRepository} from "../../../../../application/ports/outbound/context.port.js";
import {isoTimestamp, getOwnershipLeaseRow} from "./context-lease.adapter.js";
import {transferContextOwnership} from "./context-lease.adapter.js";

/**
 * CI-G6 — the SQLite implementation of the transfer port.
 *
 * The schema (migration 23) already encodes the domain contract: the
 * seven-state machine and `kind` as CHECK constraints, and `ticket_hash`
 * UNIQUE so a replayed ticket collides rather than silently consuming twice.
 * This adapter is the SQLite side of that contract; the state-machine rules
 * themselves live in the domain so they stay unit-testable without a database.
 *
 * The one rule the schema cannot express: the raw ticket is never written
 * here. `mintTicket` produces the plaintext once and `approveIntent` compares
 * only hashes, so a database read cannot be turned into a live transfer
 * capability (design 03 §4).
 */

interface IntentRow {
  intent_id: string;
  source_context_id: string;
  source_binding_id: string;
  target_connection_id: string;
  target_context_id: string | null;
  kind: HandoffKind;
  state: IntentState;
  source_epoch: number;
  ticket_hash: string;
  expires_at: string;
  approved_by_owner_id: string | null;
  approved_at: string | null;
  committed_at: string | null;
  created_at: string;
}

interface ContextRow {
  context_id: string;
  owner_id: string;
  project_label: string;
  state: ContextState;
  workspace_grant_id: string;
  storage_locator: string;
  context_epoch: number;
  created_at: string;
  updated_at: string;
}

const SELECT_BY_ID = "SELECT * FROM handoff_intent WHERE intent_id=?";
const SELECT_CONTEXT =
  "SELECT context_id, owner_id, project_label, state, workspace_grant_id, storage_locator, context_epoch, created_at, updated_at FROM context_registry WHERE context_id=?";

function toIntent(row: IntentRow): TransferIntent {
  return rehydrateTransferIntent({
    id: row.intent_id,
    sourceContextId: row.source_context_id,
    sourceBindingId: row.source_binding_id,
    targetConnectionId: row.target_connection_id,
    targetContextId: row.target_context_id,
    kind: row.kind,
    state: row.state,
    sourceEpoch: row.source_epoch,
    ticketHash: row.ticket_hash,
    expiresAt: row.expires_at,
    approvedByOwnerId: row.approved_by_owner_id,
    approvedAt: row.approved_at,
    committedAt: row.committed_at,
    createdAt: row.created_at,
  });
}

function toContext(row: ContextRow): Context {
  return rehydrateContext({
    id: row.context_id,
    ownerId: row.owner_id,
    projectLabel: row.project_label,
    state: row.state,
    workspaceGrantId: row.workspace_grant_id,
    storageLocator: row.storage_locator,
    epoch: row.context_epoch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function readContextOn(db: Database.Database, contextId: string): Context | null {
  const row = db.prepare(SELECT_CONTEXT).get(contextId) as ContextRow | undefined;
  return row ? toContext(row) : null;
}

/**
 * Move a Context to the next state inside the caller's transaction. The CAS on
 * the expected prior state means two concurrent transfers cannot both move the
 * same Context — the second touches zero rows and the caller rolls back.
 */
function moveContextState(
  db: Database.Database,
  contextId: string,
  expectedState: ContextState,
  next: ContextState,
  now: string,
): Context {
  const current = readContextOn(db, contextId);
  if (!current) throw new Error("context_not_found");
  if (current.state !== expectedState) {
    // Let the domain raise the precise illegal-transition message.
    void transitionContextState(current, next, now);
    throw new Error("context_state_conflict");
  }
  const updated = transitionContextState(current, next, now);
  const changed = db
    .prepare("UPDATE context_registry SET state=?, updated_at=? WHERE context_id=? AND state=?")
    .run(next, now, contextId, expectedState);
  if (changed.changes !== 1) throw new Error("context_state_conflict");
  return updated;
}

/**
 * CI-G6 — the SQLite transfer port implementation. Functions rather than a
 * class to match every other adapter in this directory; the object is what the
 * application layer injects.
 */
export const sqliteTransferRepository: TransferRepository = {
  mintTicket(): { ticket: string; ticketHash: string } {
    // Base64url-ish over 112 random hex chars: `hxbi_` (handoff bound intent)
    // prefix so an operator can tell a ticket from other secrets on screen.
    const ticket = "hxbi_" + randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
    return { ticket, ticketHash: createHash("sha256").update(ticket, "utf8").digest("hex") };
  },

  hashTicket(ticket: string): string {
    return createHash("sha256").update(ticket, "utf8").digest("hex");
  },

  isTicketHashTaken(ticketHash: string): boolean {
    if (!ticketHash) return false;
    return withAgentDatabase((db) => {
      const row = db
        .prepare("SELECT 1 AS one FROM handoff_intent WHERE ticket_hash=? LIMIT 1")
        .get(ticketHash) as { one: number } | undefined;
      return Boolean(row);
    });
  },

  insertIntent(intent: TransferIntent): void {
    withAgentDatabase((db) =>
      db
        .prepare(
          `INSERT INTO handoff_intent(intent_id, source_context_id, source_binding_id,
             target_connection_id, target_context_id, kind, state, source_epoch,
             ticket_hash, expires_at, approved_by_owner_id, approved_at, committed_at, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          intent.id,
          intent.sourceContextId,
          intent.sourceBindingId,
          intent.targetConnectionId,
          intent.targetContextId,
          intent.kind,
          intent.state,
          intent.sourceEpoch,
          intent.ticketHash,
          intent.expiresAt,
          intent.approvedByOwnerId,
          intent.approvedAt,
          intent.committedAt,
          intent.createdAt,
        ),
    );
  },

  getIntent(intentId: string): TransferIntent | null {
    if (!intentId) return null;
    return withAgentDatabase((db) => {
      const row = db.prepare(SELECT_BY_ID).get(intentId) as IntentRow | undefined;
      return row ? toIntent(row) : null;
    });
  },

  getLease(contextId: ContextId) {
    const row = getOwnershipLeaseRow(contextId);
    return row ? rehydrateOwnershipLease(row) : null;
  },

  hasOpenIntent(contextId: ContextId): boolean {
    if (!contextId) return false;
    return withAgentDatabase((db) => {
      const row = db
        .prepare(
          `SELECT 1 AS one FROM handoff_intent
           WHERE source_context_id=? AND state IN ('PREPARED','APPROVED','DRAINING')
           LIMIT 1`,
        )
        .get(contextId) as { one: number } | undefined;
      return Boolean(row);
    });
  },

  approveIntent(input): TransferIntent | null {
    if (!input.intentId || !input.ownerId.trim() || !input.ticketHash) return null;
    return withAgentDatabase((db) => {
      const outcome = db.transaction(() => {
        const row = db.prepare(SELECT_BY_ID).get(input.intentId) as IntentRow | undefined;
        if (!row) return null;
        if (row.state !== "PREPARED") return null;
        if (row.ticket_hash !== input.ticketHash) return null;
        if (row.expires_at <= input.now) return null;
        const changed = db
          .prepare(
            `UPDATE handoff_intent
               SET state='APPROVED', approved_by_owner_id=?, approved_at=?
             WHERE intent_id=? AND state='PREPARED' AND ticket_hash=?`,
          )
          .run(input.ownerId, input.now, input.intentId, input.ticketHash);
        if (changed.changes !== 1) return null;
        const updated = db.prepare(SELECT_BY_ID).get(input.intentId) as IntentRow;
        return toIntent(updated);
      })();
      return outcome;
    });
  },

  commitTransfer(input): TransferIntent {
    if (!input.intentId.trim() || !input.newBindingId.trim()) throw new Error("invalid_transfer_identity");

    // Pre-flight, OUTSIDE the transfer transaction. A stale intent describes a
    // lease state that no longer exists, so it is FAILED in its own transaction
    // — terminating inside the main transaction would roll the FAILED mark back
    // together with the rebind and leave the intent hung in APPROVED forever
    // (the operator would see a ticket that can never be redeemed and never
    // reports why).
    const intent = sqliteTransferRepository.getIntent(input.intentId);
    if (!intent) throw new Error("handoff_intent_not_found");
    if (intent.state !== "APPROVED") {
      if (isIntentTerminal(intent)) throw new Error("handoff_intent_terminal");
      throw new Error("handoff_intent_not_approved");
    }
    const lease = sqliteTransferRepository.getLease(intent.sourceContextId);
    if (!lease) throw new Error("ownership_lease_missing");
    if (lease.contextEpoch !== intent.sourceEpoch || lease.ownerBindingId !== intent.sourceBindingId) {
      sqliteTransferRepository.terminateIntent(input.intentId, "FAILED");
      throw new Error("ownership_lease_stale_epoch");
    }

    return withAgentDatabase((db) => {
      const nowIso = isoTimestamp(Date.now());
      return db.transaction(() => {
        const row = db.prepare(SELECT_BY_ID).get(input.intentId) as IntentRow | undefined;
        if (!row) throw new Error("handoff_intent_not_found");
        const txnIntent = toIntent(row);
        if (txnIntent.state !== "APPROVED") {
          if (isIntentTerminal(txnIntent)) throw new Error("handoff_intent_terminal");
          throw new Error("handoff_intent_not_approved");
        }

        const context = readContextOn(db, txnIntent.sourceContextId);
        if (!context) throw new Error("context_not_found");

        const txnLease = getOwnershipLeaseRow(txnIntent.sourceContextId);
        if (!txnLease) throw new Error("ownership_lease_missing");

        moveContextState(db, txnIntent.sourceContextId, "ACTIVE", "TRANSFERRING", nowIso);
        // The CAS on (epoch, binding) is the concurrent-transfer guard: a lease
        // that moved between the pre-flight and this UPDATE touches zero rows
        // and the whole transaction rolls back, leaving the Context ACTIVE and
        // the intent still APPROVED — redeemable once the operator retries and
        // hits the stale pre-flight above.
        transferContextOwnership({
          contextId: txnIntent.sourceContextId,
          expectedEpoch: txnLease.contextEpoch,
          expectedBindingId: txnLease.ownerBindingId,
          newBindingId: input.newBindingId,
          newDeadlineMs: Date.now() + TRANSFERRED_LEASE_TTL_MS,
        });
        moveContextState(db, txnIntent.sourceContextId, "TRANSFERRING", "ACTIVE", nowIso);

        const changed = db
          .prepare(
            `UPDATE handoff_intent
               SET state='COMMITTED', target_context_id=?, committed_at=?
             WHERE intent_id=? AND state='APPROVED'`,
          )
          .run(txnIntent.sourceContextId, nowIso, input.intentId);
        if (changed.changes !== 1) {
          // The intent moved between the pre-flight read and this write while
          // the Context was mid-TRANSFERRING. The lease bump above already
          // committed in this transaction; rolling back here would orphan a
          // rebound Context with an uncommitted intent, so let the transaction
          // fail loudly rather than half-committing.
          throw new Error("handoff_intent_not_approved");
        }
        return toIntent(db.prepare(SELECT_BY_ID).get(input.intentId) as IntentRow);
      })();
    });
  },

  terminateIntent(intentId, next): void {
    const changed = withAgentDatabase((db) =>
      db
        .prepare(
          `UPDATE handoff_intent SET state=?
           WHERE intent_id=? AND state IN ('PREPARED','APPROVED','DRAINING')`,
        )
        .run(next, intentId),
    );
    if (changed.changes !== 1) throw new Error("handoff_intent_not_terminable");
  },

  listOpenIntents(contextId: ContextId): readonly TransferIntent[] {
    if (!contextId) return [];
    return withAgentDatabase((db) =>
      (db
        .prepare(
          `SELECT * FROM handoff_intent
           WHERE source_context_id=? AND state IN ('PREPARED','APPROVED','DRAINING')
           ORDER BY created_at ASC`,
        )
        .all(contextId) as IntentRow[]).map(toIntent),
    );
  },
};

/** Lease TTL handed to the destination after a transfer commits. */
const TRANSFERRED_LEASE_TTL_MS = 5 * 60 * 1000;
