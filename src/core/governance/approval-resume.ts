import { getApprovalRequest } from "./approval-memory.js";

export function canResumeAfterApproval(id: number) {
  const request = getApprovalRequest(id);
  return request?.status === "approved";
}
