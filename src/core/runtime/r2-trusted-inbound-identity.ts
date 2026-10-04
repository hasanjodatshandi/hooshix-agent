import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../../domain/auth/principal.js";
import type { PrincipalId, SessionId } from "../../domain/shared/ids.js";
import { getConfiguredPermissionLevel } from "../../infrastructure/config/permission-config.js";
import { hasSessionWorkspaceContext } from "../../security/workspace-guard.js";

/**
 * CI-G5 — the Context a request resolved to, threaded alongside the trusted
 * identity.
 *
 * CI-G4 proved the credential resolves to exactly one Context and refuses it at
 * the edge otherwise. The resolution itself was then discarded. CI-G5 needs it
 * downstream: a Task created by this request must record which Context
 * authorized it, and every side effect must recheck that Context's ownership
 * epoch. That requires the (contextId, grantId, epoch, bindingId) tuple to
 * travel from the /mcp edge — the only place that computes it — to the task
 * runtime, without a new global lookup that could silently fall back to
 * something else (threat T04).
 *
 * Absent means "no Context applies": CTX_ISOLATION_MODE=OFF, or a code path
 * (local stdio, a unit test) that never resolved a credential. Callers must
 * treat absent as unbound rather than inventing a Context — the task runtime
 * records null and the fencing check then no-ops, exactly as it does for every
 * Task created before this flag existed.
 */
export interface ResolvedContext {
  readonly contextId: string;
  readonly workspaceGrantId: string;
  /** Ownership epoch observed when the request was authorized. */
  readonly ownershipEpoch: number;
  /** The binding that authorized this request — the lease's expected owner. */
  readonly createdByBindingId: string;
}

export interface TrustedInboundIdentity {
  readonly principal: Principal;
  readonly sessionId: SessionId;
  /** CI-G5: the Context this request resolved to, or undefined when unbound. */
  readonly resolvedContext?: ResolvedContext;
}
/** Only HTTP transport/bootstrap and the trusted Task runner install this context. */
const inbound = new AsyncLocalStorage<TrustedInboundIdentity>();
export function runWithTrustedInboundIdentity<T>(identity: TrustedInboundIdentity, run: () => T): T {
  if (!identity.principal.id || !identity.sessionId) throw new Error("missing_trusted_identity");
  return inbound.run(identity, run);
}
export function getTrustedInboundIdentity(): TrustedInboundIdentity {
  const current=inbound.getStore();
  if (current) return current;
  // The HTTP workspace context is stronger evidence than a missing identity;
  // never silently fall back to the stdio operator for an HTTP request.
  if (hasSessionWorkspaceContext()) throw new Error("http_principal_context_missing");
  const permission=({
    READ_ONLY:"READ",PROJECT_ACCESS:"PROJECT_ACCESS",DEVELOPER_MODE:"DEVELOPER",ADMIN_MODE:"ADMIN",
  } as const)[getConfiguredPermissionLevel()];
  return {
    principal: {id:"local-stdio" as PrincipalId,permission,origin:"local_stdio",scopes:[]},
    sessionId:"local-stdio-session" as SessionId,
  };
}
