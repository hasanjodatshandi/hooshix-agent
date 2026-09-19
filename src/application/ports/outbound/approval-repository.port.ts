import type { Approval } from "../../../domain/approval/approval.js";
import type { ApprovalId, PrincipalId, TaskId, StepId, ToolId } from "../../../domain/shared/ids.js";
export interface ApprovalRepository {
  create(approval: Approval): Promise<ApprovalId>;
  get(id: ApprovalId): Promise<Approval | null>;
  approveIfPending(id: ApprovalId, principalId: PrincipalId, at: string): Promise<boolean>;
  consumeIfExact(input: { readonly id: ApprovalId; readonly taskId: TaskId; readonly stepId: StepId; readonly toolId: ToolId; readonly actionFingerprint: string; readonly at: string }): Promise<boolean>;
  revokeForTask(taskId: TaskId, at: string): Promise<number>;
  expireBefore(at: string): Promise<number>;
}
