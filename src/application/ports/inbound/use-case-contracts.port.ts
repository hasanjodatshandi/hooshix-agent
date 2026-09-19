import type { Task, TaskStep } from "../../../domain/task/task.js";
import type { ApprovalId, PrincipalId, SessionId, StepId, TaskId, ToolId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
import type { ToolExecutionResult } from "../../use-cases/tools/execute-tool.usecase.js";
export interface ExecuteToolCommand {
 readonly principalId: PrincipalId; readonly sessionId: SessionId; readonly toolId: ToolId;
 readonly arguments: unknown; readonly task?: { readonly taskId: TaskId; readonly stepId: StepId; readonly workspaceScope: WorkspaceScope; readonly approvedActionFingerprint?: string };
}
export interface ToolExecutionUseCasePort { execute(input: ExecuteToolCommand): Promise<ToolExecutionResult>; }
export interface TaskUseCasePorts {
 create(input: { readonly title: string; readonly steps: readonly TaskStep[]; readonly principalId: PrincipalId; readonly sessionId: SessionId }): Promise<Task>;
 run(id: TaskId): Promise<Task>;
 resume(approvalId: ApprovalId): Promise<Task>;
 approve(approvalId: ApprovalId): Promise<boolean>;
 cancel(id: TaskId): Promise<Task>;
 append(id: TaskId, steps: readonly TaskStep[]): Promise<Task>;
 reconcile(id: TaskId, stepId: StepId, evidence: string): Promise<Task>;
 report(id: TaskId): Promise<unknown>;
}
export interface WorkspaceManagementUseCasePort { get(session: SessionId, principal: PrincipalId): Promise<WorkspaceScope | null>; set(scope: WorkspaceScope): Promise<void>; }
export interface OAuthUseCasePort { validateAccessToken(token: string): Promise<PrincipalId | null>; refresh(token: string): Promise<string | null>; }
export interface MonitoringUseCasePort { getMetrics(): Promise<Readonly<Record<string,number>>>; }
