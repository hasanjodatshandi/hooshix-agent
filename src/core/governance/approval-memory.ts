import type { ExecutionContext } from "../runtime/execution-context.js";
import { withAgentDatabase } from "../memory/database.js";

export interface ApprovalRequest {
  id: number;
  task_id: string;
  step_id: number;
  action: string | null;
  risk: string;
  reason: string;
  status: "pending" | "approved" | "consumed";
  correlation_id: string | null;
  created_at: string;
  approved_at: string | null;
  consumed_at: string | null;
}

export function createApprovalRequest(input: {
  taskId: string;
  stepId: number;
  action?: string;
  risk: string;
  reason: string;
  context?: ExecutionContext;
  correlationId?: string;
}): number {
  return withAgentDatabase((db) => {
    const result = db.prepare(`
      INSERT INTO approval_requests
      (task_id, step_id, action, risk, reason, status, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.taskId,
      input.stepId,
      input.action ?? null,
      input.risk,
      input.reason,
      input.context?.correlationId ?? input.correlationId ?? null,
      new Date().toISOString()
    );
    return Number(result.lastInsertRowid);
  });
}

export function approveRequest(id: number): boolean {
  return withAgentDatabase((db) => db.prepare(`
    UPDATE approval_requests
    SET status = 'approved', approved_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(new Date().toISOString(), id).changes === 1);
}

export function consumeApprovedRequest(input: {
  id: number;
  taskId: string;
  stepId: number;
  action: string;
}): boolean {
  return withAgentDatabase((db) => db.prepare(`
    UPDATE approval_requests
    SET status = 'consumed', consumed_at = ?
    WHERE id = ? AND status = 'approved' AND task_id = ? AND step_id = ? AND action = ?
  `).run(new Date().toISOString(), input.id, input.taskId, input.stepId, input.action).changes === 1);
}

export function getApprovalRequest(id: number): ApprovalRequest | undefined {
  return withAgentDatabase((db) => db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as ApprovalRequest | undefined);
}
