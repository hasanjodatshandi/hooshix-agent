import { DomainError } from "../shared/errors.js";
import type { BindingId, ContextId, ContextEpoch, FencingToken } from "../shared/ids.js";
import { requireContextEpoch, requireNonblankId } from "../shared/ids.js";

/**
 * CI-1.01 — OwnershipLease: durable, monotonic fencing for Context ownership.
 *
 * Design 07 §6: changing context_epoch must be guarded in a persisted guard
 * before every new side effect of an old worker; checking once at task start
 * is not enough. The lease is the persisted guard: a worker holding a stale
 * (epoch, fencing token) pair is refused.
 *
 * This mirrors the per-task fencing already present in task_leases (R3.07),
 * raised to the Context level.
 */
export interface OwnershipLease {
  readonly contextId: ContextId;
  readonly ownerBindingId: BindingId;
  readonly contextEpoch: ContextEpoch;
  /** Absolute deadline in epoch milliseconds. */
  readonly leaseDeadlineMs: number;
  readonly fencingToken: FencingToken;
  readonly updatedAt: string;
}

export function createOwnershipLease(input: {
  contextId: string; ownerBindingId: string; contextEpoch: number;
  leaseDeadlineMs: number; fencingToken: string; now: string;
}): OwnershipLease {
  if (!Number.isSafeInteger(input.leaseDeadlineMs) || input.leaseDeadlineMs <= 0) {
    throw new DomainError("INVALID_ID", "leaseDeadlineMs must be a positive integer");
  }
  return Object.freeze({
    contextId: requireNonblankId<"ContextId">(input.contextId, "ContextId"),
    ownerBindingId: requireNonblankId<"BindingId">(input.ownerBindingId, "BindingId"),
    contextEpoch: requireContextEpoch(input.contextEpoch),
    leaseDeadlineMs: input.leaseDeadlineMs,
    fencingToken: requireNonblankId<"FencingToken">(input.fencingToken, "FencingToken"),
    updatedAt: input.now,
  });
}

/**
 * Rebuild a persisted lease row exactly as stored. The domain constructor is
 * the branding authority, and the transfer path reads a lease inside its own
 * transaction to decide whether a CAS will succeed — a plain string row must
 * become a domain value before that decision is made.
 */
export function rehydrateOwnershipLease(input: {
  contextId: string; ownerBindingId: string; contextEpoch: number;
  leaseDeadlineMs: number; fencingToken: string; updatedAt: string;
}): OwnershipLease {
  return Object.freeze({
    contextId: requireNonblankId<"ContextId">(input.contextId, "ContextId"),
    ownerBindingId: requireNonblankId<"BindingId">(input.ownerBindingId, "BindingId"),
    contextEpoch: requireContextEpoch(input.contextEpoch),
    leaseDeadlineMs: input.leaseDeadlineMs,
    fencingToken: requireNonblankId<"FencingToken">(input.fencingToken, "FencingToken"),
    updatedAt: input.updatedAt,
  });
}

/**
 * The CAS precondition used by the ownership repository (design 04 §6): the
 * epoch is advanced only when the row still carries the epoch and binding the
 * caller expects, asserted as exactly one changed row inside the same
 * transaction. A mismatch means another worker already moved the epoch — a
 * stale worker must not commit (threat T08).
 */
export function leaseMatches(lease: OwnershipLease, expectedEpoch: number, expectedBindingId: string): boolean {
  return lease.contextEpoch === expectedEpoch && lease.ownerBindingId === expectedBindingId;
}

/** A lease past its deadline confers no authority. */
export function isLeaseValid(lease: OwnershipLease, nowMs: number): boolean {
  return nowMs <= lease.leaseDeadlineMs;
}
