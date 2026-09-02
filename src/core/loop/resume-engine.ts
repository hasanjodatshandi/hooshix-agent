import { getLatestCheckpoint } from "../memory/checkpoint-memory.js";
import { getApprovalRequest } from "../governance/approval-memory.js";

export interface ResumeContext {
  taskId: string;
  stepId: number;
  stepIndex: number;
  state: unknown;
  correlationId?: string;
  action: string;
}

export function canResumeApprovedTask(approvalId: number): ResumeContext | null {
  const approval = getApprovalRequest(approvalId);

  if (!approval || approval.status !== "approved" || !approval.action) {
    return null;
  }

  const checkpoint = getLatestCheckpoint(approval.task_id) as {
    task_id: string;
    step_id: number;
    step_index: number;
    state: string;
    correlation_id: string | null;
  } | undefined;

  if (!checkpoint) {
    return null;
  }

  return {
    taskId: checkpoint.task_id,
    stepId: checkpoint.step_id,
    stepIndex: checkpoint.step_index,
    state: JSON.parse(checkpoint.state),
    correlationId: checkpoint.correlation_id ?? undefined,
    action: approval.action
  };
}


