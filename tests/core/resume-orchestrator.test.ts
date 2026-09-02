import { describe, expect, it } from "vitest";
import { resumeApprovedTask } from "../../src/core/loop/resume-orchestrator.js";
import { createApprovalRequest, approveRequest } from "../../src/core/governance/approval-memory.js";
import { saveCheckpoint } from "../../src/core/memory/checkpoint-memory.js";

describe("resume orchestrator", () => {
  it("resumes approved task from checkpoint", async () => {
    const taskId = "resume-orchestrator-" + Date.now();

    saveCheckpoint({
      taskId,
      stepId: 2,
      stepIndex: 1,
      state: { status: "pending_approval" },
      correlationId: "resume-orch-corr"
    });

    const approvalId = createApprovalRequest({
      taskId,
      stepId: 2,
      action: "delete file",
      risk: "high",
      reason: "delete",
      correlationId: "resume-orch-corr"
    });

    approveRequest(approvalId);

    const result = await resumeApprovedTask(
      approvalId,
      {
        id: taskId,
        task: "resume",
        steps: [
          { id: 1, action: "normal first", status: "completed" },
          { id: 2, action: "delete file", status: "pending" }
        ]
      },
      async () => ({ ok: true })
    );

    expect(result?.status).toBe("completed");
  });
});
