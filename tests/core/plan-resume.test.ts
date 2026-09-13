import { describe, expect, it } from "vitest";
import { restorePlanPosition } from "../../src/core/loop/plan-resume.js";

describe("plan resume", () => {
  it("resets only the approved step to pending and preserves prior statuses", () => {
    const plan = restorePlanPosition({
      id: "resume-plan",
      task: "test",
      steps: [
        { id: 1, action: "one", status: "completed" },
        { id: 2, action: "two", status: "failed" },
        { id: 3, action: "three", status: "pending" }
      ]
    }, {
      taskId: "resume-plan",
      stepId: 2,
      stepIndex: 1,
      state: { status: "pending_approval" },
      action: "two"
    });

    // Completed stays completed, failed stays failed (no history falsification),
    // and the approved step is reset to pending for re-execution.
    expect(plan.steps[0].status).toBe("completed");
    expect(plan.steps[1].status).toBe("pending");
    expect(plan.steps[2].status).toBe("pending");
  });
});
