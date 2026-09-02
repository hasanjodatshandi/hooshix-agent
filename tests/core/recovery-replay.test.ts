import { describe, expect, it } from "vitest";
import { RecoveryReplayService } from "../../src/core/trace/recovery-replay-service.js";
import { PersistentRecoveryRepository } from "../../src/core/trace/recovery-repository.js";

describe("recovery replay", () => {
  it("reconstructs recovery history", () => {
    const repo = new PersistentRecoveryRepository();
    const correlationId = "replay-" + Date.now();
    const startedAt = new Date().toISOString();
    repo.save({
      recoveryId: "r-replay",
      correlationId,
      action: "retry",
      reason: "timeout",
      retryCount: 1,
      startedAt,
      status: "started"
    });
    repo.save({
      recoveryId: "r-replay",
      correlationId,
      action: "retry",
      reason: "timeout",
      retryCount: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "completed"
    });

    const report = new RecoveryReplayService(repo).replay(correlationId);
    expect(report.recoveryCount).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.events).toHaveLength(2);
  });
});
