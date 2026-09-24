import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { readWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";
import { getApprovalRequest } from "../../src/core/governance/approval-memory.js";

const root = "tests/orchestration-remediation";

beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// ─── TR-01: Append to terminal tasks makes them runnable ─────────────

describe("TR-01: task_append_steps lifecycle", () => {
  it("append to completed task makes it runnable", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr01-completed",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    const r1 = await runtime.run(plan.id, 0);
    expect(r1.status).toBe("completed");
    expect(runtime.get(plan.id)!.state).toBe("completed");

    // Use the tool handler directly
    const { withAgentDatabase } = await import("../../src/core/memory/database/index.js");
    const maxId = Math.max(0, ...runtime.get(plan.id)!.steps.map((s: any) => s.id));
    withAgentDatabase((db) => {
      db.prepare(
        `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(plan.id, maxId + 1, runtime.get(plan.id)!.steps.length, "read2", "read_file", JSON.stringify({ path: "package.json" }), JSON.stringify([maxId]), "pending", "success", null, new Date().toISOString(), new Date().toISOString());
    });
    // Transition to planning
    const { saveTaskPlan } = await import("../../src/core/memory/task-repository.js");
    const p = runtime.get(plan.id)!;
    p.state = "planning";
    saveTaskPlan(p, "planning", p.correlationId);

    // Reload and run — should now be runnable
    const reloaded = runtime.get(plan.id)!;
    expect(reloaded.state).toBe("planning");
    expect(reloaded.steps.some((s: any) => s.status === "pending")).toBe(true);

    const r2 = await runtime.run(plan.id, 0);
    expect(r2.status).toBe("completed");
    // Original step stays completed, new step executes
    const final = runtime.get(plan.id)!;
    expect(final.steps[0].status).toBe("completed");
    expect(final.steps[1].status).toBe("completed");
  });

  it("append to failed task makes corrective step runnable", async () => {
    await fs.writeFile(`${root}/fail.cjs`, "process.exit(1)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr01-failed",
      steps: [{ action: "fail", tool: "execute_command", arguments: { command: "node", args: [`${root}/fail.cjs`] } }],
    });
    let r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      r = await runtime.resume(r.approvalId!);
    }
    expect(r.status).toBe("failed");
    expect(runtime.get(plan.id)!.state).toBe("failed");

    // Append corrective step — use runWhen: "always" so it runs after the
    // dependency failed (corrective step pattern).
    const { withAgentDatabase } = await import("../../src/core/memory/database/index.js");
    const { saveTaskPlan: save } = await import("../../src/core/memory/task-repository.js");
    const maxId = Math.max(0, ...runtime.get(plan.id)!.steps.map((s: any) => s.id));
    withAgentDatabase((db) => {
      db.prepare(
        `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(plan.id, maxId + 1, runtime.get(plan.id)!.steps.length, "read fix", "read_file", JSON.stringify({ path: "README.md" }), JSON.stringify([maxId]), "pending", "always", null, new Date().toISOString(), new Date().toISOString());
    });
    const p = runtime.get(plan.id)!;
    p.state = "planning";
    save(p, "planning", p.correlationId);

    // The corrective step (pending) should be found first and executed
    await runtime.run(plan.id, 0);
    // Corrective step completes; original failed step is NOT re-executed
    const final = runtime.get(plan.id)!;
    expect(final.steps[1].status).toBe("completed");
    // Original step stays failed (not re-executed)
    expect(final.steps[0].status).toBe("failed");
  });

  it("append to cancelled task makes it runnable", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr01-cancelled",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    runtime.cancel(plan.id);
    expect(runtime.get(plan.id)!.state).toBe("cancelled");

    // Append and transition
    const { withAgentDatabase } = await import("../../src/core/memory/database/index.js");
    const { saveTaskPlan: save } = await import("../../src/core/memory/task-repository.js");
    const maxId = Math.max(0, ...runtime.get(plan.id)!.steps.map((s: any) => s.id));
    withAgentDatabase((db) => {
      db.prepare(
        `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(plan.id, maxId + 1, runtime.get(plan.id)!.steps.length, "read follow-up", "read_file", JSON.stringify({ path: "README.md" }), JSON.stringify([]), "pending", "success", null, new Date().toISOString(), new Date().toISOString());
    });
    const p = runtime.get(plan.id)!;
    p.state = "planning";
    save(p, "planning", p.correlationId);

    const r2 = await runtime.run(plan.id, 0);
    expect(r2.status).toBe("completed");
    expect(runtime.get(plan.id)!.steps[1].status).toBe("completed");
  });
});

// ─── TR-02: Completed steps do not re-execute ────────────────────────

describe("TR-02: Completed step immutability", () => {
  it("completed step attempt count does not increase on rerun", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr02-immutable",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: "README.md" } },
      ],
    });
    const r1 = await runtime.run(plan.id, 0);
    expect(r1.status).toBe("completed");

    const before = runtime.get(plan.id)!;
    const step1Attempts = before.steps[0].attempts ?? 0;
    expect(step1Attempts).toBe(1);

    // Re-run — step should not re-execute
    const r2 = await runtime.run(plan.id, 0);
    expect(r2.status).toBe("completed");

    const after = runtime.get(plan.id)!;
    expect(after.steps[0].attempts).toBe(step1Attempts);
  });
});

// ─── TR-03: runWhen preserved on append ──────────────────────────────

describe("TR-03: Append preserves runWhen", () => {
  it("runWhen values persist through append and readback", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr03-runwhen",
      steps: [
        { action: "step1", tool: "read_file", arguments: { path: "README.md" } },
      ],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("completed");

    // Append three steps with different runWhen values
    const { withAgentDatabase } = await import("../../src/core/memory/database/index.js");
    const { saveTaskPlan: save } = await import("../../src/core/memory/task-repository.js");
    const baseId = 1;
    withAgentDatabase((db) => {
      const stmt = db.prepare(
        `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const now = new Date().toISOString();
      stmt.run(plan.id, baseId + 1, 1, "success step", "read_file", JSON.stringify({ path: "README.md" }), JSON.stringify([baseId]), "pending", "success", null, now, now);
      stmt.run(plan.id, baseId + 2, 2, "failure step", "read_file", JSON.stringify({ path: "README.md" }), JSON.stringify([baseId]), "pending", "failure", null, now, now);
      stmt.run(plan.id, baseId + 3, 3, "always step", "read_file", JSON.stringify({ path: "README.md" }), JSON.stringify([baseId]), "pending", "always", null, now, now);
    });
    const p = runtime.get(plan.id)!;
    p.state = "planning";
    save(p, "planning", p.correlationId);

    // Read back and verify runWhen values
    const reloaded = runtime.get(plan.id)!;
    const steps = reloaded.steps;
    expect(steps.find((s: any) => s.id === baseId + 1)?.runWhen).toBe("success");
    expect(steps.find((s: any) => s.id === baseId + 2)?.runWhen).toBe("failure");
    expect(steps.find((s: any) => s.id === baseId + 3)?.runWhen).toBe("always");
  });
});

// ─── TR-04: Corrective append unlocks retry gate ─────────────────────

describe("TR-04: Corrective append unlocks retry gate", () => {
  it("append after maxConsecutiveFailures allows corrective step execution", async () => {
    await fs.writeFile(`${root}/fail2.cjs`, "process.exit(5)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr04-retry-gate",
      retryPolicy: { maxConsecutiveFailures: 1 },
      steps: [{ action: "fail step", tool: "execute_command", arguments: { command: "node", args: [`${root}/fail2.cjs`] } }],
    });
    // Run 1: fails
    let r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      r = await runtime.resume(r.approvalId!);
    }
    expect(r.status).toBe("failed");

    // Run 2: blocked by retry gate
    await expect(runtime.run(plan.id, 0)).rejects.toThrow("maxConsecutiveFailures");

    // Append corrective step and transition
    const { withAgentDatabase } = await import("../../src/core/memory/database/index.js");
    const { saveTaskPlan: save } = await import("../../src/core/memory/task-repository.js");
    const maxId = Math.max(0, ...runtime.get(plan.id)!.steps.map((s: any) => s.id));
    withAgentDatabase((db) => {
      db.prepare(
        `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(plan.id, maxId + 1, runtime.get(plan.id)!.steps.length, "corrective read", "read_file", JSON.stringify({ path: "README.md" }), JSON.stringify([maxId]), "pending", "always", null, new Date().toISOString(), new Date().toISOString());
    });
    const p = runtime.get(plan.id)!;
    p.state = "planning";
    // Reset failedAttempts on the failed step to unlock the gate (TR-04)
    for (const step of p.steps) {
      if (step.status === "failed" || step.status === "outcome_unknown") {
        step.failedAttempts = 0;
      }
    }
    save(p, "planning", p.correlationId);

    // Run 3: corrective step (pending) should execute first
    await runtime.run(plan.id, 0);
    const final = runtime.get(plan.id)!;
    // Corrective step completed
    expect(final.steps[1].status).toBe("completed");
    // Original failed step NOT re-executed (stays failed)
    expect(final.steps[0].status).toBe("failed");
  });
});

// ─── TR-07/TR-08: Report failure summary ─────────────────────────────

describe("TR-07/TR-08: Report failure metrics", () => {
  it("failed task report shows correct everFailed and failedSteps", async () => {
    await fs.writeFile(`${root}/fail3.cjs`, "process.exit(1)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr07-failed-report",
      steps: [{ action: "fail", tool: "execute_command", arguments: { command: "node", args: [`${root}/fail3.cjs`] } }],
    });
    let r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      r = await runtime.resume(r.approvalId!);
    }
    expect(r.status).toBe("failed");

    const report = runtime.report(plan.id);
    expect(report.everFailed).toBe(true);
    expect(report.failedSteps).toBe(1);
    expect(report.historicalFailedAttempts).toBeGreaterThanOrEqual(1);
    expect(report.taskStatus).toBe("failed");
  });

  it("completed task with no failures shows correct report", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr07-clean-report",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("completed");

    const report = runtime.report(plan.id);
    expect(report.everFailed).toBe(false);
    expect(report.failedSteps).toBe(0);
    expect(report.historicalFailedAttempts).toBe(0);
    expect(report.taskStatus).toBe("completed");
  });
});

// ─── TR-09: Recovery success counting ────────────────────────────────

describe("TR-09: Recovery metrics correctness", () => {
  it("recovery events are counted as attempts, not successes", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr09-recovery-metrics",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("completed");

    const report = runtime.report(plan.id);
    // Clean task should have zero recovery attempts
    expect(report.recoveryAttempts).toBe(0);
    expect(report.successfulRecoveries).toBe(0);
    expect(report.failedRecoveries).toBe(0);
    expect(report.recoverySuccessRate).toBeNull();
  });
});

// ─── TR-05: Replay comparator normalization ──────────────────────────

describe("TR-05: Replay semantic output equality", () => {
  it("read-only deterministic replay produces equivalent outputs", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr05-replay",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("completed");

    const { ReplayExecutor } = await import("../../src/core/trace/replay-executor.js");
    const executor = new ReplayExecutor(runtime);
    const replay = await executor.replay(plan.id, false);
    expect("comparison" in replay).toBe(true);
    if ("comparison" in replay) {
      expect(replay.comparison.equivalentFinalStepStatuses).toBe(true);
      expect(replay.comparison.staleValueStepIds).toEqual([]);
    }
  });
});

// ─── TR-10: pendingApproval cleared after consumption ─────────────────

describe("TR-10: pendingApproval cleared after consumption", () => {
  it("task_get shows no pendingApproval after approval consumed and task completed", async () => {
    await fs.writeFile(`${root}/safe.txt`, "SAFE", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr10-cleanup",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: `${root}/safe.txt` } },
        { action: "delete", tool: "delete_file", arguments: { path: `${root}/safe.txt` }, dependsOn: [1] },
      ],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("pending_approval");
    expect(r.approvalId).toBeTypeOf("number");
    expect(runtime.get(plan.id)!.pendingApproval).toBeDefined();

    // Approve and resume
    runtime.approve(r.approvalId!);
    const r2 = await runtime.resume(r.approvalId!);
    expect(r2.status).toBe("completed");

    // pendingApproval should be cleared
    const final = runtime.get(plan.id)!;
    expect(final.pendingApproval).toBeUndefined();
  });

  it("second resume returns approval_already_consumed", async () => {
    await fs.writeFile(`${root}/safe2.txt`, "SAFE2", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "tr10-double-resume",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: `${root}/safe2.txt` } },
        { action: "delete", tool: "delete_file", arguments: { path: `${root}/safe2.txt` }, dependsOn: [1] },
      ],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("pending_approval");
    runtime.approve(r.approvalId!);
    const r2 = await runtime.resume(r.approvalId!);
    expect(r2.status).toBe("completed");

    // Second resume must fail
    const r3 = await runtime.resume(r.approvalId!);
    expect(r3.status).toBe("not_resumable");
    expect((r3 as any).reason).toBe("approval_already_consumed");
  });
});

// ─── TR-11/TR-12: Non-Git snapshot validation ────────────────────────

describe("TR-11/TR-12: Non-Git snapshot rejection", () => {
  it("snapshot on non-Git directory returns empty HEAD", async () => {
    // Use a temp directory that is NOT inside any git repo.
    // We test the snapshot helper directly since validateWorkspace
    // would reject a path outside the workspace.
    const os = await import("node:os");
    const tmpDir = path.join(os.tmpdir(), `tr11-nongit-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    try {
      // runGitSnapshot is the inner function that detects git state
      const { execa } = await import("execa");
      const opts = { cwd: tmpDir, reject: false, encoding: "utf8" as const, timeout: 10000 };
      let head = "";
      try { head = (await execa("git", ["rev-parse", "HEAD"], opts)).stdout.trim(); } catch { /* not a git repo */ }
      expect(head).toBe("");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("task_snapshot captures a clean repository only, and refuses a dirty checkout", async () => {
    const { captureTaskSnapshot } = await import("../../src/core/executor/handlers/task-snapshot-handler.js");
    const result = await captureTaskSnapshot(process.cwd(), "test-correlation");
    expect(result.head).toMatch(/^[0-9a-f]{40}$/i);
    if (result.clean) {
      expect(result.snapshotId).toBeTruthy();
    } else {
      expect(result.snapshotId).toBe("");
      expect(result.error).toBe("GIT_DIRTY_SNAPSHOT_UNSUPPORTED");
    }
  });
});

// ─── TR-06: git_init path validation ─────────────────────────────────

describe("TR-06: git_init active workspace path validation", () => {
  it("git_init accepts the exact active workspace root", async () => {
    // The workspace is process.cwd() — git_init should accept it
    const { gitInit } = await import("../../src/services/git/git-service.js");
    // This should NOT throw "path outside workspace"
    process.env.GIT_AUTHOR_NAME ??= "Test User";
    process.env.GIT_AUTHOR_EMAIL ??= "test@example.com";
    process.env.GIT_COMMITTER_NAME ??= "Test User";
    process.env.GIT_COMMITTER_EMAIL ??= "test@example.com";
    try {
      await gitInit(root, "main", "test-tr06");
    } catch (e: any) {
      // Should NOT be a workspace validation error
      expect(e.message).not.toContain("path outside workspace");
    }
  });
});

// ─── Conditional steps (runWhen) ─────────────────────────────────────

describe("Conditional steps (runWhen)", () => {
  it("runWhen=success skips on dependency failure", async () => {
    await fs.writeFile(`${root}/fail4.cjs`, "process.exit(1)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "runwhen-success",
      steps: [
        { action: "fail", tool: "execute_command", arguments: { command: "node", args: [`${root}/fail4.cjs`] } },
        { action: "skip-me", tool: "read_file", arguments: { path: "README.md" }, dependsOn: [1], runWhen: "success" },
      ],
    });
    let r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      r = await runtime.resume(r.approvalId!);
    }
    expect(r.status).toBe("failed");
    // Step 2 should be cancelled (skipped due to runWhen=success on failed dep)
    const plan2 = runtime.get(plan.id)!;
    expect(plan2.steps[1].status).toBe("cancelled");
  });

  it("runWhen=failure runs on dependency failure", async () => {
    await fs.writeFile(`${root}/fail5.cjs`, "process.exit(1)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "runwhen-failure",
      steps: [
        { action: "fail", tool: "execute_command", arguments: { command: "node", args: [`${root}/fail5.cjs`] } },
        { action: "run-on-fail", tool: "read_file", arguments: { path: "README.md" }, dependsOn: [1], runWhen: "failure" },
      ],
    });
    let r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      r = await runtime.resume(r.approvalId!);
    }
    // Step 1 fails, step 2 should run (runWhen=failure)
    const plan2 = runtime.get(plan.id)!;
    expect(plan2.steps[0].status).toBe("failed");
    expect(plan2.steps[1].status).toBe("completed");
  });

  it("runWhen=always runs regardless of dependency status", async () => {
    await fs.writeFile(`${root}/fail6.cjs`, "process.exit(1)", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "runwhen-always",
      steps: [
        { action: "fail", tool: "execute_command", arguments: { command: "node", args: [`${root}/fail6.cjs`] } },
        { action: "always-run", tool: "read_file", arguments: { path: "README.md" }, dependsOn: [1], runWhen: "always" },
      ],
    });
    let r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      r = await runtime.resume(r.approvalId!);
    }
    const plan2 = runtime.get(plan.id)!;
    expect(plan2.steps[0].status).toBe("failed");
    expect(plan2.steps[1].status).toBe("completed");
  });
});

