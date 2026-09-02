import { describe, expect, it } from "vitest";
import { PersistentRecoveryRepository } from "../../src/core/trace/recovery-repository.js";

describe("persistent recovery repository", () => {
  it("stores and restores recovery events", () => {
    const repo = new PersistentRecoveryRepository();
    repo.save({
      recoveryId: "rec-test",
      correlationId: "corr-test",
      action: "retry",
      reason: "timeout",
      retryCount: 1,
      startedAt: new Date().toISOString(),
      status: "started"
    });

    const events = repo.findByCorrelationId("corr-test");
    expect(events.some((event) => event.recoveryId === "rec-test")).toBe(true);
  });
});
