import type { PrincipalId, SessionId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
export interface SetWorkspaceUseCase { execute(scope: WorkspaceScope): Promise<void>; }
export interface RemoveWorkspaceRootUseCase { execute(input: { readonly sessionId: SessionId; readonly principalId: PrincipalId; readonly root: string }): Promise<WorkspaceScope>; }
export interface ReplaceWorkspaceRootsUseCase { execute(scope: WorkspaceScope): Promise<void>; }