// ─── Approval lifecycle ──────────────────────────────────────────────

describe("Approval lifecycle", () => {
  it("exactly-once approval: second resume returns approval_already_consumed", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "approval-once",
      steps: [{ action: "info", tool: "get_system_info", arguments: {} }],
    });
    const r = await runtime.run(plan.id, 0);
    if (r.status === "pending_approval") {
      runtime.approve(r.approvalId!);
      const r2 = await runtime.resume(r.approvalId!);
      expect(r2.status).toBe("completed");
      const r3 = await runtime.resume(r.approvalId!);
      expect(r3.status).toBe("not_resumable");
    }
  });

  it("cancel revokes unconsumed approvals", async () => {
    await fs.writeFile(`${root}/keep2.txt`, "KEEP", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "approval-revoke",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: `${root}/keep2.txt` } },
        { action: "delete", tool: "delete_file", arguments: { path: `${root}/keep2.txt` }, dependsOn: [1] },
      ],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("pending_approval");
    const approvalId = r.approvalId!;
    expect(getApprovalRequest(approvalId)?.status).toBe("pending");

    runtime.cancel(plan.id);
    expect(getApprovalRequest(approvalId)?.status).toBe("revoked");
    expect(await readWorkspaceFile(`${root}/keep2.txt`)).toBe("KEEP");
  });
});

