import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";
import { dispatchToHandler } from "../../src/core/executor/legacy-tool-handler-composition.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";
import { runWithWorkspaceScope } from "../../src/security/workspace-guard.js";

const repo = process.cwd();

/** Dispatch execute_command exactly the way the Task executor does. */
function executeCommand(args: Record<string, unknown>) {
  return runWithWorkspaceScope(repo, () =>
    runWithPolicyApproval("execute_command", () =>
      dispatchToHandler("execute_command", args, "repro-correlation", { workspace: repo, roots: [repo], unrestricted: false }, undefined)));
}

async function processIsDead(pid: number, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function waitForFile(file: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await fs.readFile(file, "utf8"); } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${file}`);
}

/**
 * Regression: execute_command reported a legitimate non-zero process exit as an
 * opaque `tool_handler_failure` (or a misleading `invalid_argument` when the
 * stderr happened to contain the word "argument"), discarding stdout/stderr and
 * the real exit code. A validation command that exits 1 is a successful tool
 * invocation reporting a failed process — the caller must see its output.
 */
describe("execute_command: failing commands report real output", () => {
  it("returns exitCode/stdout/stderr for a process that exits non-zero", async () => {
    const result = await executeCommand({
      command: "node",
      args: ["tests/fixtures/fail-with-output.cjs"],
    });
    expect(result).toMatchObject({
      exitCode: 7,
      stdout: expect.stringContaining("fail-stdout-marker"),
      stderr: expect.stringContaining("fail-stderr-marker"),
    });
  });

  it("flags truncated output rather than killing the build silently", async () => {
    // ~4MB in bulk writes: fast even under parallel load, comfortably under the
    // 16MB cap, so this must NOT truncate.
    const result = await executeCommand({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(2000000)); process.stdout.write('y'.repeat(2000000))"],
    }) as { exitCode: number; outputTruncated: boolean };
    expect(result.exitCode).toBe(0);
    expect(result.outputTruncated).toBe(false);
  });

  it("a Task step fails on non-zero exit but keeps the real output", async () => {
    const harness = await connectInProcessMcp();
    try {
      const created = json(await harness.client.callTool({ name: "task_create", arguments: { title: "failing-validation", steps: [
        { action: "run failing validation", tool: "execute_command",
          arguments: { command: "node", args: ["tests/fixtures/fail-with-output.cjs"] } },
      ] } }));
      let run = json(await harness.client.callTool({ name: "task_run", arguments: { taskId: created.id, maxRecovery: 0 } }));
      for (let i = 0; i < 3 && run.status === "pending_approval"; i++) {
        await harness.client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
        run = json(await harness.client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
      }
      expect(run.status).toBe("failed");
      const plan = json(await harness.client.callTool({ name: "task_get", arguments: { taskId: created.id } }));
      const step = plan.steps[0];
      expect(step.status).toBe("failed");
      expect(step.errorType).toBe("COMMAND_FAILED");
      expect(String(step.error)).not.toContain("tool_handler_failure");
      // The real process outcome survives on the step.
      expect(step.output).toMatchObject({
        exitCode: 7,
        stdout: expect.stringContaining("fail-stdout-marker"),
        stderr: expect.stringContaining("fail-stderr-marker"),
      });
    } finally {
      await harness.close();
    }
  });

  it("a Task step fails on non-zero exit even when the output exceeds the persist limit", async () => {
    // boundedResult wraps >128KB output in {truncated, preview}; the exit code
    // must still be read from the real result, not the wrapped copy.
    const harness = await connectInProcessMcp();
    try {
      const created = json(await harness.client.callTool({ name: "task_create", arguments: { title: "failing-verbose", steps: [
        { action: "run verbose failing command", tool: "execute_command",
          arguments: { command: "node", args: ["-e", "process.stdout.write('x'.repeat(200000)); process.exit(3)"] } },
      ] } }));
      let run = json(await harness.client.callTool({ name: "task_run", arguments: { taskId: created.id, maxRecovery: 0 } }));
      for (let i = 0; i < 3 && run.status === "pending_approval"; i++) {
        await harness.client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
        run = json(await harness.client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
      }
      expect(run.status).toBe("failed");
      const plan = json(await harness.client.callTool({ name: "task_get", arguments: { taskId: created.id } }));
      expect(plan.steps[0].status).toBe("failed");
      expect(plan.steps[0].errorType).toBe("COMMAND_FAILED");
      expect(String(plan.steps[0].error)).toContain("exited with code 3");
    } finally {
      await harness.close();
    }
  });

  it("cancelling a step reaps the whole process tree (no stranded descendants)", async () => {    const pidFile = path.join(repo, "tests", "fixtures", "grandchild.pid");
    await fs.rm(pidFile, { force: true });
    const harness = await connectInProcessMcp();
    try {
      const created = json(await harness.client.callTool({ name: "task_create", arguments: { title: "tree-kill", steps: [
        // Short step deadline: the loop aborts the step, which must kill the
        // child AND its grandchild (a Node -> Java/Gradle style chain).
        { action: "hang with grandchild", tool: "execute_command",
          arguments: { command: "node", args: ["tests/fixtures/spawn-grandchild.cjs", pidFile] },
          timeout: 1500 },
      ] } }));
      let run = json(await harness.client.callTool({ name: "task_run", arguments: { taskId: created.id, maxRecovery: 0 } }));
      for (let i = 0; i < 3 && run.status === "pending_approval"; i++) {
        await harness.client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
        run = json(await harness.client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
      }
      expect(run.status).toBe("failed");
      // The grandchild must have had time to record its pid before the abort.
      const grandchildPid = Number(await waitForFile(pidFile, 8000));
      expect(Number.isFinite(grandchildPid)).toBe(true);
      // ...and must have been terminated with the tree, not stranded.
      expect(await processIsDead(grandchildPid)).toBe(true);
    } finally {
      await harness.close();
      await fs.rm(pidFile, { force: true });
    }
  }, 60000);
});
