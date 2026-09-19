import type { PrincipalId, SessionId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
import type { WorkspaceContextRepository } from "../../ports/outbound/support.port.js";
export function createGetWorkspaceUseCase(repository: WorkspaceContextRepository): { execute(session: SessionId, principal: PrincipalId): Promise<WorkspaceScope | null> } {
 return { execute(session, principal) { return repository.get(session, principal); } };
}
