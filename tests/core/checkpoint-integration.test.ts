import { describe, expect, it } from "vitest";
import { checkpointStep } from "../../src/core/loop/checkpoint-integration.js";
import { getLatestCheckpoint } from "../../src/core/memory/checkpoint-memory.js";

describe("checkpoint integration", () => {
  it("creates execution checkpoint", () => {
    checkpointStep({
      taskId: "loop-checkpoint-test",
      stepId: 3,
      stepIndex: 2,
      status: "running",
      correlationId: "loop-corr-1"
    });

    const checkpoint = getLatestCheckpoint("loop-checkpoint-test") as any;

    expect(checkpoint.step_id).toBe(3);
    expect(checkpoint.correlation_id).toBe("loop-corr-1");
  });
});
