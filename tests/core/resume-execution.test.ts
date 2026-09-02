import { describe, expect, it } from "vitest";
import { getPendingResumeSteps, markResumeCompleted } from "../../src/core/loop/resume-execution.js";

describe("resume execution", () => {
  it("continues only unfinished steps", () => {
    const plan = {
      id: "resume-execution-test",
      task: "test",
      steps: [
        { id: 1, action: "one", status: "completed" },
        { id: 2, action: "two", status: "pending" }
      ]
    } as any;

    expect(getPendingResumeSteps(plan).length).toBe(1);
    markResumeCompleted(plan, 1);
    expect(getPendingResumeSteps(plan).length).toBe(0);
  });
});
