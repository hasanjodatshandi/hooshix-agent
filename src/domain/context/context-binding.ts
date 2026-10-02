import { DomainError } from "../shared/errors.js";
import type { BindingId, ConnectionId, ContextId } from "../shared/ids.js";
import { requireNonblankId } from "../shared/ids.js";

/**
 * CI-1.01 — ContextBinding: the server-side relationship between one verified
 * credential/connection and exactly one Context.
 *
 * Design 03 §1: four identities are distinct — account_owner_id (human),
 * connection_id (registered connection), context_id (work environment) and
 * task_id (operation). A `contextId` supplied in tool arguments is NOT a
 * document of the sender's conversation (threat T04); only this binding is.
 *
 * I-07: handoff does not silently make an old binding valid for a new context.
 * A REVOKED binding never becomes valid again; a new context requires a new
 * binding.
 */
export type BindingState = "ACTIVE" | "REVOKED" | "EXPIRED";

export interface ContextBinding {
  readonly id: BindingId;
  readonly ownerId: string;
  readonly contextId: ContextId;
  readonly connectionId: ConnectionId;
  /** SHA-256 of the credential. The raw token is never stored. */
  readonly credentialHash: string;
  readonly credentialVersion: number;
  readonly scopes: readonly string[];
  readonly state: BindingState;
  readonly createdAt: string;
}

export function createContextBinding(input: {
  id: string; ownerId: string; contextId: string; connectionId: string;
  credentialHash: string; credentialVersion?: number; scopes: readonly string[];
  now: string;
}): ContextBinding {
  if (!input.ownerId.trim()) throw new DomainError("MISSING_DEPENDENCY", "Binding requires an owner");
  if (!input.credentialHash.trim()) throw new DomainError("MISSING_DEPENDENCY", "Binding requires a credential hash");
  if (!Number.isSafeInteger(input.credentialVersion ?? 1) || (input.credentialVersion ?? 1) < 1) {
    throw new DomainError("INVALID_ID", "credentialVersion must be a positive integer");
  }
  return Object.freeze({
    id: requireNonblankId<"BindingId">(input.id, "BindingId"),
    ownerId: input.ownerId,
    contextId: requireNonblankId<"ContextId">(input.contextId, "ContextId"),
    connectionId: requireNonblankId<"ConnectionId">(input.connectionId, "ConnectionId"),
    credentialHash: input.credentialHash,
    credentialVersion: input.credentialVersion ?? 1,
    scopes: Object.freeze([...input.scopes]),
    state: "ACTIVE",
    createdAt: input.now,
  });
}

/**
 * The only lifecycle a binding has is ACTIVE -> (REVOKED | EXPIRED).
 * Reactivation is impossible by construction (I-07); a fresh credential must
 * create a fresh binding. The timestamp of the lifecycle event is written to
 * the security audit log (CI-2), not to this immutable record.
 */
export function revokeContextBinding(binding: ContextBinding): ContextBinding {
  return transitionBinding(binding, "REVOKED");
}
export function expireContextBinding(binding: ContextBinding): ContextBinding {
  return transitionBinding(binding, "EXPIRED");
}
function transitionBinding(binding: ContextBinding, next: Exclude<BindingState, "ACTIVE">): ContextBinding {
  if (binding.state !== "ACTIVE") {
    throw new DomainError("TASK_TERMINAL", `A ${binding.state} binding cannot become ${next}`);
  }
  return Object.freeze({ ...binding, state: next });
}

/** Only an ACTIVE binding resolves a request to a Context (deny-by-default). */
export function isBindingUsable(binding: ContextBinding): boolean {
  return binding.state === "ACTIVE";
}
