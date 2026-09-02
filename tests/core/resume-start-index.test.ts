import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";

describe("closed loop resume start index", () => {
  it("skips completed steps and continues from checkpoint index", async () => {
    const executed: number[] = [];

    const result = await runClosedAgentLoop({
      id: "resume-start-test",
      task: "resume",
      steps: [
        { id: 1, action: "normal step one", status: "completed" },
        { id: 2, action: "normal step two", status: "pending" }
      ]
    } as any, async (_tool, step) => {
      executed.push(step.id);
      return { ok: true };
    }, 1, 1);

    expect(executed).toEqual([2]);
    expect(result.status).toBe("completed");
  });
});
