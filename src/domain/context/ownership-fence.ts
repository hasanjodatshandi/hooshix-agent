/**
 * CI-G5 — the ownership fence checked before every side effect.
 *
 * A Task records the Context it was created under, together with the ownership
 * epoch observed at creation (design 07 §6). Before the Task is allowed to
 * commit any new effect, that recorded epoch is compared against the live
 * ownership_lease. If ownership moved — the Context was transferred (CI-6), the
 * lease was taken by another binding, or the epoch advanced for any reason —
 * this worker is stale and must not commit, even if its tool call already
 * produced an external effect (threat T08). The caller converts `fenced` into a
 * terminal `outcome_unknown` step rather than a retryable failure: the whole
 * point is that a stale worker never re-runs.
 *
 * What this is NOT:
 *  - It is not the per-task lease guard (R3.07 already covers that via
 *    assertTaskLeaseWrite). This is the Context-level fence: a Task whose own
 *    lease is still live can still be fenced out because its Context moved.
 *  - It is not a deny on a missing Context. Tasks created while
 *    CTX_ISOLATION_MODE=OFF record no Context and the fence no-ops for them —
 *    the flag is opt-in and every pre-existing Task is in exactly that state.
 *    A Task WITH a recorded Context whose lease row is gone IS fenced
 *    (fail-closed): the row only vanishes before the first acquisition or after
 *    an explicit release, and neither state authorizes side effects.
 *
 * The fencing token is deliberately not part of the recorded triple. It rotates
 * in lockstep with the epoch (acquireOwnershipLease / advanceOwnershipEpoch
 * regenerate it on every bump, renewal keeps it), so an (epoch, binding) match
 * proves the token matches too. Storing the token on the Task would add a
 * secret to a row every tool write touches, for no extra guarantee.
 *
 * This module is deliberately free of imports: the decision is pure over its
 * two inputs, so it stays in the domain layer and is directly unit-testable.
 */

/** The ownership state a Task captured at creation. */
export interface HeldOwnership {
  readonly contextId: string;
  readonly ownershipEpoch: number;
  readonly createdByBindingId: string;
}

/** The live lease state, read inside the caller's write transaction. */
export interface LiveOwnership {
  readonly contextEpoch: number;
  readonly ownerBindingId: string;
  readonly leaseDeadlineMs: number;
}

export type OwnershipFenceOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "fenced"; readonly reason: "ownership_lease_missing" | "context_epoch_stale" };

/**
 * Pure decision: may this Task commit a side effect under the ownership it
 * recorded? Both inputs come from the caller, so the DB read and the decision
 * stay separable and the logic is directly unit-testable.
 */
export function checkOwnershipFence(input: {
  readonly held: HeldOwnership | undefined;
  readonly live: LiveOwnership | null;
  readonly nowMs: number;
}): OwnershipFenceOutcome {
  // Unbound Task (created with the flag OFF): no Context, no fence.
  if (!input.held) return { kind: "ok" };

  if (!input.live) return { kind: "fenced", reason: "ownership_lease_missing" };
  if (
    input.live.contextEpoch !== input.held.ownershipEpoch ||
    input.live.ownerBindingId !== input.held.createdByBindingId ||
    input.live.leaseDeadlineMs <= input.nowMs
  ) {
    return { kind: "fenced", reason: "context_epoch_stale" };
  }
  return { kind: "ok" };
}