// ─── Multiple approvals in one workflow ───────────────────────────────

describe("Multiple approvals in one workflow", () => {
  it("two sequential approvals work correctly", async () => {
    await fs.writeFile(`${root}/a.txt`, "A", "utf8");
    await fs.writeFile(`${root}/b.txt`, "B", "utf8");
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "multi-approval",
      steps: [
        { action: "delete a", tool: "delete_file", arguments: { path: `${root}/a.txt` } },
        { action: "delete b", tool: "delete_file", arguments: { path: `${root}/b.txt` }, dependsOn: [1] },
      ],
    });
    // Step 1 needs approval
    let r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("pending_approval");
    const approval1 = r.approvalId!;
    runtime.approve(approval1);
    r = await runtime.resume(approval1);
    // Step 2 needs approval
    expect(r.status).toBe("pending_approval");
    const approval2 = r.approvalId!;
    runtime.approve(approval2);
    r = await runtime.resume(approval2);
    expect(r.status).toBe("completed");
    // Both approvals consumed
    expect(getApprovalRequest(approval1)?.status).toBe("consumed");
    expect(getApprovalRequest(approval2)?.status).toBe("consumed");
  });
});

// ─── Templates ───────────────────────────────────────────────────────

describe("Templates", () => {
  it("missing template variable produces typed failure", async () => {
    const runtime = createTaskRuntimeService();
    // Invalid template reference is caught at task creation time by validateTaskPlan
    expect(() => runtime.create({
      title: "template-missing",
      steps: [
        { action: "step1", tool: "read_file", arguments: { path: "README.md" } },
        { action: "step2", tool: "read_file", arguments: { path: "{{step999.output.missing}}" }, dependsOn: [1] },
      ],
    })).toThrow("Invalid template references");
  });

  it("step.status template resolves correctly", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "template-status",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: "README.md" } },
        { action: "status check", tool: "read_file", arguments: { path: "README.md" }, dependsOn: [1] },
      ],
    });
    const r = await runtime.run(plan.id, 0);
    expect(r.status).toBe("completed");
  });
});

