import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { executePlan } from "../../src/core/executor/execution-engine.js";

describe("agent execution engine", () => {
  it("executes plan steps and completes task", async () => {
    const plan = createTaskPlan("test task");
    const executed: string[] = [];

    const result = await executePlan(plan, "created", async (step) => {
      executed.push(step.action);
    });

    expect(executed.length).toBe(3);
    expect(result[0].state).toBe("completed");
  });

  it("stops when a step fails", async () => {
    const plan = createTaskPlan("test task");

    await expect(
      executePlan(plan, "created", async () => {
        throw new Error("failed");
      })
    ).rejects.toThrow();
  });
});
