import { describe, expect, it } from "vitest";
import { analyzeTaskHistory } from "../../src/core/reflection/reflection-engine.js";
import { saveExecutionMemory } from "../../src/core/memory/sqlite-memory.js";

describe("reflection engine", () => {
  it("reports no failure when task has no executions", () => {
    const report = analyzeTaskHistory("nonexistent-task-id");
    expect(report.problem).toBe("No execution failure recorded");
    expect(report.cause).toBe("No failure detected");
    expect(report.confidence).toBe(0);
  });

  it("detects failure pattern and reports low confidence when not recovered", () => {
    const taskId = "reflect-fail-" + Date.now();
    saveExecutionMemory({ taskId, stepId: 1, action: "build project", result: { error: "compile error" }, status: "failed" });
    saveExecutionMemory({ taskId, stepId: 2, action: "run tests", result: { error: "test failed" }, status: "failed" });

    const report = analyzeTaskHistory(taskId);
    expect(report.problem).toBe("run tests");
    expect(report.cause).toBe("test failed");
    expect(report.solution).toBe("No verified solution yet — ask ChatGPT for a corrective plan");
    expect(report.confidence).toBe(0.4);
    expect(report.futureRecommendation).toContain("corrective plan");
  });

  it("detects recovery pattern and reports high confidence", () => {
    const taskId = "reflect-recover-" + Date.now();
    saveExecutionMemory({ taskId, stepId: 1, action: "build app", result: { error: "build failed" }, status: "failed" });
    saveExecutionMemory({ taskId, stepId: 2, action: "fix config", result: { ok: true }, status: "completed" });

    const report = analyzeTaskHistory(taskId);
    expect(report.problem).toBe("build app");
    expect(report.cause).toBe("build failed");
    expect(report.solution).toBe("fix config");
    expect(report.confidence).toBe(0.8);
    expect(report.futureRecommendation).toContain("successful follow-up");
  });

  it("reports full confidence when all steps succeed", () => {
    const taskId = "reflect-success-" + Date.now();
    saveExecutionMemory({ taskId, stepId: 1, action: "read file", result: { ok: true }, status: "completed" });
    saveExecutionMemory({ taskId, stepId: 2, action: "write file", result: { ok: true }, status: "completed" });

    const report = analyzeTaskHistory(taskId);
    expect(report.problem).toBe("No execution failure recorded");
    expect(report.confidence).toBe(1);
    expect(report.futureRecommendation).toContain("Reuse");
  });

  it("does not claim success when a crashed task has outcome_unknown without an execution row", async () => {
    const { createTaskPlan } = await import("../../src/core/planner/task-planner.js");
    const { saveTaskPlan } = await import("../../src/core/memory/task-repository.js");
    const plan = createTaskPlan("crash-reflection-regression", [
      { action: "write marker and wait", tool: "execute_command", arguments: { command: "node", args: ["-e", "setTimeout(()=>{},90000)"] }, status: "outcome_unknown" },
    ]);
    plan.state = "failed";
    plan.steps[0].status = "outcome_unknown";
    saveTaskPlan(plan, "failed", plan.correlationId);

    const report = analyzeTaskHistory(plan.id);
    expect(report.problem).toContain("Outcome unknown");
    expect(report.solution).toContain("do not automatically replay");
    expect(report.confidence).toBe(0);
    expect(report.solution).not.toContain("Existing execution path succeeded");
    expect(report.futureRecommendation).toContain("reconciliation");
  });
});
