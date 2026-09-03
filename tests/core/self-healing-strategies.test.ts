import { describe, expect, it } from "vitest";
import { analyzeTraceFailure } from "../../src/core/trace/failure-analyzer.js";
import { createRecoveryDecision } from "../../src/core/trace/recovery-decision.js";
import { applySelfHealing, canAutoRecover, shouldContinueAfterRecovery } from "../../src/core/trace/self-healing-controller.js";
import type { ExecutionTraceEvent } from "../../src/core/memory/execution-trace.js";
import type { TaskPlan } from "../../src/core/planner/task-planner.js";

function makeTraceError(error: string, stepId?: number): ExecutionTraceEvent[] {
  return [{
    id: "exec:1",
    correlationId: "test",
    source: "runtime",
    type: "execution",
    timestamp: new Date().toISOString(),
    payload: { step_id: stepId, result: { error }, status: "failed" }
  }];
}

function makePlan(steps: Array<{ id: number; action: string }>): TaskPlan {
  return { id: "test-plan", task: "test", steps: steps.map((s) => ({ ...s, status: "pending" as const })) };
}

describe("self-healing strategies", () => {
  it("retry: transient timeout triggers retry", () => {
    const finding = analyzeTraceFailure(makeTraceError("command timeout"));
    expect(finding.reason).toContain("timeout");

    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("retry");
    expect(action.reason).toContain("transient");
  });

  it("retry: network error triggers retry", () => {
    const finding = analyzeTraceFailure(makeTraceError("network connection refused"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("retry");
  });

  it("ask_approval: permission error triggers approval request", () => {
    const finding = analyzeTraceFailure(makeTraceError("permission denied for admin operation"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("ask_approval");
    expect(action.reason).toContain("approval");
  });

  it("change_tool: unknown tool triggers tool change", () => {
    const finding = analyzeTraceFailure(makeTraceError("unknown tool: nonexistent_tool"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("change_tool");
  });

  it("modify_input: invalid argument triggers input correction", () => {
    const finding = analyzeTraceFailure(makeTraceError("invalid schema: missing required field"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("modify_input");
  });

  it("rollback: rollback error triggers rollback", () => {
    const finding = analyzeTraceFailure(makeTraceError("rollback required after failed mutation"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("rollback");
  });

  it("replan: build/test failure triggers replan", () => {
    const finding = analyzeTraceFailure(makeTraceError("build failed with 3 errors"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("replan");
  });

  it("replan: test failure triggers replan", () => {
    const finding = analyzeTraceFailure(makeTraceError("test suite failed: 2 tests failed"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("replan");
  });

  it("stop: unrecognized failure stops execution", () => {
    const finding = analyzeTraceFailure(makeTraceError("unexpected crash in module X"));
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("stop");
  });

  it("no failure: stop when trace has no failure", () => {
    const finding = analyzeTraceFailure([]);
    expect(finding.reason).toContain("No failure");
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("stop");
  });

  it("canAutoRecover allows retry and create_step only", () => {
    expect(canAutoRecover({ type: "retry", reason: "x" })).toBe(true);
    expect(canAutoRecover({ type: "create_step", reason: "x" })).toBe(true);
    expect(canAutoRecover({ type: "replan", reason: "x" })).toBe(false);
    expect(canAutoRecover({ type: "rollback", reason: "x" })).toBe(false);
    expect(canAutoRecover({ type: "ask_approval", reason: "x" })).toBe(false);
    expect(canAutoRecover({ type: "stop", reason: "x" })).toBe(false);
    expect(canAutoRecover({ type: "change_tool", reason: "x" })).toBe(false);
    expect(canAutoRecover({ type: "modify_input", reason: "x" })).toBe(false);
  });

  it("shouldContinueAfterRecovery matches canAutoRecover", () => {
    expect(shouldContinueAfterRecovery({ type: "retry", reason: "x" })).toBe(true);
    expect(shouldContinueAfterRecovery({ type: "create_step", reason: "x" })).toBe(true);
    expect(shouldContinueAfterRecovery({ type: "stop", reason: "x" })).toBe(false);
  });

  it("applySelfHealing inserts corrective step at specified index", () => {
    const plan = makePlan([{ id: 1, action: "original" }]);
    applySelfHealing(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 2, action: "corrective", status: "pending" }
    }, 0);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].action).toBe("corrective");
    expect(plan.steps[1].action).toBe("original");
  });

  it("applySelfHealing deduplicates step ids", () => {
    const plan = makePlan([{ id: 1, action: "original" }]);
    applySelfHealing(plan, {
      type: "create_step",
      reason: "fix",
      step: { id: 1, action: "corrective", status: "pending" }
    });
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[1].id).not.toBe(1);
  });

  it("full flow: analyze → decide → apply for retry strategy", () => {
    const events = makeTraceError("network timeout");
    const finding = analyzeTraceFailure(events);
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("retry");
    // retry doesn't modify the plan
    const plan = makePlan([{ id: 1, action: "fetch" }]);
    applySelfHealing(plan, action);
    expect(plan.steps.length).toBe(1);
  });

  it("full flow: analyze → decide → apply for replan strategy", () => {
    const events = makeTraceError("build failed", 1);
    const finding = analyzeTraceFailure(events);
    expect(finding.failedStep).toBe(1);
    const action = createRecoveryDecision(finding);
    expect(action.type).toBe("replan");
    // replan needs external input, canAutoRecover is false
    expect(canAutoRecover(action)).toBe(false);
  });
});
