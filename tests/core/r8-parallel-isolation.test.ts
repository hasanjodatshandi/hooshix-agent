import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_FILES_ROOT } from "../helpers/runtime-files.js";

const read = (name: string) => fs.readFileSync(path.resolve(name), "utf8");

/**
 * R8.06 regression guard. The parallel suite used to fail 363/726 (and 564/768
 * on this machine) for one reason only: parallel Vitest workers shared a single
 * SQLite database, log directory and tests/runtime-files scratch tree, so one
 * worker's beforeEach deleted another worker's open database and in-flight
 * fixtures. The fix is structural isolation per VITEST_WORKER_ID; these
 * contracts keep someone from reintroducing the shared paths.
 */
describe("R8.06 parallel worker isolation", () => {
  it("resolves a distinct database, log and memory path per Vitest worker", () => {
    const setup = read("tests/setup/database-cleanup.ts");
    expect(setup).toContain("process.env.VITEST_WORKER_ID");
    // The three persisted paths must be derived from the worker id, not fixed.
    expect(setup).toMatch(/HOOSHIX_DB_PATH\s*=\s*path\.resolve\("data", `test-agent-memory-\$\{workerId\}\.db`\)/);
    expect(setup).toMatch(/HOOSHIX_LOG_DIR\s*=\s*path\.resolve\("data", `test-logs-\$\{workerId\}`\)/);
    expect(setup).toMatch(/HOOSHIX_MEMORY_FILE\s*=\s*path\.resolve\("data", `test-agent-memory-\$\{workerId\}\.json`\)/);
  });
  it("does not inject a single shared database path for every worker", () => {
    expect(read("vitest.config.ts")).not.toMatch(/HOOSHIX_DB_PATH\s*:/);
  });
  it("re-asserts the worker database path before every test so a test that mutates the env cannot reopen the live database", () => {
    // A suite may repoint or delete process.env.HOOSHIX_DB_PATH (r4-db-identity
    // repoints it at a scratch fixture and used to delete it in afterEach). The
    // DB-opening steps in the setup's beforeEach — replaceWorkspaceRoots above
    // all — then fell back to the default ./data/agent-memory.db, which is the
    // LIVE production database: migrations ran against it and one production
    // workspace-root row was touched. The setup owns the path, so it must
    // re-assert it before anything opens a connection.
    const setup = read("tests/setup/database-cleanup.ts");
    expect(setup).toMatch(/beforeEach\(\(\) => \{[\s\S]*?process\.env\.HOOSHIX_DB_PATH\s*=\s*databasePath/);
  });
  it("keeps the filesystem scratch root worker-scoped", () => {
    expect(RUNTIME_FILES_ROOT).toContain(process.env.VITEST_WORKER_ID ?? "single");
    // No test may write to a fixed shared runtime-files tree ever again.
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      // A parallel test may create/delete a scratch directory under tests/
      // while this scan runs (e.g. tests/tool-coverage); a vanished directory
      // is not an offender.
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        const location = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(location);
        else if (entry.isFile() && /\.test\.ts$/.test(entry.name)) {
          if (entry.name === "r8-parallel-isolation.test.ts") continue; // this guard's own matcher
          const source = fs.readFileSync(location, "utf8");
          if (source.includes('"tests/runtime-files') || source.includes("`tests/runtime-files"))
            offenders.push(path.relative(process.cwd(), location).replace(/\\/g, "/"));
        }
      }
    };
    visit(path.resolve("tests"));
    expect(offenders).toEqual([]);
  });
});
