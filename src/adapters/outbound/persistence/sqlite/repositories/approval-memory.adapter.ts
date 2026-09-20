import type { ExecutionContext } from "../../../../../core/runtime/execution-context.js";
import { withAgentDatabase } from "../../../../../core/memory/database.js";

export interface ApprovalRequest {
  id: number;
  task_id: string;
  step_id: number;
  action: string | null;
  risk: string;
  reason: string;
  status: "pending" | "approved" | "consumed" | "revoked";
  correlation_id: string | null;
  created_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  tool_id: string | null;
  request_fingerprint: string | null;
  principal_id: string | null;
  session_id: string | null;
  expires_at: string | null;
  dispatched_at: string | null;
}

export function createApprovalRequest(input: {
  taskId: string;
  stepId: number;
  action?: string;
  risk: string;
  reason: string;
  context?: ExecutionContext;
  correlationId?: string;
  toolId?: string;
  requestFingerprint?: string;
  principalId?: string;
  sessionId?: string;
  expiresAt?: string;
}): number {
  return withAgentDatabase(db => {
    const result=db.prepare(`
      INSERT INTO approval_requests
      (task_id,step_id,action,risk,reason,status,correlation_id,created_at,
       tool_id,request_fingerprint,principal_id,session_id,expires_at)
      VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)
    `).run(input.taskId,input.stepId,input.action??null,input.risk,input.reason,
      input.context?.correlationId??input.correlationId??null,new Date().toISOString(),
      input.toolId??null,input.requestFingerprint??null,
      input.principalId??null,input.sessionId??null,input.expiresAt??null);
    return Number(result.lastInsertRowid);
  });
}
export function approveRequest(id:number):boolean {
  const now=new Date().toISOString();
  return withAgentDatabase(db=>db.prepare(`
    UPDATE approval_requests SET status='approved', approved_at=?
    WHERE id=? AND status='pending' AND (expires_at IS NULL OR expires_at>?)
  `).run(now,id,now).changes===1);
}
export function isApprovalTerminal(id:number):boolean {
  const record=getApprovalRequest(id);
  return !!record&&(record.status==="consumed"||record.status==="revoked");
}
export function consumeApprovedRequest(input:{
  id:number;taskId:string;stepId:number;action:string;requestFingerprint?:string;
}):boolean {
  const now=new Date().toISOString();
  return withAgentDatabase(db=>db.prepare(`
    UPDATE approval_requests SET status='consumed',consumed_at=?
    WHERE id=? AND status='approved' AND task_id=? AND step_id=? AND action=?
      AND (? IS NULL OR request_fingerprint=?)
      AND (expires_at IS NULL OR expires_at>?)
  `).run(now,input.id,input.taskId,input.stepId,input.action,
    input.requestFingerprint??null,input.requestFingerprint??null,now).changes===1);
}
/** Atomic, single-use claim before the external effect. Crash after claim cannot replay blindly. */
export function claimApprovedTaskEffect(input:{
  readonly approvalId:number;readonly taskId:string;readonly stepId:number;
  readonly toolId:string;readonly requestFingerprint:string;
  readonly principalId:string;readonly sessionId:string;
}):boolean {
  const now=new Date().toISOString();
  return withAgentDatabase(db=>db.prepare(`
    UPDATE approval_requests SET dispatched_at=?
    WHERE id=? AND status='consumed' AND dispatched_at IS NULL
      AND task_id=? AND step_id=? AND tool_id=? AND request_fingerprint=?
      AND principal_id=? AND session_id=?
      AND expires_at IS NOT NULL AND expires_at>?
  `).run(now,input.approvalId,input.taskId,input.stepId,input.toolId,
    input.requestFingerprint,input.principalId,input.sessionId,now).changes===1);
}
export function getApprovalRequest(id:number):ApprovalRequest|undefined {
  return withAgentDatabase(db=>db.prepare("SELECT * FROM approval_requests WHERE id=?").get(id) as ApprovalRequest|undefined);
}
export function revokeTaskApprovals(taskId:string):number {
  return withAgentDatabase(db=>db.prepare(`
    UPDATE approval_requests SET status='revoked'
    WHERE task_id=? AND status IN ('pending','approved')
  `).run(taskId).changes);
}
export function revokeApproval(id:number):boolean {
  return withAgentDatabase(db=>db.prepare(`
    UPDATE approval_requests SET status='revoked'
    WHERE id=? AND status IN ('pending','approved')
  `).run(id).changes===1);
}
