import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();

describe("release startup script safety", () => {
  it("start script refuses to terminate an unknown listener", () => {
    const text = fs.readFileSync(path.join(repo, "scripts/start_nodejs_mcp.bat"), "utf8");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("taskkill /f /pid");
    expect(text).toContain("Existing listener ownership is unknown");
    expect(text).toContain("will NOT terminate it");
    expect(lower).toContain("exit /b 1");
  });

  it("watchdog only terminates the Process object it owns and fails closed for unowned servers", () => {
    const text = fs.readFileSync(path.join(repo, "scripts/hooshix_nodejs_mcp_watchdog.ps1"), "utf8");
    const lower = text.toLowerCase();
    expect(text).toContain("$script:OwnedNodeProcess");
    expect(text).toContain("Stop-Process -InputObject $owned");
    expect(lower).not.toContain("stop-process -id $_.processid");
    expect(text).toContain("unowned_node_unhealthy");
    expect(text).toContain("node_health_critical_unowned");
    expect(text).toContain("Refusing to kill or replace it");
    expect(text).toContain("$psi.RedirectStandardError = $false");
    expect(text).not.toContain("$psi.RedirectStandardError = $true");
  });
});
