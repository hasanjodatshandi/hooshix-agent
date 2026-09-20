import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";
import { logCommandAction } from "../../src/memory/command-audit.js";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";

const repo = process.cwd();
let fixture: DisposableFixture | undefined;
let formerLogDirectory: string | undefined;
afterEach(() => {
  setActiveWorkspace(repo);
  if (fixture) {
    try { removeWorkspaceRoot(fixture.root); } catch { /* test setup reinitializes workspace roots */ }
    fixture.cleanup();
    fixture = undefined;
  }
  if (formerLogDirectory === undefined) delete process.env.HOOSHIX_LOG_DIR;
  else process.env.HOOSHIX_LOG_DIR = formerLogDirectory;
});

describe("R0 MED-01/02/04/08 direct boundary contracts", () => {
  it.fails("MED-02: a separated opaque --token VALUE must not leak through command audit logging", async () => {
    fixture = createDisposableFixture("auditsecret");
    formerLogDirectory = process.env.HOOSHIX_LOG_DIR;
    process.env.HOOSHIX_LOG_DIR = fixture.root;
    const secret = "r0-opaque-48215973-no-prefix";
    await logCommandAction({
      command: "git", args: ["diff", "--token", secret], cwd: fixture.root,
      status: "blocked", correlationId: "r0-audit-secret",
    });
    const log = fs.readFileSync(path.join(fixture.root, "command-actions.log"), "utf8");
    expect(log).not.toContain(secret);
    expect(log).toContain("[REDACTED]");
  });

  it("MED-04: an unapproved direct command cannot select cwd outside the active workspace", async () => {
    fixture = createDisposableFixture("cwd");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    await expect(executeShellCommand("git", ["status"], repo)).rejects.toThrow(/approval|outside workspace/i);
    expect(fs.existsSync(path.join(fixture.root, ".hooshix-r0-marker"))).toBe(true);
  });

  it("MED-08: same idempotency key but different Task payload must return a conflict, not replay old task", async () => {
    const mcp = await connectInProcessMcp();
    try {
      const key = "r0-idempotency-48215973";
      const first = await mcp.client.callTool({ name: "task_create", arguments: {
        title: "first payload", idempotencyKey: key,
        steps: [{ action: "first", tool: "read_file", arguments: { path: "README.md" } }],
      } });
      expect(first.isError).not.toBe(true);
      const firstId = (json(first) as { id: string }).id;
      expect(firstId).toBeTruthy();
      const second = await mcp.client.callTool({ name: "task_create", arguments: {
        title: "changed payload", idempotencyKey: key,
        steps: [{ action: "changed", tool: "read_file", arguments: { path: "package.json" } }],
      } });
      expect(second.isError).toBe(true);
    } finally { await mcp.close(); }
  });

  it("MED-09: completed Tasks cannot be reopened by an implicit append", async () => {
    const mcp = await connectInProcessMcp();
    try {
      const created = await mcp.client.callTool({ name: "task_create", arguments: {
        title: "terminal task R0", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
      } });
      const taskId = (json(created) as { id: string }).id;
      const finished = await mcp.client.callTool({ name: "task_run", arguments: { taskId, maxRecovery: 0 } });
      expect((json(finished) as { status: string }).status).toBe("completed");
      const appended = await mcp.client.callTool({ name: "task_append_steps", arguments: {
        taskId, steps: [{ action: "unexpected", tool: "read_file", arguments: { path: "package.json" } }],
      } });
      expect(appended.isError).toBe(true);
    } finally { await mcp.close(); }
  });
});
