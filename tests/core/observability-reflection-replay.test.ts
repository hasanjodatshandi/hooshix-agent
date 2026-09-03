import { describe, expect, it } from "vitest";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";
import { saveExecutionMemory } from "../../src/core/memory/sqlite-memory.js";
import { analyzeTaskHistory } from "../../src/core/reflection/reflection-engine.js";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { getAgentMetrics } from "../../src/core/trace/metrics-service.js";
import { ReplayExecutor } from "../../src/core/trace/replay-executor.js";

describe("observability, reflection, and execution replay", () => {
  it("calculates tool metrics and a structured reflection report", async () => {
    await auditToolCall("read_file", "metrics-correlation", "metrics-task", () => "ok");
    await expect(auditToolCall("read_file", "metrics-correlation", "metrics-task", () => { throw new Error("no file"); })).rejects.toThrow();
    saveExecutionMemory({ taskId: "metrics-task", stepId: 1, action: "read missing", result: { error: "no file" }, status: "failed", correlationId: "metrics-correlation" });
    expect(getAgentMetrics()).toMatchObject({ toolFailureRate: 0.5, mostFailedTools: [{ tool: "read_file", failures: 1 }] });
    expect(analyzeTaskHistory("metrics-task")).toMatchObject({ problem: "read missing", confidence: 0.4 });
  });

  it("recreates context and executes a read-only task", async () => {
    const runtime = createTaskRuntimeService();
    const source = runtime.create({ title: "read metadata", steps: [{ action: "read", tool: "read_file", arguments: { path: "package.json" } }] });
    expect((await runtime.run(source.id, 0)).status).toBe("completed");
    const replay = await new ReplayExecutor(runtime).replay(source.id);
    expect(replay.status).toBe("completed");
    expect(replay.equivalentStepStates).toBe(true);
    expect(replay.replayTaskId).not.toBe(source.id);
  });

  it("requires explicit confirmation before replaying mutations", async () => {
    const runtime = createTaskRuntimeService();
    const source = runtime.create({ title: "write", steps: [{ action: "write", tool: "write_file", arguments: { path: "tests/replay-write.txt", content: "x" } }] });
    await expect(new ReplayExecutor(runtime).replay(source.id)).rejects.toThrow("explicit confirmation");
  });
});
