import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { createExecutionContext } from "../../src/core/runtime/execution-context.js";
import { PersistentRecoveryRepository } from "../../src/core/trace/recovery-repository.js";
import { RecoveryReplayService } from "../../src/core/trace/recovery-replay-service.js";
import { UnifiedTimelineService } from "../../src/core/trace/unified-timeline-service.js";
import { SqliteTraceRepository } from "../../src/core/trace/trace-repository.js";

describe("self healing closed loop e2e", () => {
  it("runs a corrective step, retries the failed step, and persists one recovery", async () => {
    const correlationId = "self-heal-e2e";
    let originalAttempts = 0;
    const plan = {
      id: "self-heal-task",
      task: "recover task",
      steps: [{ id: 1, action: "original step", status: "pending" as const }]
    };
    const recoveryProvider = {
      decide: () => ({
        type: "create_step" as const,
        reason: "run corrective action",
        step: { id: 2, action: "corrective step", status: "pending" as const }
      })
    };

    const result = await runClosedAgentLoop(plan, async (_tool, step) => {
      if (step.action === "original step" && originalAttempts++ === 0) throw new Error("build failed");
      return { ok: true };
    }, 1, 0, createExecutionContext({ taskId: plan.id, correlationId }), recoveryProvider);

    expect(result.status).toBe("completed");
    expect(plan.steps.map((step) => step.action)).toEqual(["corrective step", "original step"]);
    expect(originalAttempts).toBe(2);

    const repository = new PersistentRecoveryRepository();
    expect(repository.findByCorrelationId(correlationId).map((event) => event.status)).toEqual(["started", "completed"]);
    expect(new RecoveryReplayService(repository).replay(correlationId).recoveryCount).toBe(1);

    const timeline = new UnifiedTimelineService(new SqliteTraceRepository(), repository).build(correlationId);
    expect(timeline.finalStatus).toBe("completed");
    expect(timeline.events.some((event) => event.type === "recovery_started")).toBe(true);
    expect(timeline.events.some((event) => event.type === "recovery_completed")).toBe(true);
  });
});
