import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";

describe("closed agent loop", () => {
  it("completes successful workflows", async () => {
    const result = await runClosedAgentLoop(
      createTaskPlan("build project"),
      async () => ({ ok: true })
    );

    expect(result.status).toBe("completed");
    expect(result.completedSteps.length).toBe(3);
  });

  it("stops after a deterministic failure instead of fabricating a repair step", async () => {
    const plan = createTaskPlan("build project");

    const result = await runClosedAgentLoop(
      plan,
      async (_tool, step) => {
        if (step.action.includes("verify")) {
          throw new Error("test failed");
        }
      }
    );

    expect(result.status).toBe("failed");
    expect(result.plan.steps.length).toBe(3);
  });

  it("bounds persisted outputs from long-running plans", async () => {
    const result = await runClosedAgentLoop(
      createTaskPlan("large output", [{ action: "read large output", tool: "read_file", arguments: { path: "large" } }]),
      async () => "x".repeat(200_000),
      0
    );
    expect(result.status).toBe("completed");
    expect(result.plan.steps[0].output).toMatchObject({ truncated: true });
    expect(JSON.stringify(result.plan.steps[0].output).length).toBeLessThan(40_000);
  });
});