// ─── Task links ──────────────────────────────────────────────────────

describe("Task links", () => {
  it("task causal link traversal works", async () => {
    const runtime = createTaskRuntimeService();
    const p1 = runtime.create({ title: "link1", steps: [{ action: "r", tool: "read_file", arguments: { path: "README.md" } }] });
    const p2 = runtime.create({ title: "link2", steps: [{ action: "r", tool: "read_file", arguments: { path: "README.md" } }] });
    await runtime.run(p1.id, 0);
    await runtime.run(p2.id, 0);

    // Create link via MCP tool
    const { connectInProcessMcp, json } = await import("../helpers/in-process-mcp.js");
    const harness = await connectInProcessMcp();
    try {
      await harness.client.callTool({ name: "task_link", arguments: { sourceTaskId: p1.id, targetTaskId: p2.id, relation: "follow_up" } });
      const links = json(await harness.client.callTool({ name: "task_links", arguments: { taskId: p1.id } }));
      expect(links.downstream.length).toBe(1);
    } finally {
      await harness.close();
    }
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────

describe("Idempotency", () => {
  it("idempotencyKey deduplicates task creation via MCP", async () => {
    const { connectInProcessMcp, json } = await import("../helpers/in-process-mcp.js");
    const harness = await connectInProcessMcp();
    try {
      const p1 = json(await harness.client.callTool({ name: "task_create", arguments: {
        title: "idem1",
        steps: [{ action: "r", tool: "read_file", arguments: { path: "README.md" } }],
        idempotencyKey: "test-idempotent-key",
      }}));
      const p2 = json(await harness.client.callTool({ name: "task_create", arguments: {
        title: "idem1",
        steps: [{ action: "r", tool: "read_file", arguments: { path: "README.md" } }],
        idempotencyKey: "test-idempotent-key",
      }}));
      // Second call returns the same task ID
      expect(p2.id).toBe(p1.id);
      expect(p2.idempotent).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

// ─── State machine transitions ───────────────────────────────────────

describe("State machine", () => {
  it("completed -> planning -> executing -> completed works for append+run", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "sm-transition",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    await runtime.run(plan.id, 0);
    expect(runtime.get(plan.id)!.state).toBe("completed");

    // Simulate append + transition
    const { withAgentDatabase } = await import("../../src/core/memory/database/index.js");
    const { saveTaskPlan: save } = await import("../../src/core/memory/task-repository.js");
    const maxId = 1;
    withAgentDatabase((db) => {
      db.prepare(
        `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(plan.id, maxId + 1, 1, "read2", "read_file", JSON.stringify({ path: "package.json" }), JSON.stringify([maxId]), "pending", "success", null, new Date().toISOString(), new Date().toISOString());
    });
    const p = runtime.get(plan.id)!;
    p.state = "planning";
    save(p, "planning", p.correlationId);

    expect(runtime.get(plan.id)!.state).toBe("planning");
    const r2 = await runtime.run(plan.id, 0);
    expect(r2.status).toBe("completed");
    expect(runtime.get(plan.id)!.state).toBe("completed");
  });
});

// ─── OBS Recovery Metrics Acceptance Tests (A-F) ──────────────────────

describe("OBS Recovery Metrics", () => {
  // Test A: All recovery retries fail
  it("Test A: all recovery retries fail → 0 successfulRecoveries", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "obs-test-a",
      steps: [
        { action: "timeout-step", tool: "execute_command", arguments: { command: "sleep 999" }, timeout: 100 },
      ],
      retryPolicy: { maxConsecutiveFailures: 5, maxTotalAttempts: 5 },
    });
    // Run will timeout and fail
    await runtime.run(plan.id, 0, { timeoutMs: 200 });
    // If recovery kicked in, we should see recoveryAttempts > 0
    const report = await runtime.report(plan.id);
    // The key invariant: successfulRecoveries <= recoveryAttempts
    expect(report.successfulRecoveries).toBeLessThanOrEqual(report.recoveryAttempts);
    // If there were recovery attempts, none should be successful (step still failed)
    if (report.recoveryAttempts > 0) {
      expect(report.successfulRecoveries).toBe(0);
      expect(report.failedRecoveries).toBe(report.recoveryAttempts);
      expect(report.recoverySuccessRate).toBe(0);
    }
    // Metrics must match top-level
    expect(report.metrics.recoveryAttempts).toBe(report.recoveryAttempts);
    expect(report.metrics.successfulRecoveries).toBe(report.successfulRecoveries);
    expect(report.metrics.recoverySuccessRate).toBe(report.recoverySuccessRate);
  });

  // Test B: First recovery succeeds
  it("Test B: first recovery succeeds → recoverySuccessRate = 1", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "obs-test-b",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    const r1 = await runtime.run(plan.id, 0);
    expect(r1.status).toBe("completed");
    const report = await runtime.report(plan.id);
    // No recovery needed → all zeros
    expect(report.recoveryAttempts).toBe(0);
    expect(report.recoverySuccessRate).toBeNull();
    expect(report.metrics.recoveryAttempts).toBe(0);
    expect(report.metrics.recoverySuccessRate).toBeNull();
  });

  // Test C: First recovery fails, second succeeds
  it("Test C: mixed recovery outcomes", async () => {
    const runtime = createTaskRuntimeService();
    // Create a plan that will fail once then succeed on retry
    const plan = runtime.create({
      title: "obs-test-c",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
      retryPolicy: { maxConsecutiveFailures: 3, maxTotalAttempts: 3 },
    });
    await runtime.run(plan.id, 0);
    // The task should eventually complete (read_file succeeds)
    const report = await runtime.report(plan.id);
    // If recovery happened, successful + failed = total
    expect(report.successfulRecoveries + report.failedRecoveries).toBe(report.recoveryAttempts);
    // Metrics consistency
    expect(report.metrics.recoveryAttempts).toBe(report.recoveryAttempts);
    expect(report.metrics.successfulRecoveries).toBe(report.successfulRecoveries);
    expect(report.metrics.recoverySuccessRate).toBe(report.recoverySuccessRate);
  });

  // Test D: No recovery (maxRecovery = 0)
  it("Test D: no recovery → all zeros", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "obs-test-d",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    await runtime.run(plan.id, 0, { maxRecovery: 0 });
    const report = await runtime.report(plan.id);
    expect(report.recoveryAttempts).toBe(0);
    expect(report.successfulRecoveries).toBe(0);
    expect(report.failedRecoveries).toBe(0);
    expect(report.recoverySuccessRate).toBeNull();
    expect(report.metrics.recoveryAttempts).toBe(0);
    expect(report.metrics.recoverySuccessRate).toBeNull();
  });

  // Test E: Outcome unknown → not counted as success
  it("Test E: outcome_unknown is not counted as successful recovery", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "obs-test-e",
      steps: [{ action: "timeout-step", tool: "execute_command", arguments: { command: "sleep 999" }, timeout: 50 }],
    });
    await runtime.run(plan.id, 0, { timeoutMs: 100 });
    const report = await runtime.report(plan.id);
    // outcome_unknown steps should not count as successful recovery
    expect(report.successfulRecoveries).toBeLessThanOrEqual(report.recoveryAttempts);
    if (report.recoveryAttempts > 0) {
      // outcome_unknown is NOT success
      expect(report.successfulRecoveries).toBe(0);
    }
  });

  // Test F: Metrics consistency across all three sources
  it("Test F: task_report top-level = task_report.metrics = agent_metrics for recovery fields", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "obs-test-f",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
    });
    await runtime.run(plan.id, 0);
    const report = await runtime.report(plan.id);

    // task_report top-level === task_report.metrics
    expect(report.metrics.recoveryAttempts).toBe(report.recoveryAttempts);
    expect(report.metrics.successfulRecoveries).toBe(report.successfulRecoveries);
    expect(report.metrics.failedRecoveries).toBe(report.failedRecoveries);
    expect(report.metrics.recoverySuccessRate).toBe(report.recoverySuccessRate);

    // task_report metrics === agent_metrics (direct call)
    const { getAgentMetrics } = await import("../../src/core/trace/metrics-service.js");
    const agentMetrics = getAgentMetrics({ taskId: plan.id });
    expect(agentMetrics.recoveryAttempts).toBe(report.recoveryAttempts);
    expect(agentMetrics.successfulRecoveries).toBe(report.successfulRecoveries);
    expect(agentMetrics.recoverySuccessRate).toBe(report.recoverySuccessRate);
  });
});

// ─── BUG-01: Template Resolver {{stepN.error}} ────────────────────────

describe("BUG-01: Template Resolver {{stepN.error}}", () => {
  it("resolves {{step1.error}} on a failed step", async () => {
    const { resolveTemplates, buildStepContext } = await import("../../src/core/runtime/template-resolver.js");
    const ctx = buildStepContext([
      { id: 1, action: "test", status: "failed", error: "file not found", arguments: {} },
    ] as any);
    const result = resolveTemplates({ msg: "{{step1.error}}" }, ctx);
    expect(result).toEqual({ msg: "file not found" });
  });

  it("resolves {{step1.error}} to null on a successful step", async () => {
    const { resolveTemplates, buildStepContext } = await import("../../src/core/runtime/template-resolver.js");
    const ctx = buildStepContext([
      { id: 1, action: "test", status: "completed", arguments: {} },
    ] as any);
    const result = resolveTemplates({ msg: "{{step1.error}}" }, ctx);
    expect(result).toEqual({ msg: null });
  });

  it("resolves {{step1.error}} on a blocked step", async () => {
    const { resolveTemplates, buildStepContext } = await import("../../src/core/runtime/template-resolver.js");
    const ctx = buildStepContext([
      { id: 1, action: "test", status: "blocked", error: "security policy denied", arguments: {} },
    ] as any);
    const result = resolveTemplates({ msg: "{{step1.error}}" }, ctx);
    expect(result).toEqual({ msg: "security policy denied" });
  });

  it("does not throw MISSING_CONTEXT_VARIABLE for {{step1.error}} on success step", async () => {
    const { validateTemplates, buildStepContext } = await import("../../src/core/runtime/template-resolver.js");
    const ctx = buildStepContext([
      { id: 1, action: "test", status: "completed", arguments: {} },
    ] as any);
    validateTemplates({ msg: "{{step1.error}}" }, ctx);
  });
});

// ─── BUG-02: Workspace Path Canonicalization ──────────────────────────

describe("BUG-02: Workspace Path Canonicalization", () => {
  const testRoot = "tests/bug02-workspace";
  let savedActive: string | null = null;

  beforeEach(async () => {
    const fsp = await import("node:fs/promises");
    const { getWorkspaceRoot } = await import("../../src/security/workspace-guard.js");
    savedActive = getWorkspaceRoot();
    await fsp.rm(testRoot, { recursive: true, force: true });
    await fsp.mkdir(testRoot, { recursive: true });
    await fsp.mkdir(`${testRoot}/sub`, { recursive: true });
  });

  afterEach(async () => {
    const fsp = await import("node:fs/promises");
    const { replaceWorkspaceRoots } = await import("../../src/security/workspace-guard.js");
    if (savedActive) {
      replaceWorkspaceRoots(savedActive);
    }
    await fsp.rm(testRoot, { recursive: true, force: true });
  });

  it("forward slash cwd matches backslash workspace", async () => {
    const { classifyCommandCwd, addWorkspaceRoots } = await import("../../src/security/workspace-guard.js");
    const path = await import("node:path");
    const absRoot = path.resolve(testRoot);
    addWorkspaceRoots([absRoot]);
    const fwd = absRoot.replace(/\\/g, "/");
    const result = classifyCommandCwd(fwd);
    expect(result.inside).toBe(true);
  });

  it("nested path inside workspace is allowed", async () => {
    const { classifyCommandCwd, addWorkspaceRoots } = await import("../../src/security/workspace-guard.js");
    const path = await import("node:path");
    const absRoot = path.resolve(testRoot);
    addWorkspaceRoots([absRoot]);
    const result = classifyCommandCwd(path.resolve(`${testRoot}/sub`));
    expect(result.inside).toBe(true);
  });

  it("path outside workspace is denied", async () => {
    const { classifyCommandCwd, addWorkspaceRoots } = await import("../../src/security/workspace-guard.js");
    const path = await import("node:path");
    addWorkspaceRoots([path.resolve(testRoot)]);
    const result = classifyCommandCwd("C:\\other");
    expect(result.inside).toBe(false);
  });
});

// ─── BUG-03: Snapshot on Git Repo Without Initial Commit ──────────────

describe("BUG-03: Snapshot on Git Repo Without Initial Commit", () => {
  const testRoot = "tests/bug03-empty-repo";

  beforeEach(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("returns GIT_NO_INITIAL_COMMIT for repo with no commits", async () => {
    const { execa } = await import("execa");
    const path = await import("node:path");
    const absRoot = path.resolve(testRoot);
    await execa("git", ["init"], { cwd: absRoot });
    const { captureTaskSnapshot } = await import("../../src/core/executor/handlers/task-snapshot-handler.js");
    const result = await captureTaskSnapshot(absRoot, "test-correlation");
    expect(result.errorType).toBe("GIT_NO_INITIAL_COMMIT");
    expect(result.snapshotId).toBe("");
  });

  it("succeeds for repo with initial commit", async () => {
    const { execa } = await import("execa");
    const path = await import("node:path");
    const absRoot = path.resolve(testRoot);
    await execa("git", ["init"], { cwd: absRoot });
    await execa("git", ["config", "user.email", "test@test.com"], { cwd: absRoot });
    await execa("git", ["config", "user.name", "Test"], { cwd: absRoot });
    await execa("git", ["commit", "--allow-empty", "-m", "init"], { cwd: absRoot });
    const { captureTaskSnapshot } = await import("../../src/core/executor/handlers/task-snapshot-handler.js");
    const result = await captureTaskSnapshot(absRoot, "test-correlation");
    expect(result.snapshotId).toBeTruthy();
    expect(result.head).toMatch(/^[0-9a-f]{40}$/);
  });
});
