import type {HandoffKind, TransferIntent} from "../../domain/context/transfer-intent.js";
import {createTransferIntent, isIntentTerminal} from "../../domain/context/transfer-intent.js";
import {
  ContextInactiveError,
  ContextNotBoundError,
  TransferInProgressError,
} from "../../domain/context/context-errors.js";
import type {
  TransferRepository,
} from "../ports/outbound/context.port.js";

/**
 * CI-G6 — the two-phase ownership transfer.
 *
 * Design 07 §2 / design 04 §6. A stuck chat does not get its ownership pried
 * away by whoever asks first; the transfer is an explicit, owner-approved
 * protocol with a persisted paper trail:
 *
 *   prepare  → intent PREPARED, ticket issued ONCE, hash persisted only
 *   approve  → owner presents the ticket; intent APPROVED, approver recorded
 *   commit   → one transaction: Context TRANSFERRING → lease rebind + epoch
 *              bump → Context ACTIVE → intent COMMITTED
 *
 * Why the phases are separate and persisted:
 *  - The operator who can approve is not necessarily the chat that needs
 *    relief, and not necessarily online when the chat gets stuck. A prepared
 *    intent survives a restart and can be approved from the Owner Console.
 *  - The ticket is the capability. Only its hash is ever persisted, so a
 *    database read cannot be turned into a live transfer capability; the raw
 *    ticket exists only in the single return value of `prepareHandoff`.
 *  - The epoch bump inside the commit is the whole point for CI-G5: it makes
 *    the old chat's recorded ownership stale, so its next side effect dies
 *    with outcome_unknown instead of re-running (threat T08/T09).
 *
 * Concurrency: every state change is a CAS guarded by the current state, so
 * two concurrent approvals of the same intent, or two transfers of the same
 * Context, cannot both succeed — one touches zero rows and rolls back.
 *
 * What this deliberately does NOT do: move Task rows. The gate's "new chat
 * continues from checkpoint" is FORK, which snapshots Task state without
 * copying secrets; that is a separate leaf because the sanitized snapshot
 * needs its own disclosure review.
 */

/** How long an unapproved intent stays redeemable. */
const INTENT_TTL_MS = 15 * 60 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();

export interface PreparedHandoff {
  readonly intentId: string;
  /** One-time capability. Never persisted; returned to the caller exactly once. */
  readonly ticket: string;
  readonly kind: HandoffKind;
  readonly sourceContextId: string;
  readonly targetConnectionId: string;
  readonly expiresAt: string;
}

/**
 * Phase 1 — record the intent and mint the one-time ticket.
 *
 * `sourceContextId` is the Context needing relief and `targetConnectionId` is
 * the connection that will own it afterwards. The caller is the source chat or
 * an operator action; the capability to APPROVE is the ticket, not the act of
 * preparing, so preparing on someone's behalf grants nothing by itself.
 *
 * Refuses when the Context has no lease yet (nothing to transfer — the
 * resolution layer binds a Context on first request, so this only happens for
 * a never-used Context id), when an open transfer is already in flight, or
 * when the target connection is the current owner.
 */
export function prepareHandoff(
  repo: TransferRepository,
  input: {
    sourceContextId: string;
    sourceBindingId: string;
    targetConnectionId: string;
    kind: HandoffKind;
    /** Entropy source, injected so tests are deterministic. */
    randomId: () => string;
  },
): PreparedHandoff {
  if (!input.sourceContextId.trim() || !input.sourceBindingId.trim() || !input.targetConnectionId.trim()) {
    throw new ContextNotBoundError();
  }

  const lease = repo.getLease(input.sourceContextId as never);
  if (!lease) throw new ContextNotBoundError();
  if (lease.ownerBindingId === input.targetConnectionId) throw new ContextNotBoundError();
  if (repo.hasOpenIntent(input.sourceContextId as never)) throw new TransferInProgressError();

  const now = Date.now();
  const {ticket, ticketHash} = repo.mintTicket();
  if (repo.isTicketHashTaken(ticketHash)) {
    // Astronomically unlikely, but a UNIQUE violation mid-insert would abort
    // the transaction; refuse deterministically instead of retrying blind.
    throw new Error("handoff_ticket_collision");
  }

  const intent = createTransferIntent({
    id: input.randomId(),
    sourceContextId: input.sourceContextId,
    sourceBindingId: input.sourceBindingId,
    targetConnectionId: input.targetConnectionId,
    kind: input.kind,
    sourceEpoch: lease.contextEpoch,
    ticketHash,
    expiresAt: iso(now + INTENT_TTL_MS),
    now: iso(now),
  });
  repo.insertIntent(intent);

  return {
    intentId: intent.id,
    ticket,
    kind: intent.kind,
    sourceContextId: intent.sourceContextId,
    targetConnectionId: intent.targetConnectionId,
    expiresAt: intent.expiresAt,
  };
}

