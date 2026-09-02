import { describe, expect, it } from "vitest";
import { MemoryRecoveryObservability } from "../../src/core/trace/recovery-observability.js";

describe("recovery observability", () => {
  it("stores recovery lifecycle events", () => {
    const sink = new MemoryRecoveryObservability();
    sink.record({
      recoveryId: "rec-1",
      correlationId: "corr-1",
      action: "create_step",
      reason: "failed verification",
      retryCount: 1,
      startedAt: new Date().toISOString(),
      status: "started"
    });

    expect(sink.getEvents("corr-1")).toHaveLength(1);
    expect(sink.getEvents("corr-1")[0].recoveryId).toBe("rec-1");
  });
});
