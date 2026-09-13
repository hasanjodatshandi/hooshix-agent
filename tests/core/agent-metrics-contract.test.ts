import { describe, expect, it } from "vitest";
import {
  agentMetricsArguments,
  parseTimestamp,
} from "../../src/core/executor/handlers/metrics-arguments.js";
import { getAgentMetrics } from "../../src/core/trace/metrics-service.js";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";

describe("agent_metrics argument validation", () => {
  it("accepts a full ISO timestamp range", () => {
    const parsed = agentMetricsArguments.parse({
      from: "2026-09-13T00:00:00.000Z",
      to: "2026-09-13T03:00:00.000Z",
    });
    expect(parsed.from).toBe("2026-09-13T00:00:00.000Z");
  });

  it("accepts plain dates (YYYY-MM-DD)", () => {
    expect(() => agentMetricsArguments.parse({ from: "2026-09-01" })).not.toThrow();
  });

  it("rejects a non-date string with an explicit error (audit defect 1)", () => {
    expect(() => agentMetricsArguments.parse({ from: "not-a-date" })).toThrow(
      /from must be an ISO 8601 date/,
    );
    expect(() => agentMetricsArguments.parse({ to: "not-a-date" })).toThrow(
      /to must be an ISO 8601 date/,
    );
  });

  it("rejects non-ISO forms that Date.parse would leniently accept", () => {
    expect(() => agentMetricsArguments.parse({ from: "2026/09/13" })).toThrow(/ISO 8601/);
    expect(() => agentMetricsArguments.parse({ from: "2026-09" })).toThrow(/ISO 8601/);
    expect(() => agentMetricsArguments.parse({ from: "Sept 1 2026" })).toThrow(/ISO 8601/);
  });

  it("rejects from > to with an explicit error (audit defect 2)", () => {
    expect(() =>
      agentMetricsArguments.parse({
        from: "2026-09-13T03:00:00.000Z",
        to: "2026-09-13T00:00:00.000Z",
      }),
    ).toThrow(/from must be <= to/);
    // mixed precision: plain-date to vs timestamp from
    expect(() =>
      agentMetricsArguments.parse({ from: "2026-09-13T03:00:00.000Z", to: "2026-09-13" }),
    ).toThrow(/from must be <= to/);
  });

  it("parses plain dates as UTC day boundaries", () => {
    expect(parseTimestamp("2026-09-01")).toBe(Date.parse("2026-09-01T00:00:00.000Z"));
  });
});

describe("agent_metrics aggregate consistency", () => {
  it("mostFailedTools respects the category filter (audit defect 3)", async () => {
    const corr = "mft-orch-" + Date.now();
    // one orchestration failure — must show up when filtering category=orchestration
    await auditToolCall("task_run", corr, undefined, () => {
      throw new Error("boom");
    }).catch(() => {});

    const filtered = getAgentMetrics({ category: "orchestration" });
    const taskRun = filtered.mostFailedTools.find((t) => t.tool === "task_run");
    expect(taskRun).toBeDefined();
    expect(taskRun!.failures).toBeGreaterThanOrEqual(1);
    // internal consistency: rate and list agree
    expect(filtered.toolFailureRate).toBeGreaterThan(0);
  });

  it("mostFailedTools respects the tool filter", async () => {
    const corr = "mft-tool-" + Date.now();
    await auditToolCall("delete_file", corr, undefined, () => {
      throw new Error("nope");
    }).catch(() => {});

    const filtered = getAgentMetrics({ tool: "delete_file" });
    expect(filtered.mostFailedTools).toEqual([{ tool: "delete_file", failures: 1 }]);
    expect(filtered.toolFailureRate).toBe(1);
  });

  it("mostFailedTools respects date bounds (normalized)", async () => {
    const corr = "mft-date-" + Date.now();
    await auditToolCall("read_file", corr, undefined, () => {
      throw new Error("x");
    }).catch(() => {});

    const future = getAgentMetrics({ from: "2030-01-01" });
    expect(future.mostFailedTools).toEqual([]);
    expect(future.workflowTotalActions).toBe(0);
  });

  it("failedActions honors taskId and date bounds (documented contract)", async () => {
    const taskId = "fa-task-" + Date.now();
    const corr = "fa-corr-" + Date.now();
    await auditToolCall("read_file", corr, taskId, () => {
      throw new Error("step failed");
    }).catch(() => {});
    const { saveExecutionMemory } = await import("../../src/core/memory/sqlite-memory.js");
    saveExecutionMemory({
      taskId,
      stepId: 1,
      action: "step",
      result: { error: "step failed" },
      status: "failed",
      correlationId: corr,
    });

    const scoped = getAgentMetrics({ taskId });
    expect(scoped.failedActions).toBe(1);

    // date filter that excludes everything must zero it too
    const excluded = getAgentMetrics({ taskId, from: "2030-01-01" });
    expect(excluded.failedActions).toBe(0);

    // tool filter does NOT apply to step records (documented contract)
    const toolFiltered = getAgentMetrics({ taskId, tool: "__nonexistent__" });
    expect(toolFiltered.failedActions).toBe(1);
    expect(toolFiltered.pagination.total).toBe(0);
  });
});
