import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { captureTaskSnapshot } from "../../src/core/executor/handlers/task-snapshot-handler.js";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { saveTaskPlan, getTaskPlan, findInterruptedTasks } from "../../src/core/memory/task-repository.js";
import { recoverInterruptedTasks } from "../../src/core/recovery/crash-recovery.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { restorePackage } from "../../src/services/package/package-service.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";

let fixture: DisposableFixture | undefined;
let allowedGitRoot: string | undefined;
const repo = process.cwd();
afterEach(() => {
  setActiveWorkspace(repo);
  if (allowedGitRoot) {
    try { removeWorkspaceRoot(allowedGitRoot); } finally { allowedGitRoot = undefined; }
  }
  fixture?.cleanup();
  fixture = undefined;
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Disposable Git fixture failed: " + args.join(" ") + " " + result.stderr);
  return result.stdout.trim();
}

describe("R0 execution-reality and compensation safety contracts", () => {
  it("HIGH-05: timeout awaits acknowledgement and records known completion instead of prematurely finalizing", async () => {
    // The mock intentionally ignores cancellation, modeling a child process
    // still performing a side effect after the step's timeout fires.
    let settled = false;
    let completeEffect!: () => void;
    const effectCompletion = new Promise<void>((resolve) => { completeEffect = resolve; });
    const plan = createTaskPlan("R0 timeout handshake", [{
      action: "fixture mutation", tool: "write_file",
      arguments: { path: "fixture-do-not-create", content: "only mocked" },
      timeout: 5,
    }]);
    saveTaskPlan(plan, "planning");
    try {
      const result = await runClosedAgentLoop(plan, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        settled = true;
        completeEffect();
        return { mocked: true };
      }, 0, 0, undefined, undefined, undefined, 1);
      expect(result.plan.steps[0].status).toBe("completed");
      // Completion was acknowledged during bounded termination grace.
      expect(settled).toBe(true);
    } finally { await effectCompletion; }
  }, 10000);

  it("HIGH-06: crash-after-effect fixture is not automatically replayed", async () => {
    fixture = createDisposableFixture("crash");
    const marker = path.join(fixture.root, "effect.marker");
    fs.writeFileSync(marker, "FIRST_EFFECT");
    const plan = createTaskPlan("R0 interrupted mutation", [{
      action: "previous process wrote marker before crashing",
      tool: "write_file", arguments: { path: marker, content: "DUPLICATED_EFFECT" },
    }]);
    plan.steps[0].status = "running";
    plan.steps[0].attempts = 1;
    saveTaskPlan(plan, "executing");
    const recovered = await recoverInterruptedTasks();
    expect(recovered.find((x) => x.taskId === plan.id)?.status).toBe("failed");
    expect(getTaskPlan(plan.id)?.steps[0]).toMatchObject({
      status: "outcome_unknown", errorType: "OUTCOME_UNKNOWN", attempts: 1,
    });
    expect(fs.readFileSync(marker, "utf8")).toBe("FIRST_EFFECT");
    expect((await recoverInterruptedTasks()).some((x) => x.taskId === plan.id)).toBe(false);
    expect(fs.readFileSync(marker, "utf8")).toBe("FIRST_EFFECT");
  });

  it("HIGH-07: normal hydration and crash discovery preserve identical Task retry and recovery semantics", () => {
    const plan = createTaskPlan("R0 complete hydration", [{
      action: "recover rich step", tool: "read_file", arguments: { path: "README.md" },
      runWhen: "always", timeout: 4312,
    }]);
    plan.steps[0].status = "running";
    plan.steps[0].attempts = 4;
    plan.steps[0].failedAttempts = 2;
    plan.steps[0].templateArguments = { path: "{{step1.output.path}}" };
    plan.steps[0].attemptHistory = [{ attempt: 1, status: "failed", timestamp: new Date().toISOString(), error: "previous attempt" }];
    plan.maxRecovery = 2;
    plan.retryPolicy = { maxTotalAttempts: 7, maxConsecutiveFailures: 3 };
    plan.totalRunCount = 5;
    saveTaskPlan(plan, "executing");
    const normal = getTaskPlan(plan.id);
    const discovered = findInterruptedTasks().find((x) => x.id === plan.id);
    expect(discovered).toBeDefined();
    expect(discovered?.steps).toEqual(normal?.steps);
    expect(discovered?.maxRecovery).toEqual(normal?.maxRecovery);
    expect(discovered?.retryPolicy).toEqual(normal?.retryPolicy);
    expect(discovered?.totalRunCount).toEqual(normal?.totalRunCount);
  });

  it("HIGH-08: dirty disposable Git repositories must be rejected before creating a rollback snapshot", async () => {
    fixture = createDisposableFixture("dirtygit");
    const cwd = fixture.initializeGit();
    allowedGitRoot = cwd;
    addWorkspaceRoots([cwd]);
    setActiveWorkspace(cwd);
    fs.writeFileSync(path.join(cwd, "tracked.txt"), "original");
    git(cwd, "add", "tracked.txt");
    git(cwd, "commit", "--quiet", "-m", "fixture initial commit");
    fs.writeFileSync(path.join(cwd, "untracked-user-work.txt"), "MUST_NOT_BE_REMOVED");
    const snapshot = await captureTaskSnapshot(cwd, "r0-dirty-git");
    // Current implementation records a snapshot with clean=false instead
    // of refusing to create it; a later rollback could remove user changes.
    expect(snapshot.snapshotId).toBe("");
    expect(fs.readFileSync(path.join(cwd, "untracked-user-work.txt"), "utf8")).toBe("MUST_NOT_BE_REMOVED");
  }, 15000);

  it("HIGH-09: package restore must never claim environment restoration after only restoring manifests", async () => {
    fixture = createDisposableFixture("packagerestore");
    allowedGitRoot = fixture.root;
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const sentinel = path.join(fixture.root, "installed-state.marker");
    fs.writeFileSync(sentinel, "installed-state-unchanged");
    const snapshotId = randomUUID();
    const now = new Date().toISOString();
    withAgentDatabase((db) => db.prepare(
      "INSERT INTO package_snapshots(id,correlation_id,manager,action,package_name,cwd,snapshot,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(snapshotId, "r0-package", "npm", "install", "fixture-only", fixture!.root,
      JSON.stringify({ files: [] }), "committed", now));
    const result = await runWithPolicyApproval("package_restore", () => restorePackage(snapshotId, "r0-package"));
    expect(fs.readFileSync(sentinel, "utf8")).toBe("installed-state-unchanged");
    // A truthful R4 response must distinguish manifest-only from installed
    // package state, not report an unqualified restored:true.
    expect(result).toMatchObject({ restored: false, manifestOnly: true });
  });
});