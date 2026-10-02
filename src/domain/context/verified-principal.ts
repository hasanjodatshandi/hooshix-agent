import { DomainError } from "../shared/errors.js";
import type { BindingId, ConnectionId, PrincipalId } from "../shared/ids.js";
import { requireNonblankId } from "../shared/ids.js";

/**
 * CI-1.02 — VerifiedPrincipal: the immutable identity the server derived from a
 * verified credential, distinct from the raw token and from any client-supplied
 * claim.
 *
 * Design 03 §2: four identities must never collapse into one —
 *   account_owner_id  : the human/account that owns the grant
 *   connection_id     : the registered connection (client) the grant was issued to
 *   principal_id      : the server-issued party for this connection
 *   context_id        : the work environment the connection is bound to
 *
 * The current production defect (CI-G0) is exactly this collapse: every grant
 * receives principal_id "operator", so every chat shares one identity. This
 * value object is the replacement, and it is constructed ONLY by the credential
 * verification path (CI-2.02), never from tool arguments (threat T04).
 */
export interface VerifiedPrincipal {
  /** Account that owns the grant. */
  readonly ownerId: string;
  /** Server-issued party for this connection. */
  readonly principalId: PrincipalId;
  readonly connectionId: ConnectionId;
  /** Binding this credential currently holds, or null for an unbound credential. */
  readonly credentialBindingId: BindingId | null;
  readonly scopes: readonly string[];
}

export function createVerifiedPrincipal(input: {
  ownerId: string;
  principalId: string;
  connectionId: string;
  credentialBindingId?: string | null;
  scopes: readonly string[];
}): VerifiedPrincipal {
  if (!input.ownerId.trim()) throw new DomainError("MISSING_DEPENDENCY", "VerifiedPrincipal requires an owner");
  return Object.freeze({
    ownerId: input.ownerId,
    principalId: requireNonblankId<"PrincipalId">(input.principalId, "PrincipalId"),
    connectionId: requireNonblankId<"ConnectionId">(input.connectionId, "ConnectionId"),
    credentialBindingId: input.credentialBindingId === null || input.credentialBindingId === undefined
      ? null
      : requireNonblankId<"BindingId">(input.credentialBindingId, "BindingId"),
    scopes: Object.freeze([...input.scopes]),
  });
}

/**
 * A principal is "bound" only when it holds an active binding. An unbound
 * principal must be refused with CONTEXT_NOT_BOUND (I-06) — never attached to
 * the most recently used Context.
 */
export function isPrincipalBound(principal: VerifiedPrincipal): boolean {
  return principal.credentialBindingId !== null;
}

/** Scope check is deny-by-default: every required scope must be present. */
export function principalHasScopes(principal: VerifiedPrincipal, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const held = new Set(principal.scopes);
  return required.every((scope) => held.has(scope));
}
