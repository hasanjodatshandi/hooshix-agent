import { describe, expect, it } from "vitest";
import { preparePlanForResume, getResumeStartIndex } from "../../src/core/loop/resume-controller.js";

describe("resume controller", () => {
  it("prepares plan continuation point", () => {
    const plan = preparePlanForResume({
      id: "resume-controller",
      task: "test",
      steps: [
        { id: 1, action: "one", status: "pending" },
        { id: 2, action: "two", status: "pending" }
      ]
    }, {
      taskId: "resume-controller",
      stepId: 2,
      stepIndex: 1,
      state: { status: "pending_approval" },
      action: "two"
    });

    expect(getResumeStartIndex({
      taskId: "resume-controller",
      stepId: 2,
      stepIndex: 1,
      state: {},
      action: "two"
    })).toBe(1);

    expect(plan.steps[0].status).toBe("completed");
  });
});
