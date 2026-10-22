import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const scripts = [
  "enroll-wsl-files.ps1",
  "enroll-wsl-file-writes.ps1",
  "enroll-wsl-git-writes.ps1",
  "preflight-wsl-enrollment.ps1",
] as const;

describe("WSL enrollment is explicit and release payload is complete", () => {
  it("packages all three owner-session enrollment scripts and read-only preflight", () => {
    const builder = fs.readFileSync(path.join(root, "scripts/build-windows-installer.mjs"), "utf8");
    const staged = fs.readFileSync(path.join(root, "deploy/windows/internal/setup/staging_installer_test.go"), "utf8");
    for (const script of scripts) {
      expect(builder, script).toContain('"' + script + '"');
      expect(staged, script).toContain('tools/' + script);
      expect(fs.existsSync(path.join(root, "scripts", script))).toBe(true);
    }
    expect(builder).toContain('"hooshix-wsl-fs-broker-linux-amd64"');
  });

  it("permits only the official HTTPS registry during frozen production staging", () => {
    const builder = fs.readFileSync(path.join(root, "scripts/build-windows-installer.mjs"), "utf8");
    expect(builder).toContain('"--frozen-lockfile"');
    expect(builder).toContain('"https://registry.npmjs.org/"');
    expect(builder).toContain('`--registry=${options.registry}`');
    const denied = spawnSync(process.execPath, [
      "scripts/build-windows-installer.mjs", "--registry", "http://registry.npmjs.org/"
    ], { cwd: root, encoding: "utf8", timeout: 10000 });
    expect(denied.status).toBe(1);
    expect(denied.stderr).toContain("only the official npm registry over HTTPS");
  });

  it("does not assign to the read-only built-in PowerShell HOME variable", () => {
    for (const script of scripts) {
      const content = fs.readFileSync(path.join(root, "scripts", script), "utf8");
      expect(content, script).not.toMatch(/\$home\s*=/i);
      expect(content, script).toMatch(/\$wslHome\s*=/i);
    }
  });

  it("keeps read, file-write, and Git-write enrollment separate", () => {
    const modes = [
      "wslfs-enroll",
      "wslfs-write-enroll",
      "wslgit-write-enroll",
    ];
    for (let i = 0; i < 3; i++) {
      const content = fs.readFileSync(path.join(root, "scripts", scripts[i]), "utf8");
      expect(content).toContain("-mode " + modes[i]);
      expect(content).toContain("-mode " + modes[i].replace("-enroll", "-unenroll"));
      expect(content).toMatch(/IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
    }
  });

  it("runs a read-only preflight, not an implicit install or enrollment", () => {
    const content = fs.readFileSync(path.join(root, "scripts/preflight-wsl-enrollment.ps1"), "utf8");
    expect(content).toContain("ownerEnrollmentPerformed=$false");
    expect(content).toContain("installedServiceChanged=$false");
    expect(content).not.toMatch(/\b(?:Set-ItemProperty|New-ItemProperty|Restart-Service|Start-Service|Stop-Service|Set-Acl|Set-Service|Copy-Item|Install-Service)\b/i);
    expect(content).toContain("LINUX_BROKER_PAYLOAD_MISSING_INSTALL_REVIEWED_RELEASE");
    expect(content).toContain("RUN_UNELEVATED_OWNER_SESSION");
    // /usr/bin/test -f -- PATH exits 2 on GNU coreutils and hides an installed broker.
    expect(content).toContain("@('/usr/bin/test','-f',$installedLinux)");
    expect(content).not.toContain("@('/usr/bin/test','-f','--',$installedLinux)");
  });
});
