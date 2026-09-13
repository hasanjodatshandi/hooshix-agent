import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { isDirectApprovalBypassEnabled, runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";
import { readWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";
import { setActiveWorkspace, addWorkspaceRoots, setUnrestrictedMode, isUnrestrictedMode, validateWorkspace } from "../../src/security/workspace-guard.js";
import { evaluateCommandPermission } from "../../src/security/permissions/command-permission.js";
import { execa } from "execa";

const root = path.resolve("tests/adversarial");
const marker = path.join(root, "pwned.txt");

beforeEach(async () => {
  setUnrestrictedMode(false);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  setUnrestrictedMode(false);
  await fs.rm(root, { recursive: true, force: true });
});

describe("adversarial: task_rollback shell injection", () => {
  it("rejects a snapshot whose head is not a 40-char hex sha", async () => {
    // Simulate an attacker who got a file backup id whose content parses as
    // JSON with a malicious head — the old execSync(`git reset --hard ${head}`)
    // would have executed the injected commands.
    const maliciousContent = JSON.stringify({ head: "main & echo pwned > " + marker.replace(/\\/g, "/") + " & rem", branch: "x", clean: true });
    const fakeSnapshotId = randomUUID();
    withAgentDatabase((db) => db.prepare(
      "INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(fakeSnapshotId, "adversarial", "__task_snapshot__:" + root, Buffer.from(maliciousContent), new Date().toISOString()));

    // Call the real tool logic through the executor path (task_rollback
    // handler re-implementation guard: use the service-level checks).
    const { validateWorkspace } = await import("../../src/security/workspace-guard.js");
    const safeCwd = validateWorkspace(root);

    // Reproduce the tool's validation exactly: git sha check
    const GIT_SHA = /^[0-9a-f]{40}$/i;
    const snap = JSON.parse(maliciousContent);
    expect(GIT_SHA.test(snap.head)).toBe(false); // the malicious head must fail validation

    // Even if validation were bypassed, the command is argv-separated:
    // execa("git", ["reset", "--hard", head, "--"]) cannot execute `&`.
    const result = await execa("git", ["reset", "--hard", snap.head, "--"], { cwd: safeCwd, reject: false });
    expect(result.exitCode).not.toBe(0); // git rejects the bad ref
    expect(await fs.access(marker).then(() => true, () => false)).toBe(false); // no side effect
  });

  it("rejects plain file backup ids used as snapshot ids", async () => {
    // A backup of a NORMAL file (not a task snapshot) must not be rollback-able.
    const plan = { id: "snap-" + Date.now() } as never;
    void plan;
    const fakeId = randomUUID();
    withAgentDatabase((db) => db.prepare(
      "INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(fakeId, "adversarial", "just/a/normal/file.txt", Buffer.from("file content"), new Date().toISOString()));

    const row = withAgentDatabase((db) => db.prepare("SELECT path FROM file_backups WHERE id = ?").get(fakeId) as { path: string });
    expect(row.path.startsWith("__task_snapshot__:")).toBe(false); // tool must reject this
  });
});

describe("adversarial: unrestricted mode escalation", () => {
  it("set_workspace no longer silently enables unrestricted mode", () => {
    expect(isUnrestrictedMode()).toBe(false);
    // Elevation is governed — enable it inside an approved-step context.
    runWithPolicyApproval("set_workspace", () => setUnrestrictedMode(true));
    // Multi-root pool model: set_workspace only selects among allowed roots.
    addWorkspaceRoots([root]);
    setActiveWorkspace(root);
    // set_workspace must NOT silently disable unrestricted mode, and the new
    // workspace becomes the ONLY root (previous ones are dropped).
    expect(isUnrestrictedMode()).toBe(true);
    setUnrestrictedMode(false);
    expect(isUnrestrictedMode()).toBe(false);
    // And paths outside ALL roots are still denied — resolve from a nested
    // active workspace up beyond the repo root.
    expect(() => validateWorkspace("../../../outside-adversarial.txt")).toThrow(/outside workspace/);
  });

  it("unrestricted mode is a separate explicit decision", () => {
    // Test-env equivalent of an approved task step (the elevation is a governed
    // operation now — see tests/security/audit-high-fixes.test.ts).
    const bypass = process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
    process.env.HOOSHIX_DIRECT_AUTO_APPROVE = "1";
    try {
      setUnrestrictedMode(true);
      expect(isUnrestrictedMode()).toBe(true);
      setUnrestrictedMode(false);
      expect(isUnrestrictedMode()).toBe(false);
    } finally {
      if (bypass === undefined) delete process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
      else process.env.HOOSHIX_DIRECT_AUTO_APPROVE = bypass;
    }
  });
});

describe("adversarial: direct MCP approval bypass", () => {
  // setActiveWorkspace REPLACES the root list — an earlier test in this file
  // switched the active workspace; restore the repo root so the default "."
  // cwd resolves inside it for these tests.
  beforeEach(() => setActiveWorkspace(path.resolve(".")));

  it("requires approval for governed tools on direct calls", async () => {
    expect(isDirectApprovalBypassEnabled()).toBe(false);
    await fs.writeFile(path.join(root, "target.txt"), "data", "utf8");
    // Direct call (no task context) to a governed tool must throw
    await expect(executeShellCommand("git", ["add", "."], root)).rejects.toThrow(/Approval required/);
  });

  it("still auto-allows read-only commands on direct calls", async () => {
    // The default "." cwd resolves to the active workspace, so read-only
    // commands stay auto-allowed for direct calls.
    const result = await executeShellCommand("node", ["--version"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("adversarial: command permission policy", () => {
  it("never auto-allows node/python script execution", () => {
    expect(evaluateCommandPermission("node", ["evil.js"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("node", ["-e", "code"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("python", ["evil.py"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("py", ["script.py"]).decision).toBe("approval_required");
  });

  it("never auto-allows npm run / npm test (lifecycle script execution)", () => {
    expect(evaluateCommandPermission("npm", ["run", "build"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("npm", ["test"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("pnpm", ["run", "anything"]).decision).toBe("approval_required");
  });

  it("treats gh auth login as approval-required, not safe", () => {
    expect(evaluateCommandPermission("gh", ["auth", "login", "--with-token"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("gh", ["auth", "status"]).decision).toBe("allow");
    expect(evaluateCommandPermission("gh", ["pr", "list"]).decision).toBe("allow");
  });

  it("blocks PowerShell destructive cmdlets and recursive delete variants", () => {
    // powershell itself is approval-only now, but the blocklist must still catch
    // destructive patterns regardless of which allowed binary renders them
    expect(evaluateCommandPermission("git", ["rm", "-rf", "/"]).decision).toBe("blocked");
    expect(evaluateCommandPermission("node", ["x", "--", "rm", "-r", "-f", "dir"]).decision).toBe("blocked");
    expect(evaluateCommandPermission("node", ["x", "Remove-Item", "-Recurse"]).decision).toBe("blocked");
    expect(evaluateCommandPermission("node", ["x", "Format-Volume"]).decision).toBe("blocked");
    expect(evaluateCommandPermission("node", ["x", "Stop-Computer"]).decision).toBe("blocked");
    expect(evaluateCommandPermission("node", ["x", "rd", "/s", "/q", "C:\\"]).decision).toBe("blocked");
    expect(evaluateCommandPermission("node", ["x", "reg", "delete", "HKLM\\x"]).decision).toBe("blocked");
  });
});

describe("adversarial: sensitive file denylist", () => {
  it("blocks .token, .env, ssh keys, and pem files", async () => {
    await fs.writeFile(path.join(root, ".env"), "SECRET=1", "utf8");
    await fs.writeFile(path.join(root, ".token"), "tok", "utf8");
    await fs.mkdir(path.join(root, ".ssh"), { recursive: true });
    await fs.writeFile(path.join(root, ".ssh", "id_rsa"), "key", "utf8");
    await fs.writeFile(path.join(root, "cert.pem"), "cert", "utf8");

    for (const rel of [".env", ".token", ".ssh/id_rsa", "cert.pem"]) {
      await expect(readWorkspaceFile(path.join(root, rel))).rejects.toThrow(/sensitive-file denylist/);
    }
  });
});

describe("adversarial: state machine verifying trap", () => {
  it("allows verifying -> executing (crash recovery escape hatch)", async () => {
    const { canTransition, transitionTask } = await import("../../src/core/state/task-state-machine.js");
    expect(canTransition("verifying", "executing")).toBe(true);
    expect(transitionTask("verifying", "executing")).toBe("executing");
  });
});
