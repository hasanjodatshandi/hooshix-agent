import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { getTaskPlan, saveTaskPlan } from "../../src/core/memory/task-repository.js";
import { recordTaskReconciliation, getTaskReconciliations } from "../../src/core/recovery/task-reconciliation.js";
import { analyzeTaskHistory } from "../../src/core/reflection/reflection-engine.js";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { getTrustedInboundIdentity } from "../../src/core/runtime/r2-trusted-inbound-identity.js";
import { getWorkspaceRoot, listWorkspaceRoots, isUnrestrictedMode } from "../../src/security/workspace-guard.js";

function bindFixtureTaskIdentity(plan:ReturnType<typeof createTaskPlan>):void {
  const identity=getTrustedInboundIdentity();
  const roots=listWorkspaceRoots().map(root=>root.path);
  plan.executionContext={
    principalId:identity.principal.id,sessionId:identity.sessionId,
    origin:identity.principal.origin,scopes:[...identity.principal.scopes],
    workspace:getWorkspaceRoot(),roots,allowedRootsSnapshot:roots,
    unrestricted:isUnrestrictedMode(),createdAt:new Date().toISOString(),
  };
}

function interruptedTask() {
  const plan = createTaskPlan("interrupted task", [
    { action: "write marker and hold", tool: "execute_command", arguments: { command: "node" }, status: "outcome_unknown" },
  ]);
  plan.correlationId = crypto.randomUUID();
  bindFixtureTaskIdentity(plan);
  plan.steps[0].status = "outcome_unknown";
  saveTaskPlan(plan, "failed", plan.correlationId);
  return plan;
}

function completedVerification(tool: "read_file" | "write_file" = "read_file") {
  const plan = createTaskPlan("independent evidence inspection", [
    { action: "inspect marker", tool, arguments: { path: "test-marker", ...(tool === "write_file" ? { content: "proof" } : {}) }, status: "completed" },
  ]);
  plan.correlationId = crypto.randomUUID();
  bindFixtureTaskIdentity(plan);
  plan.steps[0].status = "completed";
  saveTaskPlan(plan, "completed", plan.correlationId);
  return plan;
}

describe("outcome_unknown reconciliation", () => {
  it("records a verified side effect without completing or replaying the interrupted step", () => {
    const interrupted = interruptedTask();
    const verification = completedVerification();
    const recorded = recordTaskReconciliation({
      taskId: interrupted.id,
      stepId: 1,
      finding: "effect_observed",
      evidence: "Marker created at the checkpoint time, verified by a separate read-only task.",
      verificationTaskId: verification.id,
    });
    expect(recorded.finding).toBe("effect_observed");
    expect(recorded.replayed).toBe(false);
    expect(recorded.stepStatus).toBe("outcome_unknown");
    expect(getTaskPlan(interrupted.id)!.steps[0].status).toBe("outcome_unknown");
    expect(getTaskPlan(interrupted.id)!.state).toBe("failed");
    expect(getTaskReconciliations(interrupted.id).length).toBe(1);
    const report = createTaskRuntimeService().report(interrupted.id);
    expect(report.reconciliations.length).toBe(1);
    expect(report.reflection.solution).toContain("final result remains unknown");
    expect(report.reflection.solution).not.toContain("Existing execution path succeeded");
  });

  it("rejects unsupported claims, mutating proof, and unrelated non-unknown steps", () => {
    const interrupted = interruptedTask();
    expect(() => recordTaskReconciliation({ taskId: interrupted.id, stepId: 1, finding: "effect_observed",
      evidence: "Operator saw a file", })).toThrow("verification task");
    const mutableProof = completedVerification("write_file");
    expect(() => recordTaskReconciliation({ taskId: interrupted.id, stepId: 1, finding: "effect_observed",
      evidence: "Marker was found", verificationTaskId: mutableProof.id })).toThrow("read-only");
    expect(() => recordTaskReconciliation({ taskId: interrupted.id, stepId: 2, finding: "undetermined",
      evidence: "No evidence found", })).toThrow("outcome_unknown");
    expect(getTaskReconciliations(interrupted.id)).toEqual([]);
  });

  it("records uncertainty without claiming a successful result", () => {
    const interrupted = interruptedTask();
    recordTaskReconciliation({ taskId: interrupted.id, stepId: 1, finding: "undetermined",
      evidence: "No reliable output or artifact can prove completion." });
    const report = analyzeTaskHistory(interrupted.id);
    expect(report.problem).toContain("Outcome unknown");
    expect(report.confidence).toBe(0);
    expect(report.solution).toContain("do not automatically replay");
  });

  it("exposes task_reconcile over MCP and preserves outcome_unknown", async () => {
    const { connectInProcessMcp, json } = await import("../helpers/in-process-mcp.js");
    const interrupted = interruptedTask();
    const verification = completedVerification();
    const harness = await connectInProcessMcp();
    try {
      const tools = await harness.client.listTools();
      expect(tools.tools.some((t) => t.name === "task_reconcile")).toBe(true);
      const result = json(await harness.client.callTool({ name: "task_reconcile", arguments: {
        taskId: interrupted.id,
        stepId: 1,
        finding: "effect_observed",
        evidence: "An independent read-only task verified the crash marker file.",
        verificationTaskId: verification.id,
      } }));
      expect(result.finding).toBe("effect_observed");
      expect(result.stepStatus).toBe("outcome_unknown");
      const report = json(await harness.client.callTool({ name: "task_report", arguments: { taskId: interrupted.id } }));
      expect(report.reconciliations).toHaveLength(1);
      expect(report.reflection.solution).toContain("final result remains unknown");
      expect(report.task.steps[0].status).toBe("outcome_unknown");
    } finally {
      await harness.close();
    }
  });
});