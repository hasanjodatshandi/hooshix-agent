import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { withAgentDatabase } from "../../../../../core/memory/database/index.js";

/**
 * CI-2.04 — Context ownership leases, with monotonic fencing.
 *
 * Mirrors the per-Task fencing already shipped in task-lease.adapter.ts (R3.07),
 * raised to the Context level. The lease is the persisted guard the design
 * demands: changing context_epoch must be checked before EVERY new side effect
 * of an old worker, not once at task start (design 07 §6). A worker holding a
 * stale (epoch, fencing token) pair is refused, so it cannot commit after a
 * handoff has moved ownership (threat T08).
 *
 * All mutations are compare-and-set: the WHERE clause carries the epoch and
 * binding the caller believes it holds, and exactly one row must change —
 * asserted inside the same transaction.
 */

const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 24 * 60 * 60_000;

export interface OwnershipLeaseRecord {
  readonly contextId: string;
  readonly ownerBindingId: string;
  readonly contextEpoch: number;
  /** Absolute deadline in epoch milliseconds. */
  readonly leaseDeadlineMs: number;
  readonly fencingToken: string;
  readonly updatedAt: string;
}

function validateTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS)
    throw new Error("invalid_ownership_lease_ttl");
}

interface LeaseRow {
  context_id: string;
  owner_binding_id: string;
  context_epoch: number;
  lease_deadline_ms: number;
  fencing_token: string;
  updated_at: string;
}

function toRecord(row: LeaseRow): OwnershipLeaseRecord {
  return {
    contextId: row.context_id,
    ownerBindingId: row.owner_binding_id,
    contextEpoch: row.context_epoch,
    leaseDeadlineMs: row.lease_deadline_ms,
    fencingToken: row.fencing_token,
    updatedAt: row.updated_at,
  };
}

/** Alias used by the transfer adapter, which reads through the same mapping. */
export const toLeaseRecord = toRecord;

const iso = (time: number) => new Date(time).toISOString();
export {iso as isoTimestamp};

/** Read the current lease for a Context, or null if it has never been leased. */
export function getOwnershipLease(contextId: string): OwnershipLeaseRecord | null {
  if (!contextId) return null;
  return withAgentDatabase((db) => {
    const row = db
      .prepare("SELECT * FROM ownership_lease WHERE context_id=?")
      .get(contextId) as LeaseRow | undefined;
    return row ? toRecord(row) : null;
  });
}

/** Same read, on a connection the caller already holds (transfer transaction). */
export function getOwnershipLeaseRow(contextId: string): OwnershipLeaseRecord | null {
  if (!contextId) return null;
  return withAgentDatabase((db) => {
    const row = db
      .prepare("SELECT * FROM ownership_lease WHERE context_id=?")
      .get(contextId) as LeaseRow | undefined;
    return row ? toRecord(row) : null;
  });
}

/**
 * Acquire (or re-acquire) the lease on a Context. Atomic SQLite competition:
 * the conflict clause increments the MONOTONIC epoch, so a worker that lost the
 * race cannot regain authority. Throws `ownership_lease_conflict` when a live
 * lease is held by another binding.
 */
export function acquireOwnershipLease(
  contextId: string,
  ownerBindingId: string,
  ttlMs = 60_000,
): OwnershipLeaseRecord {
  validateTtl(ttlMs);
  if (!contextId || !ownerBindingId) throw new Error("invalid_ownership_lease_identity");
  return withAgentDatabase((db) => {
    const now = Date.now();
    const deadline = now + ttlMs;
    const changed = db
      .prepare(
        `INSERT INTO ownership_lease(context_id, owner_binding_id, context_epoch, lease_deadline_ms, fencing_token, updated_at)
         VALUES(?,?,1,?,?,?)
         ON CONFLICT(context_id) DO UPDATE SET
           owner_binding_id=excluded.owner_binding_id,
           context_epoch=ownership_lease.context_epoch+1,
           lease_deadline_ms=excluded.lease_deadline_ms,
           fencing_token=excluded.fencing_token,
           updated_at=excluded.updated_at
         WHERE ownership_lease.lease_deadline_ms<=?`,
      )
      .run(contextId, ownerBindingId, deadline, randomUUID(), iso(deadline), now);
    if (changed.changes !== 1) throw new Error("ownership_lease_conflict");
    return readLeaseOrThrow(db, contextId);
  });
}

/**
 * The CAS the handoff path uses (design 04 §6): advance the epoch only when the
 * row still carries the epoch and binding the caller expects. Exactly one row
 * must change, asserted in the same transaction; otherwise a faster worker has
 * already moved ownership and this caller is stale. The binding is unchanged —
 * this is a renewal under fencing; transferring to another binding is the
 * handoff path (CI-6).
 */
