import { DomainError } from "../shared/errors.js";
import type { BindingId, ContextId, IntentId } from "../shared/ids.js";
import { requireNonblankId } from "../shared/ids.js";

/**
 * CI-1.01 — TransferIntent: an owner-approved handoff of a Context's ownership
 * to a different connection (TRANSFER) or a sanitized copy into a new Context
 * (FORK).
 *
 * Design 07 §2 lifecycle:
 *   PREPARED -> APPROVED -> DRAINING -> COMMITTED
 *                        \-> CANCELLED / EXPIRED / FAILED
 *
 * The transfer ticket is a secret bound to the destination; it is NEVER emitted
 * into model-facing tool output (design 03 §4). Only its hash is persisted.
 */
export type HandoffKind = "TRANSFER" | "FORK";
export type IntentState =
  | "PREPARED" | "APPROVED" | "DRAINING" | "COMMITTED"
  | "CANCELLED" | "EXPIRED" | "FAILED";

export interface TransferIntent {
  readonly id: IntentId;
  readonly sourceContextId: ContextId;
  readonly sourceBindingId: BindingId;
  readonly targetConnectionId: string;
  readonly targetContextId: ContextId | null;
  readonly kind: HandoffKind;
  readonly state: IntentState;
  readonly sourceEpoch: number;
  /** SHA-256 of the one-time ticket; the raw ticket never touches storage. */
  readonly ticketHash: string;
  readonly expiresAt: string;
  readonly approvedByOwnerId: string | null;
  readonly approvedAt: string | null;
  readonly committedAt: string | null;
  readonly createdAt: string;
}

const ALLOWED_KINDS: ReadonlySet<HandoffKind> = new Set(["TRANSFER", "FORK"]);

export function createTransferIntent(input: {
  id: string; sourceContextId: string; sourceBindingId: string;
  targetConnectionId: string; kind: HandoffKind; sourceEpoch: number;
  ticketHash: string; expiresAt: string; now: string;
}): TransferIntent {
  if (!ALLOWED_KINDS.has(input.kind)) throw new DomainError("INVALID_ID", `Unknown handoff kind: ${input.kind}`);
  if (!Number.isSafeInteger(input.sourceEpoch) || input.sourceEpoch < 1) {
    throw new DomainError("INVALID_ID", "sourceEpoch must be an integer >= 1");
  }
  if (!input.targetConnectionId.trim()) throw new DomainError("MISSING_DEPENDENCY", "Transfer requires a target connection");
  if (!input.ticketHash.trim()) throw new DomainError("MISSING_DEPENDENCY", "Transfer requires a ticket hash");
  return Object.freeze({
    id: requireNonblankId<"IntentId">(input.id, "IntentId"),
    sourceContextId: requireNonblankId<"ContextId">(input.sourceContextId, "ContextId"),
    sourceBindingId: requireNonblankId<"BindingId">(input.sourceBindingId, "BindingId"),
    targetConnectionId: input.targetConnectionId,
    targetContextId: null,
    kind: input.kind,
    state: "PREPARED",
    sourceEpoch: input.sourceEpoch,
    ticketHash: input.ticketHash,
    expiresAt: input.expiresAt,
    approvedByOwnerId: null,
    approvedAt: null,
    committedAt: null,
    createdAt: input.now,
  });
}

const ALLOWED_TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> = Object.freeze({
  PREPARED: ["APPROVED", "CANCELLED", "EXPIRED", "FAILED"],
  APPROVED: ["DRAINING", "CANCELLED", "EXPIRED", "FAILED"],
  DRAINING: ["COMMITTED", "FAILED"],
  // Terminal states are final; a committed transfer is reversed only by a NEW
  // transfer with a fresh epoch (design 07 §6), never by rewinding this one.
  COMMITTED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
});

export function transitionTransferIntent(intent: TransferIntent, next: IntentState, now: string): TransferIntent {
  if (intent.state === next) return intent;
  const allowed = ALLOWED_TRANSITIONS[intent.state];
  if (!allowed || !allowed.includes(next)) {
    throw new DomainError("TASK_TERMINAL", `Illegal handoff transition ${intent.state} -> ${next}`);
  }
  return Object.freeze({
    ...intent,
    state: next,
    // Stamps are set on entry and never rewritten by a later transition.
    approvedAt: next === "APPROVED" ? now : intent.approvedAt,
    committedAt: next === "COMMITTED" ? now : intent.committedAt,
  });
}

/**
 * A ticket is single-use: replaying it after COMMITTED must not create a
 * second ownership. The repository consumes the ticket hash atomically (design
 * 03 §4, `jti` one-time in-transaction).
 */
export function isIntentTerminal(intent: TransferIntent): boolean {
  return intent.state === "COMMITTED" || intent.state === "CANCELLED" || intent.state === "EXPIRED" || intent.state === "FAILED";
}

/** Only the PREPARED/APPROVED owner may observe this intent from chat; the
 *  destination sees nothing until COMMITTED. */
export function isIntentVisibleToSource(intent: TransferIntent): boolean {
  return !isIntentTerminal(intent) || intent.state === "COMMITTED";
}