/**
 * Phase 2a — the owner redeems the ticket. The approver is recorded by id; the
 * ticket is single-use, so a replay finds the intent no longer PREPARED.
 *
 * Returns the APPROVED intent, or throws when the ticket is wrong, the intent
 * is gone, or it already moved. Callers surface a stable sentinel, not the
 * distinguishing reason (threat T07).
 */
export function approveHandoff(
  repo: TransferRepository,
  input: { intentId: string; ownerId: string; ticket: string },
): TransferIntent {
  const approved = repo.approveIntent({
    intentId: input.intentId,
    ownerId: input.ownerId,
    ticketHash: repo.hashTicket(input.ticket),
    now: iso(Date.now()),
  });
  if (!approved) throw new ContextInactiveError();
  return approved;
}

/**
 * Phase 2b — commit the transfer atomically.
 *
 * The rebind, the epoch bump, the Context state moves and the intent commit
 * all land in one transaction (see `commitTransfer` in the SQLite adapter), so
 * a Context is never left TRANSFERRING and a lease is never rebound without
 * the intent landing in COMMITTED.
 *
 * `newBindingId` is the binding the destination connection will hold. A stale
 * CAS means someone else moved the Context first; the adapter FAILs the intent
 * rather than leaving it APPROVED forever, so the operator sees the outcome.
 */
export function commitHandoff(
  repo: TransferRepository,
  input: { intentId: string; newBindingId: string },
): TransferIntent {
  if (!input.intentId.trim() || !input.newBindingId.trim()) throw new ContextNotBoundError();
  try {
    return repo.commitTransfer({
      intentId: input.intentId,
      newBindingId: input.newBindingId as never,
      now: iso(Date.now()),
    });
  } catch (error) {
    // The adapter's CAS failures are stable sentinels the Owner Console can
    // display; unknown ones propagate.
    if (error instanceof Error) {
      if (/handoff_intent_terminal/.test(error.message)) throw new ContextInactiveError();
      if (/handoff_intent_not_approved/.test(error.message)) throw new TransferInProgressError();
      if (/handoff_intent_not_found|context_not_found|ownership_lease_missing/.test(error.message)) {
        throw new ContextNotBoundError();
      }
      if (/ownership_lease_stale_epoch/.test(error.message)) throw new ContextInactiveError();
    }
    throw error;
  }
}

/**
 * Withdraw an intent the operator has not approved. Only PREPARED/APPROVED
 * intents can be cancelled; a COMMITTED transfer is history and is reversed
 * only by a NEW transfer with a fresh epoch.
 */
export function cancelHandoff(repo: TransferRepository, intentId: string): void {
  if (!intentId) throw new ContextNotBoundError();
  const intent = repo.getIntent(intentId);
  if (!intent) throw new ContextNotBoundError();
  if (isIntentTerminal(intent)) throw new ContextInactiveError();
  repo.terminateIntent(intentId, "CANCELLED");
}

/** Inspect an intent without consuming anything. Used by the Owner Console UI. */
export function describeHandoff(repo: TransferRepository, intentId: string): TransferIntent | null {
  return repo.getIntent(intentId);
}
