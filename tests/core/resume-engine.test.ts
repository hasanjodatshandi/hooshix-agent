import { describe, expect, it } from "vitest";
import { createApprovalRequest, approveRequest } from "../../src/core/governance/approval-memory.js";
import { saveCheckpoint } from "../../src/core/memory/checkpoint-memory.js";
import { canResumeApprovedTask } from "../../src/core/loop/resume-engine.js";

describe("resume engine", () => {
  it("loads checkpoint after approval", () => {
    const taskId = "resume-engine-test-" + Date.now();

    saveCheckpoint({
      taskId,
      stepId: 2,
      stepIndex: 1,
      state: { status: "pending_approval" },
      correlationId: "resume-engine-corr"
    });

    const approvalId = createApprovalRequest({
      taskId,
      stepId: 2,
      action: "delete file",
      risk: "high",
      reason: "delete",
      correlationId: "resume-engine-corr"
    });

    approveRequest(approvalId);

    const checkpoint = canResumeApprovedTask(approvalId) as any;

    expect(checkpoint.stepId).toBe(2);
  });
});
