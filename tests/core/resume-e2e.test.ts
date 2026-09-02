import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { approveRequest, getApprovalRequest } from "../../src/core/governance/approval-memory.js";
import { resumeApprovedTask } from "../../src/core/loop/resume-orchestrator.js";

describe("full pause approve resume flow", () => {
  it("continues the exact approved action once with the same correlation id", async () => {
    const executed: number[] = [];
    const plan = {
      id: "approval-resume-task",
      task: "workflow",
      steps: [
        { id: 1, action: "normal first step", status: "pending" as const },
        { id: 2, action: "delete file", status: "pending" as const }
      ]
    };
    const executor = async (_tool: string, step: { id: number }) => {
      executed.push(step.id);
      return { ok: true };
    };

    const paused = await runClosedAgentLoop(plan, executor);
    expect(paused.status).toBe("pending_approval");
    expect(paused.approvalId).toBeTypeOf("number");
    expect(executed).toEqual([1]);

    expect(approveRequest(paused.approvalId!)).toBe(true);
    const resumed = await resumeApprovedTask(paused.approvalId!, plan, executor);
    expect(resumed?.status).toBe("completed");
    expect(resumed?.correlationId).toBe(paused.correlationId);
    expect(executed).toEqual([1, 2]);
    expect(getApprovalRequest(paused.approvalId!)?.status).toBe("consumed");
    expect(await resumeApprovedTask(paused.approvalId!, plan, executor)).toBeNull();
  });

  it("does not apply an approval to a different plan", async () => {
    const plan = { id: "approved-task", task: "x", steps: [{ id: 1, action: "delete file", status: "pending" as const }] };
    const paused = await runClosedAgentLoop(plan, async () => ({}));
    approveRequest(paused.approvalId!);
    const otherPlan = { ...plan, id: "other-task", steps: [{ ...plan.steps[0] }] };
    expect(await resumeApprovedTask(paused.approvalId!, otherPlan, async () => ({}))).toBeNull();
  });
});
