import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { analyzeFailure, applyRecovery } from "../../src/core/recovery/recovery-engine.js";

describe("recovery engine", () => {
  it("creates recovery step for verification failures", () => {
    const action = analyzeFailure(new Error("test failed"));

    expect(action.type).toBe("create_step");
    expect(action.step).toBeDefined();
  });

  it("updates plan with recovery step", () => {
    const plan = createTaskPlan("build app");
    const action = analyzeFailure(new Error("build failed"));

    applyRecovery(plan, action);

    expect(plan.steps.length).toBe(4);
  });

  it("stops unknown failures", () => {
    expect(analyzeFailure(new Error("permission denied")).type)
      .toBe("stop");
  });
});
