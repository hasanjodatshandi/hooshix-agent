import { describe, expect, it } from "vitest";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";
import { saveExecutionMemory } from "../../src/core/memory/sqlite-memory.js";
import { getAgentMetrics } from "../../src/core/trace/metrics-service.js";

describe("observability metrics", () => {
  it("reports zero metrics for empty database", () => {
    const metrics = getAgentMetrics();
    expect(metrics.recoverySuccessRate).toBe(0);
    expect(metrics.toolFailureRate).toBe(0);
    expect(metrics.averageRecoveryTimeMs).toBe(0);
    expect(metrics.failedActions).toBe(0);
    expect(metrics.mostFailedTools).toEqual([]);
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

  it("tracks failed execution actions", () => {
    const task = "metrics-failed-" + Date.now();
    saveExecutionMemory({ taskId: task, stepId: 1, action: "build", result: { error: "failed" }, status: "failed" });
    saveExecutionMemory({ taskId: task, stepId: 2, action: "test", result: { error: "failed" }, status: "failed" });
    saveExecutionMemory({ taskId: task, stepId: 3, action: "fix", result: { ok: true }, status: "completed" });

    const metrics = getAgentMetrics();
    expect(metrics.failedActions).toBeGreaterThanOrEqual(2);
  });
});
