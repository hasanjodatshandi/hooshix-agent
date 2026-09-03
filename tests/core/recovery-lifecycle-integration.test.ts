import { describe, expect, it } from "vitest";
import { UnifiedRecoveryService } from "../../src/core/trace/unified-recovery-service.js";
import { MemoryRecoveryObservability } from "../../src/core/trace/recovery-observability.js";

describe("self healing recovery lifecycle integration", () => {
  it("records started and completed lifecycle", () => {
    const plan: any = { id: "task-1", steps: [] };
    const sink = new MemoryRecoveryObservability();
    const service = new UnifiedRecoveryService({ getTrace: () => [] }, sink);
    const result = service.executeRecovery(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 10, action: "repair", status: "pending" }
    }, { correlationId: "corr-1", sink });

    expect(result).toBe(true);
    expect(sink.getEvents("corr-1")).toHaveLength(2);
    expect(sink.getEvents("corr-1")[1].status).toBe("completed");
  });
});
