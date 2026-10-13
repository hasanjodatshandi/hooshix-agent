import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const deployRoot = path.join(repo, "deploy", "windows");

/** Every Go source in the Windows deployment module, including its tests. */
function goSources(dir = deployRoot): { file: string; text: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const where = path.join(dir, entry.name);
    if (entry.isDirectory()) return goSources(where);
    return entry.name.endsWith(".go") ? [{ file: where, text: fs.readFileSync(where, "utf8") }] : [];
  });
}

function find(relative: string): string {
  return fs.readFileSync(path.join(deployRoot, relative), "utf8");
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
      const text = fs.readFileSync(path.join(trayDir, entry), "utf8");
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
