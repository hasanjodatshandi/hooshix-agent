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
});
