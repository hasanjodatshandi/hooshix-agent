import type { ApprovalId, PrincipalId, StepId, TaskId, ToolId } from "../shared/ids.js";
import type { ToolRisk } from "../tool/tool-descriptor.js";
export type ApprovalState = "pending" | "approved" | "consumed" | "revoked" | "expired";
export interface Approval {
  readonly id: ApprovalId; readonly taskId: TaskId; readonly stepId: StepId;
  readonly toolId: ToolId; readonly actionFingerprint: string; readonly state: ApprovalState;
  readonly risk: ToolRisk; readonly requestedAt: string; readonly approvedBy?: PrincipalId;
  readonly approvedAt?: string; readonly expiresAt?: string;
}
