import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchToHandler } from "../../src/core/executor/legacy-tool-handler-composition.js";
import { executeUnrestrictedCommand } from "../../src/services/shell/exec-service.js";
import { isExecEnabled } from "../../src/infrastructure/config/exec-enabled-config.js";

const isWindows = process.platform === "win32";
const priorPermission = process.env.HOOSHIX_PERMISSION_LEVEL;
const priorExecEnabled = process.env.HOOSHIX_EXEC_ENABLED;
const priorLogDir = process.env.HOOSHIX_LOG_DIR;

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-audit-"));

/**
 * The `exec` tool is deliberately unrestricted: no command allowlist, no
 * dangerous-pattern blocking, no workspace cwd scope — it runs a full shell
 * line anywhere on the filesystem. The ONLY boundary is an access gate, so the
 * gate is what has to hold: ADMIN_MODE permission AND the explicit operator
 * opt-in flag, which is off by default. Everything the command does is still
 * written to the command audit log, denied attempts included.
 */
describe("exec: unrestricted shell behind a two-part access gate", () => {
  beforeAll(() => {
    process.env.HOOSHIX_LOG_DIR = logDir;
  });
  afterAll(() => {
    if (priorPermission === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
    else process.env.HOOSHIX_PERMISSION_LEVEL = priorPermission;
    if (priorExecEnabled === undefined) delete process.env.HOOSHIX_EXEC_ENABLED;
    else process.env.HOOSHIX_EXEC_ENABLED = priorExecEnabled;
    if (priorLogDir === undefined) delete process.env.HOOSHIX_LOG_DIR;
    else process.env.HOOSHIX_LOG_DIR = priorLogDir;
  });

  function enable() {
    process.env.HOOSHIX_PERMISSION_LEVEL = "ADMIN_MODE";
    process.env.HOOSHIX_EXEC_ENABLED = "1";
  }

  it("is disabled by default even for an ADMIN caller", async () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "ADMIN_MODE";
    delete process.env.HOOSHIX_EXEC_ENABLED;
    expect(isExecEnabled()).toBe(false);
    await expect(executeUnrestrictedCommand("node --version"))
      .rejects.toThrow(/exec is disabled/);
  });

  it("requires ADMIN_MODE even when the flag is on", async () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "DEVELOPER_MODE";
    process.env.HOOSHIX_EXEC_ENABLED = "1";
    await expect(executeUnrestrictedCommand("node --version"))
      .rejects.toThrow(/requires ADMIN_MODE/);
  });

  it("runs a full shell line with pipes once the gate opens", async () => {
    enable();
    const command = isWindows
      ? "echo exec-pipe-marker | findstr exec-pipe-marker"
      : "echo exec-pipe-marker | grep exec-pipe-marker";
    const result = await executeUnrestrictedCommand(command);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stdout).toContain("exec-pipe-marker");
  });

  it("runs commands the execute_command allowlist refuses", async () => {
    // `whoami` is not on the node/npm/pnpm/git/python/gh allowlist, so
    // execute_command would deny it. exec runs it unrestricted.
    enable();
    const result = await executeUnrestrictedCommand(
      isWindows ? "whoami" : "whoami",
      { shell: isWindows ? "cmd" : "sh" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it("accepts a cwd outside every workspace", async () => {
    enable();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "exec-outside-"));
    try {
      const result = await executeUnrestrictedCommand(
        isWindows ? "echo cwd-ok > out.txt && type out.txt" : "echo cwd-ok > out.txt && cat out.txt",
        { cwd: outside },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cwd-ok");
      expect(fs.existsSync(path.join(outside, "out.txt"))).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reports the real exit code and output of a failing command", async () => {
    enable();
    const result = await executeUnrestrictedCommand(
      "node -e \"console.error('exec-err-marker'); process.exit(7)\"",
    );
    expect(result).toMatchObject({ exitCode: 7 });
    expect(result.stderr).toContain("exec-err-marker");
  });

  it("audits every attempt, including denied ones", async () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "ADMIN_MODE";
    delete process.env.HOOSHIX_EXEC_ENABLED;
    await expect(executeUnrestrictedCommand("echo audited-denied", {}, "exec-audit-trace"))
      .rejects.toThrow(/exec is disabled/);
    enable();
    await executeUnrestrictedCommand("echo audited-success", {}, "exec-audit-trace");

    const logFile = path.join(logDir, "command-actions.log");
    const lines = fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
    const denied = lines.find((line) => String(line.command).includes("audited-denied") && line.status === "blocked");
    const allowed = lines.find((line) => String(line.command).includes("audited-success") && line.status === "success");
    expect(denied, "a denied exec attempt must be audited").toBeDefined();
    expect(allowed, "a successful exec attempt must be audited").toBeDefined();
    expect(allowed!.correlationId).toBe("exec-audit-trace");
    expect(denied!.correlationId).toBe("exec-audit-trace");
  });

  it("dispatches through the shell handler like the task executor does", async () => {
    enable();
    const result = await dispatchToHandler("exec", { command: "node --version" }, "exec-dispatch-correlation");
    expect(result).toMatchObject({ exitCode: 0 });
    expect(String(result.stdout)).toContain("v");
  });
});
