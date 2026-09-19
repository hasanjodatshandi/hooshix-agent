import { describe, expect, it } from "vitest";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";
import { saveExecutionMemory } from "../../src/core/memory/sqlite-memory.js";
import { getAgentMetrics } from "../../src/core/trace/metrics-service.js";
import { withAgentDatabase } from "../../src/core/memory/database.js";

describe("observability metrics", () => {
  it("reports zero metrics for empty database", () => {
    const metrics = getAgentMetrics();
    expect(metrics.recoverySuccessRate).toBeNull();
    expect(metrics.toolFailureRate).toBe(0);
    expect(metrics.averageRecoveryTimeMs).toBeNull();
    expect(metrics.failedActions).toBe(0);
    expect(metrics.mostFailedTools).toEqual([]);
    expect(metrics.recoveryAttempts).toBe(0);
    expect(metrics.workflowActionFailureRate).toBe(0);
  });

  it("tracks tool failure rate correctly", async () => {
    const corr = "metrics-tool-" + Date.now();
    await auditToolCall("read_file", corr, undefined, () => "ok");
    await auditToolCall("read_file", corr, undefined, () => { throw new Error("fail"); }).catch(() => {});
    await auditToolCall("write_file", corr, undefined, () => "ok");

    const metrics = getAgentMetrics();
    expect(metrics.toolFailureRate).toBeCloseTo(1 / 3, 2);
    expect(metrics.mostFailedTools.length).toBeGreaterThan(0);
  });

  it("reports recovery outcomes globally and per task from final step state", () => {
    const now = new Date().toISOString();
    const taskCompleted = `metrics-recovery-ok-${Date.now()}`;
    const taskFailed = `metrics-recovery-fail-${Date.now()}`;
    withAgentDatabase((db) => {
      const taskStmt = db.prepare("INSERT INTO tasks(id, description, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      taskStmt.run(taskCompleted, "ok", "ok", "completed", now, now);
      taskStmt.run(taskFailed, "fail", "fail", "failed", now, now);
      const stepStmt = db.prepare("INSERT INTO task_steps(task_id, step_id, step_order, action, input, dependencies, status, created_at, updated_at) VALUES (?, 1, 0, 'recover', '{}', '[]', ?, ?, ?)");
      stepStmt.run(taskCompleted, "completed", now, now);
      stepStmt.run(taskFailed, "failed", now, now);
    });
    saveExecutionMemory({ taskId: taskCompleted, stepId: 1, action: "recovery_attempt_1", result: { type: "recovery_attempt", stepId: 1 }, status: "completed" });
    saveExecutionMemory({ taskId: taskFailed, stepId: 1, action: "recovery_attempt_1", result: { type: "recovery_attempt", stepId: 1 }, status: "completed" });

    const global = getAgentMetrics();
    expect(global.recoveryAttempts).toBe(2);
    expect(global.successfulRecoveries).toBe(1);
    expect(global.failedRecoveries).toBe(1);
    expect(global.recoverySuccessRate).toBe(0.5);

    const scoped = getAgentMetrics({ taskId: taskCompleted });
    expect(scoped.recoveryAttempts).toBe(1);
    expect(scoped.successfulRecoveries).toBe(1);
    expect(scoped.failedRecoveries).toBe(0);
    expect(scoped.recoverySuccessRate).toBe(1);
  });

  it("tracks failed execution actions", () => {
    const task = "metrics-failed-" + Date.now();
    saveExecutionMemory({ taskId: task, stepId: 1, action: "build", result: { error: "failed" }, status: "failed" });
    saveExecutionMemory({ taskId: task, stepId: 2, action: "test", result: { error: "failed" }, status: "failed" });
    saveExecutionMemory({ taskId: task, stepId: 3, action: "fix", result: { ok: true }, status: "completed" });

    const metrics = getAgentMetrics();
    expect(metrics.failedActions).toBeGreaterThanOrEqual(2);
  });
});
