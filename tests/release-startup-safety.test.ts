import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
// core.autocrlf gives this same file CRLF on Windows and LF in CI; the gates
// below quote multi-line source, so the endings are normalized once on read.
const read = (relative: string) => fs.readFileSync(path.join(repo, relative), "utf8").replaceAll("\r\n", "\n");

/** The launcher stack that the SCM service replaced. */
const retired = [
  "scripts/hooshix_nodejs_mcp_watchdog.ps1",
  "scripts/install_nodejs_mcp_task.ps1",
  "scripts/install_nodejs_mcp_task.bat",
  "scripts/start_nodejs_mcp.bat",
  "scripts/SETUP_NODEJS_MCP_V2.md",
];

/**
 * Surfaces an operator or a pipeline would actually follow. `docs/implementation`
 * and the dated audit reports are deliberately absent: they are the record of
 * what was true, and rewriting them would destroy the evidence.
 */
const active = [
  "package.json",
  "Dockerfile",
  "docker-compose.yml",
  "docs/OPERATIONS.md",
  "docs/RELEASE.md",
  "docs/implementation/R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md",
  ".github/workflows/ci.yml",
];

describe("release startup safety", () => {
  it("keeps the retired watchdog and logon-task launcher out of the tree", () => {
    // A logon-triggered task plus a PowerShell respawn loop is why every code
    // change needed a manual restart and why a reboot left the connector dark.
    // Bringing either back would put two supervisors in charge of port 3001, so
    // their absence is the guarantee, not a cleanup detail.
    for (const file of retired) {
      expect(fs.existsSync(path.join(repo, file)), `${file} was retired with the watchdog`).toBe(false);
    }
  });

  it("leaves no live instruction pointing at the deleted launcher", () => {
    for (const file of active) {
      const lower = read(file).toLowerCase();
      for (const forbidden of ["hooshix_nodejs_mcp_watchdog", "install_nodejs_mcp_task", "start_nodejs_mcp", "set_nodejs_mcp_v2", "hooshix node.js mcp v2"]) {
        expect(lower, `${file} still points at ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("holds the launcher's two safety rules inside the service instead", () => {
    // The old scripts were gated on exactly two properties, and deleting them
    // must not delete the properties.
    //
    // 1. Never terminate a process the supervisor did not start. The host only
    //    ever kills the child it spawned, and a killed host cannot leave an
    //    orphan holding the port because the job object closes with it.
    const host = read("deploy/windows/internal/host/host.go");
    expect(host).toContain("s.job.assign(");
    expect(read("deploy/windows/internal/host/job_windows.go")).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    // 2. Refuse to start over a listener of unknown ownership instead of
    //    competing with it — the same "exit /b 1" the .bat answered with.
    expect(host).toContain("refuses to start over it");
    expect(read("deploy/windows/internal/setup/layout.go")).toContain("a process the installer did not start is listening; stop it first");
    for (const file of ["deploy/windows/internal/host/host.go", "deploy/windows/internal/setup/layout.go", "deploy/windows/cmd/hooshix-mcp-setup/main.go"]) {
      const lower = read(file).toLowerCase();
      for (const forbidden of ["taskkill", "stop-process", "terminateprocess(", "schtasks", "onlogon", "taskschd"]) {
        expect(lower, `${file} uses ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
