import { describe, expect, it } from "vitest";
import { UnifiedRecoveryService } from "../../src/core/trace/unified-recovery-service.js";

describe("self healing recovery integration", () => {
  it("continues after safe recovery action", () => {
    const plan: any = { steps: [] };
    const service = new UnifiedRecoveryService({ getTrace: () => [] });
    const result = service.executeRecovery(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 10, action: "repair", status: "pending" }
    }, { correlationId: "test-corr" });
    expect(result).toBe(true);
    expect(plan.steps.length).toBe(1);
  });
});
