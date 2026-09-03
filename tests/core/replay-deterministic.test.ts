import { describe, expect, it } from "vitest";
import { buildReplayReport } from "../../src/core/trace/replay-engine.js";
import { simulateReplay } from "../../src/core/trace/replay-simulator.js";
import { AgentReplayService } from "../../src/core/trace/agent-replay-service.js";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { ReplayExecutor } from "../../src/core/trace/replay-executor.js";
import type { ExecutionTraceEvent } from "../../src/core/memory/execution-trace.js";

describe("deterministic replay", () => {
  const sampleEvents: ExecutionTraceEvent[] = [
    { id: "task:1", correlationId: "det-1", source: "runtime", type: "task", timestamp: "2025-01-01T00:00:00Z", payload: { status: "completed" } },
    { id: "execution:1", correlationId: "det-1", source: "runtime", type: "execution", timestamp: "2025-01-01T00:00:01Z", payload: { step_id: 1, action: "read", result: { content: "hello" } } },
    { id: "decision:1", correlationId: "det-1", source: "governance", type: "decision", timestamp: "2025-01-01T00:00:00Z", payload: { action: "allow" } },
    { id: "checkpoint:1", correlationId: "det-1", source: "checkpoint", type: "checkpoint", timestamp: "2025-01-01T00:00:02Z", payload: { step_id: 1, state: { status: "completed" } } }
  ];

  it("buildReplayReport is deterministic for same input", () => {
    const report1 = buildReplayReport("det-1", sampleEvents);
    const report2 = buildReplayReport("det-1", sampleEvents);
    expect(report1).toEqual(report2);
  });

  it("simulateReplay is deterministic for same input", () => {
    const report = buildReplayReport("det-1", sampleEvents);
    const sim1 = simulateReplay(report);
    const sim2 = simulateReplay(report);
    expect(sim1).toEqual(sim2);
    expect(sim1.steps.length).toBe(4);
    expect(sim1.steps.every((s) => s.simulated)).toBe(true);
  });

  it("AgentReplayService produces consistent reports", () => {
    const service = new AgentReplayService({
      getTrace: () => sampleEvents
    } as any);

    const report1 = service.replayExecution("det-1");
    const report2 = service.replayExecution("det-1");
    expect(report1).toEqual(report2);
    expect(report1.correlationId).toBe("det-1");
    expect(report1.totalEvents).toBe(4);
    expect(report1.steps[0].id).toBe("task:1");
  });

  it("execution replay produces equivalent step states", async () => {
    const runtime = createTaskRuntimeService();
    const source = runtime.create({
      title: "deterministic replay test",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: "package.json" } }
      ]
    });
    await runtime.run(source.id, 0);

    const replay = await new ReplayExecutor(runtime).replay(source.id);
    expect(replay.status).toBe("completed");
    expect(replay.equivalentStepStates).toBe(true);
    expect(replay.sourceTaskId).toBe(source.id);
    expect(replay.replayTaskId).not.toBe(source.id);
  });

  it("replay preserves input event ordering", () => {
    const events: ExecutionTraceEvent[] = [
      { id: "a:1", correlationId: "order-1", source: "runtime", type: "task", timestamp: "2025-01-01T00:00:03Z", payload: {} },
      { id: "b:1", correlationId: "order-1", source: "runtime", type: "execution", timestamp: "2025-01-01T00:00:01Z", payload: {} },
      { id: "c:1", correlationId: "order-1", source: "governance", type: "decision", timestamp: "2025-01-01T00:00:02Z", payload: {} }
    ];
    const report = buildReplayReport("order-1", events);
    // Replay preserves the order of events as provided
    expect(report.steps[0].id).toBe("a:1");
    expect(report.steps[1].id).toBe("b:1");
    expect(report.steps[2].id).toBe("c:1");
    expect(report.steps[0].timestamp).toBe("2025-01-01T00:00:03Z");
    expect(report.steps[1].timestamp).toBe("2025-01-01T00:00:01Z");
    expect(report.steps[2].timestamp).toBe("2025-01-01T00:00:02Z");
  });
});
