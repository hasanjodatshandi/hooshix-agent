import type { ApprovalId, CorrelationId, ExecutionId, PrincipalId, SessionId, TaskId, ToolId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
export interface ClockPort { now(): string; }
export interface IdGeneratorPort { nextTaskId(): TaskId; nextExecutionId(): ExecutionId; nextCorrelationId(): CorrelationId; }
export interface TokenGeneratorPort { generateOpaque(bytes: number): string; hashOpaque(token: string): string; constantTimeEqual(a: string, b: string): boolean; }
export interface WorkspaceContextRepository {
  get(session: SessionId, principal: PrincipalId): Promise<WorkspaceScope | null>;
  set(session: SessionId, principal: PrincipalId, scope: WorkspaceScope): Promise<void>;
  remove(session: SessionId, principal: PrincipalId): Promise<void>;
}
export interface AuditPort { record(event: { readonly action: string; readonly correlationId: CorrelationId; readonly status: string }): Promise<void>; }
export interface SecurityEventPort { record(event: { readonly kind: string; readonly principalId: PrincipalId; readonly toolId?: ToolId; readonly reason?: string }): Promise<void>; }
export interface TracePort { record(event: { readonly taskId?: TaskId; readonly event: string; readonly time: string }): Promise<void>; }
export interface MetricsPort { increment(event: { readonly metric: string; readonly toolId?: ToolId }): Promise<void>; }
export interface CheckpointRepository { store(taskId: TaskId, step: number, receipt: unknown): Promise<void>; }
export interface RecoveryEventRepository { record(taskId: TaskId, event: string): Promise<void>; }
export interface FileBackupRepository { put(id: string, content: Uint8Array): Promise<void>; get(id: string): Promise<Uint8Array | null>; }
export interface ProjectRepository { get(id: string): Promise<{ readonly id: string; readonly path: string } | null>; }
export interface PackageSnapshotRepository { record(id: string, manifests: Readonly<Record<string,string>>): Promise<void>; }
export interface ExecutionTraceRepository { record(id: ExecutionId, step: string): Promise<void>; }
export interface OAuthTokenRepository { findByHash(hash: string): Promise<unknown | null>; rotate(refreshHash: string, at: string): Promise<unknown>; }
export interface AuthorizationCodeStore { save(codeHash: string, principal: PrincipalId): Promise<void>; consume(codeHash: string): Promise<PrincipalId | null>; }
export interface RateLimiterPort { consume(key: string, now: string): Promise<{ readonly allowed: boolean; readonly retryAfterMs?: number }>; }
export interface ApprovalDecisionRepository { record(approvalId: ApprovalId, event: string): Promise<void>; }
