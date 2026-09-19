import type { PrincipalId, SessionId } from "../../../domain/shared/ids.js";
import { captureWorkspaceScope, type WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
import type { WorkspaceContextRepository } from "../../../application/ports/outbound/support.port.js";
/** Principal and session jointly scope in-memory direct context. No global mutable active root. */
export function createMemoryWorkspaceContextRepository(): WorkspaceContextRepository {
 const contexts = new Map<string,WorkspaceScope>();
 const key=(session:SessionId,principal:PrincipalId)=>JSON.stringify([principal,session]);
 return {
   async get(session,principal) { const scope=contexts.get(key(session,principal));return scope ? captureWorkspaceScope(scope):null; },
   async set(session,principal,scope) {
     if(session!==scope.sessionId||principal!==scope.principalId) throw new Error("workspace_identity_mismatch");
     contexts.set(key(session,principal),captureWorkspaceScope(scope));
   },
   async remove(session,principal) { contexts.delete(key(session,principal)); },
 };
}
