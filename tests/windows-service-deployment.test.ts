import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const deployRoot = path.join(repo, "deploy", "windows");

/**
 * Read a file with the line endings the assertions are written against. This
 * checkout uses `core.autocrlf`, so the same Go source has CRLF on a Windows
 * developer machine and LF in CI and in git; a gate that matched `\n` would
 * disagree about the code depending on who cloned it.
 */
function readText(file: string): string {
  return fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
}

/** Every Go source in the Windows deployment module, including its tests. */
function goSources(dir = deployRoot): { file: string; text: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const where = path.join(dir, entry.name);
    if (entry.isDirectory()) return goSources(where);
    return entry.name.endsWith(".go") ? [{ file: where, text: readText(where) }] : [];
  });
}

function find(relative: string): string {
  return readText(path.join(deployRoot, relative));
}

describe("Windows service deployment invariants", () => {
  const all = goSources();

  it("persist by SCM auto-start, never by a logon-triggered task", () => {
    // The reason the service exists at all: a logon task answers nobody before
    // someone signs in, which is how "it worked yesterday and is dead today"
    // started. Persistence is a boot-start registration or it is not.
    for (const { file, text } of all) {
      const lower = text.toLowerCase();
      for (const forbidden of ["schtasks", "onlogon", "taskschd"]) {
        expect(lower, `${path.relative(repo, file)} mentions ${forbidden}`).not.toContain(forbidden);
      }
    }
    expect(find("internal/svc/svc.go")).toContain("mgr.StartAutomatic");
  });

  it("grants an un-elevated tray exactly query, start and stop", () => {
    const security = find("internal/svc/names.go");
    expect(security).toContain("(A;;LCRPWP;;;IU)");
    // The frequently written wrong answer: it looks like it covers control,
    // but holds neither RP (start) nor WP (stop), and the tray then fails with
    // access denied on every menu item while still appearing installed.
    expect(security).not.toContain("(A;;LCSWLOCRRC;;;IU)");
  });

  it("lets SCM restart a crash, but never an operator stop", () => {
    expect(find("internal/svc/security.go")).toContain("scActionRestart");
    const service = find("internal/svc/svc.go");
    // Two exit codes with opposite meanings: a closed request channel is an
    // operator action and must report success, while a supervisor that ends on
    // its own is a fault handed to the failure policy.
    expect(service).toContain("return false, 0");
    expect(service).toMatch(/case <-done:[\s\S]*?return false, 1/);
  });

  it("kills the server child with the host instead of orphaning the port", () => {
    // An orphaned listener is the worst outcome: the next start refuses to bind
    // over it, so the service looks broken until someone finds the stray.
    expect(find("internal/host/job_windows.go")).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    expect(find("internal/host/host.go")).toContain("s.job.assign(");
  });

  it("never targets a server process it did not spawn", () => {
    for (const { file, text } of all) {
      const lower = text.toLowerCase();
      for (const forbidden of ["taskkill", "stop-process", "terminateprocess(", "enumprocesses"]) {
        expect(lower, `${path.relative(repo, file)} uses ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("hands the server only absolute, machine-wide paths", () => {
    // A service starts in System32 with no interactive profile, so a relative
    // path is either EACCES or litter in the Windows directory.
    const settings = find("internal/host/settings.go");
    for (const key of ["HOOSHIX_LOG_DIR", "HOOSHIX_DB_PATH", "HOOSHIX_BOOTSTRAP_TOKEN_FILE"]) {
      expect(settings, `${key} is not owned by the data root`).toContain(`setDefault(env, "${key}", filepath.Join(settings.DataRoot`);
    }
    expect(settings).toContain("must be an absolute path");
  });

  it("keeps the tray's colour logic portable and its Win32 calls gated", () => {
    // The mapping from state to colour is the part that can be wrong and the
    // part that can be tested on Linux CI, so it carries no build tag. Every
    // other file in the package needs the notification area and is gated,
    // which keeps `GOOS=linux go build ./...` meaningful instead of accidental.
    const trayDir = path.join(deployRoot, "internal", "tray");
    const portable = new Set(["state.go", "state_test.go", "icon.go", "icon_test.go"]);
    for (const entry of fs.readdirSync(trayDir)) {
      if (!entry.endsWith(".go")) continue;
      const text = readText(path.join(trayDir, entry));
      const first = text.split("\n", 1)[0].trim();
      if (portable.has(entry)) {
        expect(first, `${entry} must build on every OS`).not.toMatch(/^\/\/go:build/);
      } else {
        expect(first, `${entry} is not build-tagged`).toMatch(/^\/\/go:build (!windows|windows)$/);
      }
    }
    // Windows delivers a window's messages to the thread that created it, so an
    // unpinned pump loses icon clicks at the mercy of the Go scheduler.
    expect(find("internal/tray/tray_windows.go")).toContain("runtime.LockOSThread()");
  });

  it("earns green only from a live ready report by the running service", () => {
    const state = find("internal/tray/state.go");
    // A stopped service leaves its last status.json on disk, and SCM can report
    // running while the server inside it died. Both must be able to stop green.
    expect(state).toMatch(/if snapshot\.Service !==? "running"[\s\S]{0,80}return readinessRed/);
    expect(state).toMatch(/!snapshot\.Published \|\| snapshot\.Stale \{[\s\S]{0,80}return readinessYellow/);
    expect(state).toMatch(/State == host\.StateReady \{[\s\S]{0,80}return readinessGreen/);
    // Staleness is a bounded window, not a guess: the publisher rewrites every
    // two seconds, so silence past the window means the publisher is gone.
    expect(state).toMatch(/liveReportWindow = \d+ \* time\.Second/);
    expect(state).toContain("clock().Sub(publishedAt) > liveReportWindow");
  });

  it("gives the tray no credential, no probe and no filesystem asset", () => {
    const trayFiles = fs.readdirSync(path.join(deployRoot, "internal", "tray")).filter((name) => name.endsWith(".go"));
    for (const entry of trayFiles) {
      const text = find(path.join("internal", "tray", entry));
      // The tray reads the document the service publishes. It never touches the
      // bootstrap PIN, the database, or the MCP endpoint, so it stays runnable
      // by an ordinary user with nothing to leak.
      for (const forbidden of [".token", "HOOSHIX_BOOTSTRAP", "secrets", "net/http", "better-sqlite3"]) {
        expect(text, `${entry} touches ${forbidden}`).not.toContain(forbidden);
      }
      // Assets come from the binary, not from a directory that an upgrade, a
      // moved install, or a missing %ProgramData% can empty.
      expect(text, `${entry} reads a file at runtime`).not.toContain("os.ReadFile");
    }
    const icons = find("internal/tray/icon.go");
    for (const colour of ["green", "yellow", "red"]) {
      expect(icons, `hooshix-mcp-${colour}.ico is not embedded`).toContain(`icons/hooshix-mcp-${colour}.ico`);
      const asset = path.join(deployRoot, "internal", "tray", "icons", `hooshix-mcp-${colour}.ico`);
      expect(fs.existsSync(asset), `${asset} must be committed, not generated at build time`).toBe(true);
    }
  });

  it("closes the icon without ever stopping the service", () => {
    const tray = find("internal/tray/tray_windows.go");
    const exit = tray.match(/func \(app \*App\) exit\(\)[\s\S]*?\n\}/);
    expect(exit, "App.exit is missing").not.toBeNull();
    // The tray is a convenience in the user's session; the connector is a
    // machine-wide service other people depend on. "Close tray icon" must not
    // be a way to take the endpoint down.
    expect(exit![0]).not.toContain("svc.Stop");
    expect(exit![0]).toContain("app.menu.quit()");
    expect(find("internal/tray/menu_windows.go")).toContain('"Close tray icon"');
  });

  it("runs service commands off the message-loop thread", () => {
    // Stop and Restart wait for SCM to settle. On the pump thread that freezes
    // the window, and a frozen tray stops answering clicks exactly when the
    // operator is watching the colour change.
    const tray = find("internal/tray/tray_windows.go");
    expect(tray).toMatch(/func \(app \*App\) command\([\s\S]*?go func\(\) \{[\s\S]*?action\(\)/);
    // A double click must not stack two SCM transactions.
    expect(tray).toContain("app.busy.CompareAndSwap(false, true)");
  });
});

describe("Windows installer package invariants", () => {
  const installer = find("cmd/hooshix-mcp-setup/main.go");
  const winapi = find("cmd/hooshix-mcp-setup/winapi_windows.go");
  const layout = find("internal/setup/layout.go");
  const payload = find("internal/setup/payload.go");
  const archive = find("internal/setup/archive.go");
  const buildScript = readText(path.join(repo, "scripts", "build-windows-installer.mjs"));

  it("verifies the runtime it carries before it changes the machine", () => {
    // The order is the entire contract: a truncated download has to fail with
    // "get setup.exe again" while the machine is still untouched, not half
    // install a service that then fails at every boot. Reading the archive and
    // checking its checksum both happen inside Locate.
    const locate = installer.indexOf("setup.Locate(file)");
    expect(locate, "the installer does not locate its payload").toBeGreaterThan(-1);
    for (const after of ["svc.Uninstall()", "setup.ExtractArchive(", "svc.Install(", "WriteSettings"]) {
      expect(installer.indexOf(after), `${after} runs before the payload is verified`).toBeGreaterThan(locate);
    }
    expect(payload).toContain("crc32OfSection(file, payload.Offset, payload.Size)");
    // Two mistakes with one honest message: a build that skipped the assembler,
    // and a fetch that ended early.
    expect(payload).toContain("built without one (run scripts/build-windows-installer.mjs)");
    expect(payload).toContain("did not finish downloading");
  });

  it("carries the runtime inside the file and never fetches it", () => {
    // Nothing to download beside setup.exe is what makes this usable on a
    // machine with no browser, no network share and no idea what a URL is.
    for (const text of [installer, winapi, layout, payload, archive]) {
      expect(text, "the installer reaches the network").not.toContain("net/http");
    }
    expect(archive).toContain("io.NewSectionReader(file, payload.Offset, payload.Size)");
  });

  it("unpacks only inside the install directory and never as a link", () => {
    // Setup runs elevated. A payload whose entry names can escape the install
    // directory is therefore a system-wide write, not a per-user one, and a
    // symbolic link under Program Files is a path nobody can read.
    expect(archive).toContain("resolveEntry(targetDir, entry.Name)");
    expect(archive).toContain("is an absolute path");
    expect(archive).toContain("is a symbolic link, which the installer will not create");
    expect(archive).toContain("total > maxExtractBytes");
  });

  it("starts the tray for every account and points at nothing that persists", () => {
    // HKLM, not HKCU: the elevated token can belong to an administrator who is
    // installing on somebody else's machine, and a value written into that
    // profile means the icon never appears for the person who owns it.
    expect(winapi).toContain("registry.LOCAL_MACHINE");
    expect(winapi).not.toContain("registry.CURRENT_USER");
    // The startup value runs the tray image and nothing else. The service is
    // persistent because SCM registered it; a startup entry pointing at the
    // service binary would start a second copy inside a user session.
    expect(winapi).toContain("setup.RunValueName, layout.TrayCommand()");
    expect(layout).toMatch(/func \(layout Layout\) TrayCommand\(\) string \{\n\treturn QuoteCommand\(layout\.TrayBinary\(\)\)/);
    expect(layout).toMatch(/"UninstallString": layout\.UninstallCommand\(\)/);
  });

  it("removes what it wrote and keeps what it never owned", () => {
    // The data root holds the operator's database, approvals and logs. Deleting
    // it on an ordinary uninstall turns a routine re-install into data loss.
    const purge = installer.indexOf("os.RemoveAll(layout.DataRoot)");
    expect(installer.indexOf("if !purgeData"), "the data root is deleted without being asked").toBeLessThan(purge);
    expect(installer).toContain("os.RemoveAll(layout.InstallDir)");
    // The entry in Programs runs the payload-less head copy of this same image,
    // so removing an install never needs the original download.
    expect(installer).toContain("setup.WriteUninstaller(self, layout.UninstallerBinary(), payload.Offset)");
    expect(payload).toContain("func WriteUninstaller(setupPath, outPath string, exeSize int64) error");
    expect(installer).toMatch(/\*uninstall \|\| isUninstaller\(self\)/);
  });

  it("keeps an existing settings document on a re-run", () => {
    // An upgrade replaces program files. Resetting the origin, the port or a
    // permission the operator switched on is not part of upgrading.
    expect(layout).toMatch(/if _, err := os\.Stat\(path\); err == nil \{\n\t\treturn false, nil/);
    expect(installer).toContain("kept the existing");
    // The permission knobs stay out of the installer entirely: shipping them
    // switched on hands every fresh machine an endpoint that executes anything.
    for (const key of ["HOOSHIX_PERMISSION_LEVEL", "HOOSHIX_DIRECT_AUTO_APPROVE", "HOOSHIX_EXEC_ENABLED", "CTX_ISOLATION_MODE"]) {
      expect(layout, `the installer ships ${key}`).not.toContain(key);
    }
  });

  it("builds the payload with the pinned runtime and production dependencies only", () => {
    // dist/ compiled by one engine and shipped beside another is how an
    // installer produces a server that dies on the first request, and a dev
    // dependency in the payload is tens of megabytes of nothing.
    expect(buildScript).toContain("verify-runtime-versions.mjs");
    expect(buildScript).toContain('run("corepack", ["pnpm", ...args]');
    // Build flags are passed to Go as one argument; the old --s --w was invalid.
    expect(buildScript).toContain('`-ldflags=${flags.join(" ")}`');
    expect(buildScript).toContain('"build", "-buildvcs=false", "-trimpath"');
    expect(buildScript).toContain('"./cmd/hooshix-git-worker"');
    expect(buildScript).toContain('"./cmd/hooshix-wsl-fs-broker"');
    expect(buildScript).toContain('"hooshix-wsl-fs-broker-linux-amd64"');
    expect(buildScript).toContain('"enroll-wsl-files.ps1"');
    expect(buildScript).not.toContain('`-ldflags=-${flags.join(" -")}`');
    expect(buildScript).toContain(`"install", "--prod", "--node-linker=hoisted", "--frozen-lockfile"`);
    expect(buildScript).toContain(`"node_modules", "typescript", "bin", "tsc"`);
    // A package manager that re-resolves the tree before running a script is
    // free to prune it, and doing that to a live checkout takes down the server.
    // The only verb the build is allowed to ask of pnpm is the install above.
    expect(buildScript.match(/runPackageManager\(\["[a-z]+"/g)).toEqual(['runPackageManager(["install"']);
    expect(JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).scripts["installer:windows"]).toContain("build-windows-installer.mjs");
    // The artifact is the size of a Node distribution: it belongs on a share,
    // never in git.
    expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toContain("deploy/windows/build/");
  });

  it("persists through SCM and touches no process it did not start", () => {
    // The build script is where a logon task creeps back in: it is the file that
    // knows about the old launcher, and re-adding one there reintroduces the
    // exact failure the service exists to end.
    const lower = buildScript.toLowerCase();
    for (const forbidden of ["schtasks", "onlogon", "taskschd", "taskkill", "stop-process"]) {
      expect(lower, `the build script mentions ${forbidden}`).not.toContain(forbidden);
    }
    expect(lower).not.toContain("watchdog");
  });
});