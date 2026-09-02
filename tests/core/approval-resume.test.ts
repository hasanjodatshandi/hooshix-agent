import { describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "../../src/core/governance/approval-memory.js";
import { canResumeAfterApproval } from "../../src/core/governance/approval-resume.js";

describe("approval resume", () => {
  it("allows resume only after approval", () => {
    createApprovalRequest({ taskId: "resume-test", stepId: 1, risk: "high", reason: "delete", correlationId: "resume-corr" });
    approveRequest(1);
    expect(canResumeAfterApproval(1)).toBe(true);
  });
});
