import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { readWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";
import { getApprovalRequest } from "../../src/core/governance/approval-memory.js";

const root = "tests/runtime-task-service";

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("persistent task runtime", () => {
  it("rejects oversized task plans before persistence", () => {
    const runtime = createTaskRuntimeService();
    expect(() => runtime.create({
      title: "oversized",
      steps: [{ action: "write", tool: "write_file", arguments: { path: `${root}/large.txt`, content: "x".repeat(8 * 1024 * 1024) } }]
    })).toThrow("8 MiB");
  });

  it("executes an explicit ChatGPT plan and reloads it after restart", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "create and run script",
      steps: [
        { action: "create script", tool: "create_file", arguments: { path: `${root}/hello.cjs`, content: "console.log('hello-v1')" } },
        { action: "run script", tool: "execute_command", arguments: { command: "node", args: [`${root}/hello.cjs`] }, dependsOn: [1] }
      ],
      correlationId: "runtime-persistence"
    });

    // node <script> is approval-gated; approve the second step upfront
    const paused = await runtime.run(plan.id, 0);
    expect(paused.status).toBe("pending_approval");
    expect(paused.approvalId).toBeTypeOf("number");
    runtime.approve(paused.approvalId!);
    const result = await runtime.resume(paused.approvalId!);
    expect(result.status).toBe("completed");
    expect(await readWorkspaceFile(`${root}/hello.cjs`)).toContain("hello-v1");

    const restarted = createTaskRuntimeService();
    const restored = restarted.get(plan.id)!;
    expect(restored.steps.map((step) => step.status)).toEqual(["completed", "completed"]);
    expect(JSON.stringify(restored.steps[1].output)).toContain("hello-v1");
    expect(restarted.report(plan.id).status).toBe("completed");
  });

  it("requires approval based on the delete tool and restores its backup", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(`${root}/delete-me.txt`, "recoverable", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "approval enforcement",
      steps: [{ action: "harmless label", tool: "delete_file", arguments: { path: `${root}/delete-me.txt` } }]
    });

    const paused = await runtime.run(plan.id, 0);
    expect(paused.status).toBe("pending_approval");
    expect(paused.approvalId).toBeTypeOf("number");
    await expect(runtime.run(plan.id, 0)).rejects.toThrow("pending approval");
    expect(runtime.approve(paused.approvalId!)).toEqual({ approved: true });
    const resumed = await runtime.resume(paused.approvalId!);
    expect(resumed.status).toBe("completed");
    await expect(readWorkspaceFile(`${root}/delete-me.txt`)).rejects.toThrow();

    const persisted = runtime.get(plan.id)!;
    const backupId = (persisted.steps[0].output as { backupId: string }).backupId;
    await runWithPolicyApproval("restore_file", async () => {
      const { restoreWorkspaceFile } = await import("../../src/services/filesystem/filesystem-service.js");
      return restoreWorkspaceFile(backupId);
    });
    expect(await readWorkspaceFile(`${root}/delete-me.txt`)).toBe("recoverable");
    const notResumable = await runtime.resume(paused.approvalId!);
    expect(notResumable.status).toBe("not_resumable");
    expect((notResumable as any).reason).toBe("approval_already_consumed");
  });

  it("persists a failed command and retries it after ChatGPT fixes the cause", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(`${root}/recover.cjs`, "process.exit(2)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "retry failed step",
      steps: [{ action: "run recoverable script", tool: "execute_command", arguments: { command: "node", args: [`${root}/recover.cjs`] } }]
    });

    // node <script> is approval-gated — approve then run
    const paused = await runtime.run(plan.id, 0);
    expect(paused.status).toBe("pending_approval");
    runtime.approve(paused.approvalId!);
    const failed = await runtime.resume(paused.approvalId!);
    expect(failed.status).toBe("failed");
    expect(runtime.get(plan.id)!.steps[0].status).toBe("failed");

    // Re-running requires a fresh approval (the old one was consumed)
    const pausedAgain = await runtime.run(plan.id, 0);
    if (pausedAgain.status === "pending_approval") {
      runtime.approve(pausedAgain.approvalId!);
      const retried = await runtime.resume(pausedAgain.approvalId!);
      expect(retried.status).toBe("failed");
    }

    await fs.writeFile(`${root}/recover.cjs`, "console.log('recovered')", "utf8");
    const third = await runtime.run(plan.id, 0);
    if (third.status === "pending_approval") {
      runtime.approve(third.approvalId!);
      const done = await runtime.resume(third.approvalId!);
      expect(done.status).toBe("completed");
    } else {
      expect(third.status).toBe("completed");
    }
    expect(JSON.stringify(runtime.get(plan.id)!.steps[0].output)).toContain("recovered");
  });

  it("cancel revokes pending approvals", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(`${root}/keep-me.txt`, "KEEP_ME", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "cancel-revoke-test",
      steps: [
        { action: "keep", tool: "read_file", arguments: { path: `${root}/keep-me.txt` } },
        { action: "destroy", tool: "delete_file", arguments: { path: `${root}/keep-me.txt` }, dependsOn: [1] },
      ],
    });
    // Step 1 runs and completes (read_file is safe)
    // Step 2 requires approval → pauses
    const result = await runtime.run(plan.id, 0);
    expect(result.status).toBe("pending_approval");
    const approvalId = result.approvalId!;
    expect(getApprovalRequest(approvalId)?.status).toBe("pending");

    // Cancel the task → approval should be revoked
    expect(runtime.cancel(plan.id)).toBe(true);
    expect(getApprovalRequest(approvalId)?.status).toBe("revoked");

    // Approve should now fail (revoked)
    expect(runtime.approve(approvalId)).toEqual({ approved: false, reason: "approval_revoked" });

    // File should be untouched
    expect(await readWorkspaceFile(`${root}/keep-me.txt`)).toBe("KEEP_ME");
  });

  it("task_run on cancelled task returns idempotent response", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "idempotent-cancel-test",
      steps: [{ action: "info", tool: "get_system_info", arguments: {} }],
    });
    runtime.cancel(plan.id);
    // Should not throw, should return cancelled status
    const result = await runtime.run(plan.id, 0);
    expect(result.status).toBe("cancelled");
  });

  it("resume on cancelled task returns not_resumable without consuming approval", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(`${root}/safe.txt`, "SAFE", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "resume-cancel-test",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: `${root}/safe.txt` } },
        { action: "delete", tool: "delete_file", arguments: { path: `${root}/safe.txt` }, dependsOn: [1] },
      ],
    });
    const result = await runtime.run(plan.id, 0);
    expect(result.status).toBe("pending_approval");
    const approvalId = result.approvalId!;

    // Approve first, then cancel the task
    runtime.approve(approvalId);
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
    runtime.cancel(plan.id);
    expect(getApprovalRequest(approvalId)?.status).toBe("revoked");

    // Resume should return not_resumable without error
    const resumeResult = await runtime.resume(approvalId);
    expect(resumeResult.status).toBe("not_resumable");
    expect((resumeResult as any).reason).toBe("approval_revoked");
    // File must NOT be deleted
    expect(await readWorkspaceFile(`${root}/safe.txt`)).toBe("SAFE");
  });

  it("approve returns false for cancelled task", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "approve-cancel-test",
      steps: [{ action: "info", tool: "get_system_info", arguments: {} }],
    });
    const result = await runtime.run(plan.id, 0);
    if (result.status === "pending_approval") {
      runtime.cancel(plan.id);
      const approveResult = runtime.approve(result.approvalId!);
      expect(approveResult).toEqual({ approved: false, reason: "task_cancelled" });
    }
  });
});
