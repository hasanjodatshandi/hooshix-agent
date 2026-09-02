import { describe, expect, it } from "vitest";
import { restorePlanPosition } from "../../src/core/loop/plan-resume.js";

describe("plan resume", () => {
  it("restores execution position from checkpoint", () => {
    const plan = restorePlanPosition({
      id: "resume-plan",
      task: "test",
      steps: [
        { id: 1, action: "one", status: "pending" },
        { id: 2, action: "two", status: "pending" },
        { id: 3, action: "three", status: "pending" }
      ]
    }, {
      taskId: "resume-plan",
      stepId: 2,
      stepIndex: 1,
      state: { status: "pending_approval" },
      action: "two"
    });

    expect(plan.steps[0].status).toBe("completed");
    expect(plan.steps[1].status).toBe("pending");
  });
});