export function advanceOwnershipEpoch(input: {
  readonly contextId: string;
  readonly expectedEpoch: number;
  readonly expectedBindingId: string;
  readonly fencingToken: string;
  readonly newDeadlineMs: number;
}): OwnershipLeaseRecord {
  if (!input.contextId || !input.expectedBindingId) throw new Error("invalid_ownership_lease_identity");
  if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1) throw new Error("invalid_ownership_epoch");
  if (!Number.isSafeInteger(input.newDeadlineMs) || input.newDeadlineMs <= 0) throw new Error("invalid_ownership_deadline");
  return withAgentDatabase((db) => {
    const now = Date.now();
    const outcome = db.transaction(() => {
      const changed = db
        .prepare(
          `UPDATE ownership_lease SET
             context_epoch=context_epoch+1,
             lease_deadline_ms=?,
             fencing_token=?,
             updated_at=?
           WHERE context_id=?
             AND context_epoch=?
             AND owner_binding_id=?`,
        )
        .run(
          input.newDeadlineMs,
          input.fencingToken,
          iso(now),
          input.contextId,
          input.expectedEpoch,
          input.expectedBindingId,
        );
      return changed;
    })();
    if (outcome.changes !== 1) throw new Error("ownership_lease_stale_epoch");
    return readLeaseOrThrow(db, input.contextId);
  });
}

/**
 * CI-G6 — the atomic rebind at the heart of an owner-approved transfer.
 *
 * Unlike `advanceOwnershipEpoch` (renewal under the SAME binding, design 04
 * §6), this changes WHO owns the Context: the lease row moves to a new binding
 * and bumps the epoch in one CAS. The epoch bump is what fences the old chat
 * out — every Task it created recorded the old epoch, so the CI-G5 fence
 * refuses its next side effect without a re-run (threat T08/T09).
 *
 * The CAS requires the caller to present the lease it expects to move: the
 * recorded (epoch, binding) pair. A concurrent transfer that already moved the
 * Context changes one of them and this update touches zero rows, so the whole
 * calling transaction rolls back rather than double-rebinding (threat T10).
 *
 * Returns the new lease so the caller can hand the destination its fencing
 * token without a second read.
 */
export function transferContextOwnership(input: {
  readonly contextId: string;
  readonly expectedEpoch: number;
  readonly expectedBindingId: string;
  readonly newBindingId: string;
  readonly newDeadlineMs: number;
}): OwnershipLeaseRecord {
  if (!input.contextId || !input.expectedBindingId || !input.newBindingId) {
    throw new Error("invalid_ownership_lease_identity");
  }
  if (input.expectedBindingId === input.newBindingId) {
    throw new Error("invalid_ownership_transfer_self");
  }
  if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1) {
    throw new Error("invalid_ownership_epoch");
  }
  if (!Number.isSafeInteger(input.newDeadlineMs) || input.newDeadlineMs <= 0) {
    throw new Error("invalid_ownership_deadline");
  }
  return withAgentDatabase((db) => {
    const now = Date.now();
    const outcome = db.transaction(() => {
      const changed = db
        .prepare(
          `UPDATE ownership_lease SET
             owner_binding_id=?,
             context_epoch=context_epoch+1,
             lease_deadline_ms=?,
             fencing_token=?,
             updated_at=?
           WHERE context_id=?
             AND context_epoch=?
             AND owner_binding_id=?`,
        )
        .run(
          input.newBindingId,
          input.newDeadlineMs,
          randomUUID(),
          iso(now),
          input.contextId,
          input.expectedEpoch,
          input.expectedBindingId,
        );
      return changed;
    })();
    if (outcome.changes !== 1) throw new Error("ownership_lease_stale_epoch");
    return readLeaseOrThrow(db, input.contextId);
  });
}

/**
 * Release a lease voluntarily (handoff commit). A released lease confers no
 * authority; epoch advance is what matters, so this marks the deadline passed.
 */
export function releaseOwnershipLease(
  contextId: string,
  ownerBindingId: string,
  fencingToken: string,
): boolean {
  return withAgentDatabase((db) => {
    const now = Date.now();
    const changed = db
      .prepare(
        `UPDATE ownership_lease SET lease_deadline_ms=?, updated_at=?
         WHERE context_id=? AND owner_binding_id=? AND fencing_token=?`,
      )
      .run(now, iso(now), contextId, ownerBindingId, fencingToken);
    return changed.changes === 1;
  });
}

/**
 * The guard every Context-scoped side effect must pass. Checks the ACTUAL DB
 * epoch, binding and deadline in the same synchronous connection as the write
 * transaction, so a worker whose lease was superseded can never persist a late
 * result — including a previously successful external effect.
 */
export function assertOwnershipWrite(
  db: Database.Database,
  contextId: string,
  held: { readonly ownerBindingId: string; readonly contextEpoch: number; readonly fencingToken: string },
): void {
  const row = db
    .prepare("SELECT * FROM ownership_lease WHERE context_id=?")
    .get(contextId) as LeaseRow | undefined;
  if (!row) throw new Error("ownership_lease_missing");
  const now = Date.now();
  if (
    row.owner_binding_id !== held.ownerBindingId ||
    row.context_epoch !== held.contextEpoch ||
    row.fencing_token !== held.fencingToken ||
    row.lease_deadline_ms <= now
  ) {
    throw new Error("ownership_lease_fenced");
  }
}

function readLeaseOrThrow(db: Database.Database, contextId: string): OwnershipLeaseRecord {
  const row = db.prepare("SELECT * FROM ownership_lease WHERE context_id=?").get(contextId) as LeaseRow | undefined;
  if (!row) throw new Error("ownership_lease_missing");
  return toRecord(row);
}
