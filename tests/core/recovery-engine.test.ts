import { describe, expect, it } from "vitest";
import { UnifiedRecoveryService } from "../../src/core/trace/unified-recovery-service.js";
import { applySelfHealing } from "../../src/core/trace/self-healing-controller.js";
import type { TaskPlan } from "../../src/core/planner/task-planner.js";

describe("recovery engine", () => {
  it("creates recovery step for verification failures via UnifiedRecoveryService", () => {
    const service = new UnifiedRecoveryService({
      getTrace: () => [{ type: "execution", timestamp: "now", data: { result: { error: "build failed" } } }]
    } as any);
    const finding = service.analyzeFailure("corr");
    const action = service.decideRecovery(finding);

    expect(action.type).toBe("replan");
  });

  it("applies self-healing to insert recovery step into plan", () => {
    const plan: TaskPlan = { id: "test", task: "build app", steps: [{ id: 1, action: "build", status: "completed" }] };
    applySelfHealing(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 2, action: "repair", status: "pending" }
    });

    expect(plan.steps.length).toBe(2);
  });

  it("stops when no failure event found in trace", () => {
    const service = new UnifiedRecoveryService({ getTrace: () => [] } as any);
    const finding = service.analyzeFailure("empty-corr");
    const action = service.decideRecovery(finding);

    expect(action.type).toBe("stop");
  });
});
