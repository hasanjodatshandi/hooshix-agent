import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";

describe("agent execution engine via closed-agent-loop", () => {
  it("executes plan steps and completes task", async () => {
    const plan = createTaskPlan("test task");
    const executed: string[] = [];

    const result = await runClosedAgentLoop(plan, async (_tool, step) => {
      executed.push(step.action);
    }, 0);

    expect(executed.length).toBe(3);
    expect(result.status).toBe("completed");
  });

  it("stops when a step fails", async () => {
    const plan = createTaskPlan("test task");

    const result = await runClosedAgentLoop(plan, async () => {
      throw new Error("failed");
    }, 0);

    expect(result.status).toBe("failed");
  });
});
