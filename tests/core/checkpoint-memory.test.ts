import { describe, expect, it } from "vitest";
import { saveCheckpoint, getLatestCheckpoint } from "../../src/core/memory/checkpoint-memory.js";

describe("agent checkpoint memory", () => {
  it("stores and loads latest checkpoint", () => {
    saveCheckpoint({
      taskId: "checkpoint-test",
      stepId: 2,
      stepIndex: 1,
      state: { status: "pending_approval" },
      correlationId: "checkpoint-corr"
    });

    const checkpoint = getLatestCheckpoint("checkpoint-test") as any;

    expect(checkpoint.step_id).toBe(2);
    expect(checkpoint.correlation_id).toBe("checkpoint-corr");
  });
});
