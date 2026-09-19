import { describe, expect, it } from "vitest";
import * as legacy from "../../src/core/planner/task-planner.js";
import * as validator from "../../src/application/services/legacy-task-plan-validator.js";
import { createTaskPlan as infrastructureCreateTaskPlan } from "../../src/infrastructure/composition/legacy-task-plan-factory.js";

describe("R1 legacy task-planner migration", () => {
  it("keeps legacy validation exports as exact aliases", () => {
    expect(legacy.validateTaskPlan).toBe(validator.validateTaskPlan);
    expect(legacy.validateTemplateReferences).toBe(validator.validateTemplateReferences);
    expect(legacy.createTaskPlan).toBe(infrastructureCreateTaskPlan);
  });

  it("preserves default plan construction and validates it through application policy", () => {
    const plan = legacy.createTaskPlan("demo");
    expect(plan.task).toBe("demo");
    expect(plan.state).toBe("created");
    expect(plan.steps.map((step) => step.id)).toEqual([1, 2, 3]);
    expect(() => validator.validateTaskPlan(plan)).not.toThrow();
  });

  it("keeps planner validation fail-closed for missing/future dependencies and templates", () => {
    expect(() => legacy.createTaskPlan("bad", [
      { id: 1, action: "a", tool: "read_file", arguments: { path: "x" }, dependsOn: [2] },
      { id: 2, action: "b", tool: "read_file", arguments: { path: "x" } },
    ])).toThrow(/missing or later step/);
    expect(() => legacy.createTaskPlan("bad-template", [
      { id: 1, action: "a", tool: "read_file", arguments: { path: "{{step2.output.path}}" } },
      { id: 2, action: "b", tool: "read_file", arguments: { path: "x" } },
    ])).toThrow(/future_step_reference/);
  });
});
