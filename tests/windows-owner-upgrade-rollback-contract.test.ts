import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(relative), "utf8");

describe("Windows owner-preserving installer upgrade / rollback", () => {
  it("upgrades existing service without uninstalling or recreating SCM identity", () => {
    const setup = read("deploy/windows/cmd/hooshix-mcp-setup/main.go");
    const begin = setup.indexOf("func runInstall(");
    const end = setup.indexOf("func runUninstall(", begin);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const install = setup.slice(begin, end);
    expect(install).toContain("svc.PrepareForUpgrade(layout.ServiceBinary())");
    expect(install).not.toContain("svc.Uninstall()");
    expect(install).toContain("if !existingService {");
    expect(install.indexOf("svc.PrepareForUpgrade")).toBeLessThan(install.indexOf("setup.ExtractArchive"));
    const service = read("deploy/windows/internal/svc/svc.go");
    const start = service.indexOf("func PrepareForUpgrade(");
    const finish = service.indexOf("// Uninstall stops", start);
    expect(start).toBeGreaterThan(-1);
    const upgraded = service.slice(start, finish);
    expect(upgraded).not.toContain(".Delete()");
    expect(upgraded).not.toContain("CreateService(");
    expect(upgraded).toContain("matchesExpectedServiceImage");
  });

  it("checks account before touching recovery state and restores without re-registering", () => {
    const snapshot = read("scripts/windows-preupgrade-backup.ps1");
    const recovery = read("scripts/windows-restore-preupgrade.ps1");
    expect(snapshot).toContain("serviceAccount = $serviceAccount");
    expect(snapshot.indexOf("$serviceAccount =")).toBeLessThan(snapshot.indexOf("Stop-Service"));
    expect(recovery).toContain("$manifest.serviceAccount");
    expect(recovery).toContain("$currentAccount");
    expect(recovery).not.toContain("service install");
    expect(recovery).toContain("Start-Service -Name HooshiXMCP");
    expect(recovery).toContain("Copy-Tree $sourceInstall $install $true");
    expect(recovery).toContain("Copy-Tree $sourceData $data $true");
    expect(recovery.indexOf("$currentAccount")).toBeLessThan(recovery.indexOf("Copy-Tree $sourceInstall"));
  });
});
