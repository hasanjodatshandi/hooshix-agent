import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLegacyRuntimePaths } from "../../src/infrastructure/config/legacy-runtime-paths.js";
import { getAgentDatabasePath } from "../../src/core/memory/database/connection.js";
import { logCommandAction } from "../../src/memory/command-audit.js";
import { logFileAction } from "../../src/memory/file-audit.js";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";

const initialDb = process.env.HOOSHIX_DB_PATH;
const initialLog = process.env.HOOSHIX_LOG_DIR;
let fixture: DisposableFixture | undefined;
afterEach(() => {
  if (initialDb === undefined) delete process.env.HOOSHIX_DB_PATH;
  else process.env.HOOSHIX_DB_PATH = initialDb;
  if (initialLog === undefined) delete process.env.HOOSHIX_LOG_DIR;
  else process.env.HOOSHIX_LOG_DIR = initialLog;
  fixture?.cleanup();
  fixture = undefined;
});

describe("R1 lazy runtime path config migration", () => {
  it("preserves default values and accepts a supplied environment without reading ambient state", () => {
    expect(readLegacyRuntimePaths({})).toEqual({
      databasePath: "./data/agent-memory.db",
      logDirectory: "./logs",
    });
    expect(readLegacyRuntimePaths({ HOOSHIX_DB_PATH: "db/fixture.db", HOOSHIX_LOG_DIR: "logs/fixture" }))
      .toEqual({ databasePath: "db/fixture.db", logDirectory: "logs/fixture" });
  });

  it("legacy database path observes the current environment on each invocation without opening the DB", () => {
    fixture = createDisposableFixture("dbpath");
    process.env.HOOSHIX_DB_PATH = path.join(fixture.root, "db-a.sqlite");
    expect(getAgentDatabasePath()).toBe(path.join(fixture.root, "db-a.sqlite"));
    process.env.HOOSHIX_DB_PATH = path.join(fixture.root, "db-b.sqlite");
    expect(getAgentDatabasePath()).toBe(path.join(fixture.root, "db-b.sqlite"));
    expect(fs.readdirSync(fixture.root).some(name => name.endsWith(".sqlite"))).toBe(false);
  });

  it("command and file audit logs still use the current log directory without entering the source tree", async () => {
    fixture = createDisposableFixture("auditpath");
    const first = path.join(fixture.root, "log-a");
    const second = path.join(fixture.root, "log-b");
    process.env.HOOSHIX_LOG_DIR = first;
    await logCommandAction({ command: "node", args: ["--version"], correlationId: "r1-fixture", status: "success" });
    process.env.HOOSHIX_LOG_DIR = second;
    await logFileAction("read_file", "fixture.txt", "r1-fixture");
    expect(fs.readFileSync(path.join(first, "command-actions.log"), "utf8")).toContain('"correlationId":"r1-fixture"');
    expect(fs.readFileSync(path.join(second, "file-actions.log"), "utf8")).toContain('"correlationId":"r1-fixture"');
    expect(fs.existsSync(path.join(first, "file-actions.log"))).toBe(false);
    expect(fs.existsSync(path.join(second, "command-actions.log"))).toBe(false);
  });

  it("the migrated legacy modules no longer read process.env directly", () => {
    for (const file of ["src/core/memory/database/connection.ts", "src/memory/command-audit.ts", "src/memory/file-audit.ts"]) {
      expect(fs.readFileSync(path.resolve(file), "utf8")).not.toMatch(/\bprocess\s*\.\s*env\b/);
    }
  });
});
