import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { saveTaskPlan, findInterruptedTasks, markTaskRecovered } from "../../src/core/memory/task-repository.js";
import { recoverInterruptedTasks } from "../../src/core/recovery/crash-recovery.js";
import { classifyError, isTransientError, TimeoutError, AgentError } from "../../src/core/errors.js";

const root = path.resolve("tests/recovery-coverage");

describe("error taxonomy", () => {
  it("classifies typed errors by code", () => {
    expect(classifyError(new TimeoutError(5000))).toBe("TIMEOUT");
    expect(classifyError(new AgentError("NETWORK", "fetch failed"))).toBe("NETWORK");
  });

  it("classifies raw message strings (legacy path)", () => {
    expect(classifyError("Command execution timed out")).toBe("TIMEOUT");
    expect(classifyError("Step timed out after 30000ms")).toBe("TIMEOUT");
    expect(classifyError("network connection refused")).toBe("NETWORK");
    expect(classifyError("Access denied: path outside workspace")).toBe("SECURITY_POLICY");
    expect(classifyError("Approval required: delete_file")).toBe("APPROVAL_REQUIRED");
    expect(classifyError("ENOENT: no such file")).toBe("FILE_NOT_FOUND");
    expect(classifyError("Unknown tool: foo")).toBe("UNKNOWN_TOOL");
    expect(classifyError("Invalid package name")).toBe("INVALID_ARGUMENT");
    expect(classifyError("something unexpected")).toBe("EXECUTION");
  });

  it("marks timeout and network as transient", () => {
    expect(isTransientError(new TimeoutError(1))).toBe(true);
    expect(isTransientError("network down")).toBe(true);
    expect(isTransientError(new Error("ENOENT"))).toBe(false);
    expect(isTransientError(new Error("whatever"))).toBe(false);
  });
});

describe("crash recovery", () => {
  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("finds interrupted tasks in verifying state and resumes or completes them", async () => {
    await fs.mkdir(root, { recursive: true });
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "interrupted",
      steps: [
        { action: "read", tool: "read_file", arguments: { path: "README.md" } },
        { action: "read 2", tool: "read_file", arguments: { path: "package.json" } }
      ]
    });
    // Simulate: step 1 completed, then crash while in "executing"
    plan.steps[0].status = "completed";
    plan.state = "executing";
    saveTaskPlan(plan, "executing");

    const interrupted = findInterruptedTasks();
    expect(interrupted.length).toBe(1);
    expect(interrupted[0].state).toBe("executing");
    expect(interrupted[0].executionContext?.workspace).toBeTruthy();

    const results = await recoverInterruptedTasks();
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("recovered");
    const after = runtime.get(plan.id);
    expect(after?.state).toBe("completed");
  });

  it("hydrates every persisted step semantic field during crash recovery discovery", async () => {
    await fs.mkdir(root, { recursive: true });
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "semantic hydration",
      steps: [
        { action: "source", tool: "read_file", arguments: { path: "README.md" } },
        {
          action: "read conditional",
          tool: "read_file",
          arguments: { path: "{{step1.output.path}}" },
          dependsOn: [1],
          runWhen: "always",
          timeout: 4321,
        },
      ]
    });
    plan.steps[0].status = "completed";
    plan.steps[0].output = { path: "README.md" };
    plan.steps[1].status = "running";
    plan.steps[1].attempts = 3;
    plan.steps[1].failedAttempts = 2;
    plan.steps[1].attemptHistory = [{ attempt: 1, status: "failed", error: "x", timestamp: new Date().toISOString() }];
    plan.steps[1].templateArguments = { path: "{{step1.output.path}}" };
    plan.state = "executing";
    saveTaskPlan(plan, "executing");

    const recovered = findInterruptedTasks().find((task) => task.id === plan.id);
    expect(recovered).toBeTruthy();
    expect(recovered?.steps[1]).toMatchObject({
      runWhen: "always",
      timeout: 4321,
      attempts: 3,
      failedAttempts: 2,
      templateArguments: { path: "{{step1.output.path}}" },
    });
    expect(recovered?.steps[1].attemptHistory).toHaveLength(1);
  });

  it("marks all-completed interrupted tasks as completed", async () => {
    await fs.mkdir(root, { recursive: true });
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "done but stuck",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }]
    });
    plan.steps[0].status = "completed";
    plan.state = "verifying"; // crashed between verifying and completed save
    saveTaskPlan(plan, "verifying");

    const results = await recoverInterruptedTasks();
    expect(results[0].status).toBe("recovered");
    expect(results[0].reason).toContain("completed");
    expect(runtime.get(plan.id)?.state).toBe("completed");
  });

  it("skips tasks whose next step awaits approval", async () => {
    await fs.mkdir(root, { recursive: true });
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "awaiting approval",
      steps: [{ action: "delete", tool: "delete_file", arguments: { path: "tests/recovery-coverage/x.txt" } }]
    });
    plan.steps[0].status = "pending_approval";
    // interrupted mid-resume (executing is an interrupted state)
    plan.state = "executing";
    saveTaskPlan(plan, "executing");

    const results = await recoverInterruptedTasks();
    const entry = results.find((r) => r.taskId === plan.id);
    expect(entry?.status).toBe("skipped");
    expect(entry?.reason).toContain("approval");
  });

  it("markTaskRecovered flips state to executing", async () => {
    await fs.mkdir(root, { recursive: true });
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "resume flip",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }]
    });
    plan.state = "executing";
    saveTaskPlan(plan, "executing");
    markTaskRecovered(plan.id);
    expect(runtime.get(plan.id)?.state).toBe("executing");
  });
});
