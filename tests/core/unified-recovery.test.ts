import { describe, expect, it } from "vitest";
import { UnifiedRecoveryService } from "../../src/core/trace/unified-recovery-service.js";

describe("unified recovery pipeline", () => {
  it("creates recovery from trace analysis", () => {
    const service = new UnifiedRecoveryService({
      getTrace: () => [{ type: "execution", timestamp: "now", data: { step_id: 1, result: { error: "build failed" } } }]
    } as any);

    expect(service.decide("corr").type).toBe("replan");
  });
});
