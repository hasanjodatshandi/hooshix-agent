import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { runAgentLoop } from "../../src/core/loop/agent-loop.js";

describe("agent loop", () => {
  it("runs all plan steps", async () => {
    const plan = createTaskPlan("build project");
    const tools: string[] = [];

    const result = await runAgentLoop(plan, async (tool) => {
      tools.push(tool);
    });

    expect(result.status).toBe("completed");
    expect(result.completedSteps.length).toBe(3);
    expect(tools.length).toBe(3);
  });

  it("stops on failed tool execution", async () => {
    const plan = createTaskPlan("build project");

    const result = await runAgentLoop(plan, async () => {
      throw new Error("tool failed");
    });

    expect(result.status).toBe("failed");
    expect(result.failedStep).toBeDefined();
  });
});
