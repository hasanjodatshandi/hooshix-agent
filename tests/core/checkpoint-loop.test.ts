import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { getLatestCheckpoint } from "../../src/core/memory/checkpoint-memory.js";

describe("closed loop checkpoint persistence", () => {
  it("stores pending approval checkpoint", async () => {
    const result = await runClosedAgentLoop({
      id: "checkpoint-loop-test",
      task: "delete file",
      steps: [
        { id: 10, action: "delete file", status: "pending" }
      ]
    } as any, async () => ({ ok: true }));

    const checkpoint = getLatestCheckpoint("checkpoint-loop-test") as any;

    expect(result.status).toBe("pending_approval");
    expect(checkpoint.state).toContain("pending_approval");
  });
});
