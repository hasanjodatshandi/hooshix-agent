import { describe, expect, it } from "vitest";
import { MemoryRecoveryObservability } from "../../src/core/trace/recovery-observability.js";
import { RecoveryLifecycleTracker } from "../../src/core/trace/recovery-lifecycle.js";

describe("recovery lifecycle", () => {
  it("records started and completed events", () => {
    const sink = new MemoryRecoveryObservability();
    const tracker = new RecoveryLifecycleTracker(sink);
    tracker.start({ recoveryId: "r1", correlationId: "c1", action: "retry", reason: "timeout", retryCount: 1, startedAt: new Date().toISOString() });
    tracker.complete({ recoveryId: "r1", correlationId: "c1", action: "retry", reason: "timeout", retryCount: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    expect(sink.getEvents("c1")).toHaveLength(2);
  });
});
