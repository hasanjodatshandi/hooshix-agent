import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { recordStepExecution, reflectOnStep, analyzeTaskHistory } from "../../src/core/reflection/reflection-engine.js";
import { saveExecutionMemory } from "../../src/core/memory/sqlite-memory.js";

describe("reflection engine", () => {
  it("records execution result in memory", async () => {
    await recordStepExecution(
      { id: 1, action: "inspect", status: "completed" },
      { ok: true }
    );

    const memory = JSON.parse(await fs.readFile(process.env.HOOSHIX_MEMORY_FILE!, "utf8"));

    expect(memory.executions.length).toBeGreaterThan(0);
  });

  it("returns recovery decision on failure", () => {
    expect(reflectOnStep(false)).toBe("recover");
    expect(reflectOnStep(true)).toBe("continue");
  });

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
    expect(report.solution).toBe("No verified solution yet");
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
});
