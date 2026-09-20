import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../../domain/auth/principal.js";
import type { PrincipalId, SessionId } from "../../domain/shared/ids.js";
import { getConfiguredPermissionLevel } from "../config/permission-config.js";
import { hasSessionWorkspaceContext } from "../../security/workspace-guard.js";

export interface TrustedInboundIdentity {
  readonly principal: Principal;
  readonly sessionId: SessionId;
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
