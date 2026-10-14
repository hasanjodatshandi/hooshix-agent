import type { CorrelationId, ExecutionId, PrincipalId, SessionId, TaskId, ToolId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
export interface ClockPort { now(): string; }
export interface IdGeneratorPort { nextTaskId(): TaskId; nextExecutionId(): ExecutionId; nextCorrelationId(): CorrelationId; }
export interface WorkspaceContextRepository {
  get(session: SessionId, principal: PrincipalId): Promise<WorkspaceScope | null>;
  set(session: SessionId, principal: PrincipalId, scope: WorkspaceScope): Promise<void>;
  remove(session: SessionId, principal: PrincipalId): Promise<void>;
}
/** `reason` is the closed-set label of a non-success outcome; a row without it cannot be triaged later. */
export interface AuditPort { record(event: { readonly action: string; readonly correlationId: CorrelationId; readonly status: string; readonly reason?: string }): Promise<void>; }
export interface SecurityEventPort { record(event: { readonly kind: string; readonly principalId: PrincipalId; readonly toolId?: ToolId; readonly reason?: string }): Promise<void>; }
