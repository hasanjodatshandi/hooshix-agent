import { describe, expect, it } from "vitest";
import { applySelfHealing, canAutoRecover } from "../../src/core/trace/self-healing-controller.js";

describe("self healing controller", () => {
  it("adds recovery step for safe recovery", () => {
    const plan:any = { steps: [] };

    const result = applySelfHealing(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 2, action: "repair", status: "pending" }
    });

    expect(canAutoRecover({ type: "create_step", reason: "fix" })).toBe(true);
    expect(result.steps.length).toBe(1);
  });
});
