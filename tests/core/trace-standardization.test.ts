import { describe, expect, it } from "vitest";
import { getExecutionTrace, type ExecutionTraceEvent } from "../../src/core/memory/execution-trace.js";
import { buildReplayReport, type ReplayReport } from "../../src/core/trace/replay-engine.js";
import { saveExecutionMemory, saveDecisionMemory } from "../../src/core/memory/sqlite-memory.js";
import { saveCheckpoint } from "../../src/core/memory/checkpoint-memory.js";
import { createApprovalRequest } from "../../src/core/governance/approval-memory.js";
import { withAgentDatabase } from "../../src/core/memory/database.js";

describe("trace standardization", () => {
  it("populates trace from execution, decision, checkpoint, and approval tables", () => {
    const cid = "trace-multi-" + Date.now();
    const now = new Date().toISOString();

    // Insert into tasks (runtime source)
    withAgentDatabase((db) => {
      db.prepare(`INSERT INTO tasks(id, description, status, correlation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run("trace-task-1", "test task", "completed", cid, now, now);
    });

    // Insert execution
    saveExecutionMemory({ taskId: "trace-task-1", stepId: 1, action: "read file", result: { ok: true }, correlationId: cid });

    // Insert decision
    saveDecisionMemory({ taskId: "trace-task-1", reason: "low risk", action: "allow", correlationId: cid });

    // Insert checkpoint
    saveCheckpoint({ taskId: "trace-task-1", stepId: 1, stepIndex: 0, state: { status: "completed" }, correlationId: cid });

    // Insert approval
    createApprovalRequest({ taskId: "trace-task-1", stepId: 1, action: "delete file", risk: "high", reason: "destructive", correlationId: cid });

    const trace = getExecutionTrace(cid);

    expect(trace.length).toBeGreaterThanOrEqual(4);

    // Verify all required fields present on every event
    for (const event of trace) {
      expect(typeof event.id).toBe("string");
      expect(event.correlationId).toBe(cid);
      expect(typeof event.source).toBe("string");
      expect(typeof event.type).toBe("string");
      expect(typeof event.timestamp).toBe("string");
      expect(event.payload).toBeDefined();
    }

    // Verify sources are represented
    const sources = new Set(trace.map((e) => e.source));
    expect(sources.has("runtime")).toBe(true);
    expect(sources.has("governance")).toBe(true);
    expect(sources.has("checkpoint")).toBe(true);

    // Verify types are represented
    const types = new Set(trace.map((e) => e.type));
    expect(types.has("execution")).toBe(true);
    expect(types.has("decision")).toBe(true);
    expect(types.has("checkpoint")).toBe(true);
    expect(types.has("approval")).toBe(true);
  });

  it("trace replay produces deterministic output from trace events", () => {
    const events: ExecutionTraceEvent[] = [
      { id: "task:1", correlationId: "replay-1", source: "runtime", type: "task", timestamp: "2025-01-01T00:00:00Z", payload: { status: "completed" } },
      { id: "execution:1", correlationId: "replay-1", source: "runtime", type: "execution", timestamp: "2025-01-01T00:00:01Z", payload: { step_id: 1, action: "read" } },
      { id: "decision:1", correlationId: "replay-1", source: "governance", type: "decision", timestamp: "2025-01-01T00:00:00Z", payload: { action: "allow" } },
      { id: "checkpoint:1", correlationId: "replay-1", source: "checkpoint", type: "checkpoint", timestamp: "2025-01-01T00:00:02Z", payload: { step_id: 1, state: { status: "completed" } } }
    ];

    const report: ReplayReport = buildReplayReport("replay-1", events);

    expect(report.correlationId).toBe("replay-1");
    expect(report.totalEvents).toBe(4);
    expect(report.steps).toHaveLength(4);
    expect(report.steps[0].id).toBe("task:1");
    expect(report.steps[0].source).toBe("runtime");
    expect(report.steps[0].type).toBe("task");
    expect(report.steps[0].timestamp).toBe("2025-01-01T00:00:00Z");
    expect(report.steps[0].payload).toEqual({ status: "completed" });

    // Deterministic: same input produces same output
    const report2 = buildReplayReport("replay-1", events);
    expect(report2).toEqual(report);
  });
});
