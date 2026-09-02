import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
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

    const db = new Database(process.env.HOOSHIX_DB_PATH!);
    const row = db.prepare("SELECT * FROM approval_requests WHERE task_id = ?").get("approval-test") as { status: string };
    db.close();

    expect(row.status).toBe("pending");
  });
});
