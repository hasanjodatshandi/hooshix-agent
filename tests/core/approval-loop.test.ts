import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";

describe("agent approval pause", () => {
  it("pauses execution when approval is required", async () => {
    const result = await runClosedAgentLoop({
      id: "approval-loop-test",
      task: "delete project file",
      steps: [
        { id: 1, action: "delete project file", status: "pending" }
      ]
    } as any, async () => ({ ok: true }));

    expect(result.status).toBe("pending_approval");
  });
});
