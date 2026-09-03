import { describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { createApprovalRequest } from "../../src/core/governance/approval-memory.js";

describe("approval workflow memory", () => {
  it("stores pending approval request", () => {
    createApprovalRequest({
      taskId: "approval-test",
      stepId: 1,
      risk: "critical",
      reason: "admin command",
      correlationId: "corr-approval-1"
    });

    const row = withAgentDatabase((db) => db.prepare("SELECT * FROM approval_requests WHERE task_id = ?").get("approval-test")) as { status: string };
    expect(row.status).toBe("pending");
  });
});
