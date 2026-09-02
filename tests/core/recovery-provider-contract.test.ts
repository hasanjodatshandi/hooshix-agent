import { describe, expect, it } from "vitest";
import type { RecoveryDecisionProvider } from "../../src/core/trace/unified-recovery-service.js";

function validateProvider(provider: RecoveryDecisionProvider) {
  return provider.decide("contract-test");
}

describe("RecoveryDecisionProvider contract", () => {
  it("returns a valid recovery action", () => {
    const provider: RecoveryDecisionProvider = {
      decide: () => ({ type: "create_step", reason: "test recovery" }) as any
    };

    const result = validateProvider(provider);
    expect(result.type).toBe("create_step");
  });
});
