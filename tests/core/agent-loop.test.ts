import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";

describe("agent loop via closed-agent-loop", () => {
  it("runs all plan steps", async () => {
    const plan = createTaskPlan("build project");
    const tools: string[] = [];

    const result = await runClosedAgentLoop(plan, async (tool) => {
      tools.push(tool);
    }, 0);

    expect(result.status).toBe("completed");
    expect(result.completedSteps.length).toBe(3);
    expect(tools.length).toBe(3);
  });

  it("stops on failed tool execution", async () => {
    const plan = createTaskPlan("build project");

    const result = await runClosedAgentLoop(plan, async () => {
      throw new Error("tool failed");
    }, 0);

    expect(result.status).toBe("failed");
    expect(plan.steps.some((step) => step.status === "failed")).toBe(true);
  });
});
