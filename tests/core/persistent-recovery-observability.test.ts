import { describe, expect, it } from "vitest";
import { PersistentRecoveryObservability } from "../../src/core/trace/persistent-recovery-observability.js";
import { PersistentRecoveryRepository } from "../../src/core/trace/recovery-repository.js";

describe("persistent recovery observability", () => {
  it("persists lifecycle events", () => {
    const repo = new PersistentRecoveryRepository();
    const sink = new PersistentRecoveryObservability(repo);
    const recoveryId = "persist-rec-" + Date.now();
    const correlationId = "persist-corr-" + Date.now();

    sink.record({
      recoveryId,
      correlationId,
      action: "retry",
      reason: "timeout",
      retryCount: 1,
      startedAt: new Date().toISOString(),
      status: "started"
    });

    const events = repo.findByCorrelationId(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0].recoveryId).toBe(recoveryId);
  });
});
