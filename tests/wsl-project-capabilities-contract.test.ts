import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (name: string) => fs.readFileSync(path.join(root, name), "utf8");

describe("Native WSL tool descriptions and packaged-runtime upgrade guard", () => {
  it("tells WSL users about separately enrolled file-write and Git capabilities", () => {
    const workspace = source("src/tools/system/workspace.ts");
    const help = source("src/tools/system/help.ts");

    expect(workspace).toContain("snapshot-backed create/write/modify/delete/restore");
    expect(workspace).toContain("Git add/branch/commit/checkout");
    expect(workspace).toContain("WSL git_init/git_clone and execute_command remain unsupported");
    expect(workspace).not.toContain("only confined file read/list/search operations are currently supported");
    expect(workspace).not.toContain("only for read_file, list_directory and search_files");
    expect(help).toContain("Independently enrolled file-write and Git-write workers");
    expect(help).not.toContain("Native file tools still require a Windows-accessible project root");
  });

  it("stops an upgrade with unsafe retained runtime paths BEFORE stopping the service", () => {
    const installer = source("deploy/windows/cmd/hooshix-mcp-setup/main.go");
    const layout = source("deploy/windows/internal/setup/layout.go");
    const guard = installer.indexOf("layout.CheckExistingSettingsRuntime()");
    const serviceStop = installer.indexOf("svc.Uninstall()");
    const extraction = installer.indexOf("setup.ExtractArchive(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(serviceStop);
    expect(guard).toBeLessThan(extraction);
    expect(layout).toContain("func (layout Layout) CheckExistingSettingsRuntime() error");
    expect(layout).toContain("existing settings.json %s points outside the packaged runtime");
    // An unsafe retained document is REFUSED; the installer must never
    // silently reset credentials, owner enrollment or operator permissions.
    expect(layout).toContain("return fmt.Errorf");
    expect(layout).toContain("return nil");
  });
});
