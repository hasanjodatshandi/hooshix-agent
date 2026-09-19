import { describe, expect, it } from "vitest";
import * as legacy from "../../src/core/runtime/template-resolver.js";
import * as application from "../../src/application/services/template-resolver.js";
import type { TaskStep } from "../../src/core/planner/task-planner.js";

describe("R1 Template Resolver compatibility facade", () => {
  it("exports the same production implementations rather than duplicating resolution logic", () => {
    for (const name of ["buildStepContext", "resolveTemplates", "hasTemplates", "validateTemplates", "MissingVariableError"] as const) {
      expect(legacy[name]).toBe(application[name]);
    }
  });
  it("preserves legacy TaskStep structural input and typed nested resolution", () => {
    const legacySteps: TaskStep[] = [{ id: 1, action: "read fixture", status: "completed", output: { path: "safe.txt" } }];
    const context = application.buildStepContext(legacySteps);
    expect(legacy.resolveTemplates({ path: "{{step1.output.path}}" }, context)).toEqual({ path: "safe.txt" });
  });
});
