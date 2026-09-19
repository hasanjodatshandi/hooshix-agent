import type { PrincipalId, SessionId } from "../shared/ids.js";
export interface WorkspaceScope {
  readonly principalId: PrincipalId;
  readonly sessionId: SessionId;
  readonly root: string | null;
  readonly allowedRoots: readonly string[];
  readonly unrestricted: boolean;
  readonly capturedAt: string;
}
/** Copy scope at task creation: no mutable session object survives in a task. */
export function captureWorkspaceScope(scope: WorkspaceScope): WorkspaceScope {
  if (!scope.principalId || !scope.sessionId) throw new Error("Missing workspace principal/session identity");
  return Object.freeze({ ...scope, allowedRoots: Object.freeze([...scope.allowedRoots]) });
}
export interface AuthorizedPath { readonly canonicalPath: string; readonly scope: WorkspaceScope; readonly purpose: "read" | "write"; }
