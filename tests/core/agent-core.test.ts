import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { transitionTask } from "../../src/core/state/task-state-machine.js";
import { saveMemory, loadMemory } from "../../src/core/memory/agent-memory.js";

describe("agent core", () => {
  it("creates task plans", () => {
    const plan = createTaskPlan("build app");
    expect(plan.steps.length).toBe(3);
  });

  it("allows valid state transitions", () => {
    expect(transitionTask("created", "planning")).toBe("planning");
  });

  it("persists memory", async () => {
    await saveMemory({ task: "test" });
    expect(await loadMemory()).toEqual({ task: "test" });
  });
});
