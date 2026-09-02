import { describe, expect, it } from "vitest";
import { createTaskPlan, validateTaskPlan } from "../../src/core/planner/task-planner.js";
import { getTaskPlan, saveTaskPlan } from "../../src/core/memory/task-repository.js";

describe("typed task plan persistence", () => {
  it("round-trips tools, arguments, dependencies, outputs, and errors", () => {
    const plan = createTaskPlan("persist plan", [
      { id: 10, action: "inspect", tool: "read_file", arguments: { path: "README.md" } },
      { id: 20, action: "verify", tool: "execute_command", arguments: { command: "node", args: ["--version"] }, dependsOn: [10] }
    ], "durable plan");
    plan.correlationId = "task-persistence";
    plan.steps[0].status = "completed";
    plan.steps[0].output = { ok: true };
    plan.steps[1].status = "failed";
    plan.steps[1].error = "expected failure";

    saveTaskPlan(plan, "failed");
    expect(getTaskPlan(plan.id)).toEqual(plan);
  });

  it("rejects duplicate ids and forward dependencies", () => {
    expect(() => validateTaskPlan({ id: "x", task: "x", steps: [
      { id: 1, action: "one", status: "pending" },
      { id: 1, action: "two", status: "pending" }
    ] })).toThrow("Duplicate step id");
    expect(() => validateTaskPlan({ id: "x", task: "x", steps: [
      { id: 1, action: "one", status: "pending", dependsOn: [2] },
      { id: 2, action: "two", status: "pending" }
    ] })).toThrow("missing or later");
  });
});
