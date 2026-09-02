import { describe, expect, it } from "vitest";
import { recoverAndContinue } from "../../src/core/recovery/self-healing-recovery.js";

describe("self healing recovery integration", () => {
  it("continues after safe recovery action", () => {
    const plan:any = { steps: [] };
    const result = recoverAndContinue(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 10, action: "repair", status: "pending" }
    });
    expect(result).toBe(true);
    expect(plan.steps.length).toBe(1);
  });
});
