import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, spawnDisposableNode, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { runMigrations } from "../../src/core/memory/database/migrations.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";

/**
 * The first test establishes a REAL two-OS-process shared SQLite race harness
 * isolated inside a disposable DB. It does NOT imply the production Task
 * scheduler has a durable lease. The second regression checks the actual R3 lease schema.
 */
let fixture: DisposableFixture | undefined;
afterEach(() => { fixture?.cleanup(); fixture = undefined; });

const require = createRequire(import.meta.url);
const addonPath = require.resolve("better-sqlite3");

function compete(dbPath: string, owner: string): Promise<{ won: boolean; pid: number }> {
  if (!fixture) throw new Error("Fixture missing");
  const code = [
    "const Database=require(" + JSON.stringify(addonPath) + ");",
    "const db=new Database(" + JSON.stringify(dbPath) + ");",
    "db.pragma('busy_timeout = 8000');",
    "try {",
    "  const result=db.prepare(\"INSERT OR IGNORE INTO test_lease(task_id,owner) VALUES ('single-task',?)\").run(" + JSON.stringify(owner) + ");",
    "  process.stdout.write(JSON.stringify({won:result.changes===1,pid:process.pid}));",
    "} finally {db.close();}",
  ].join("\n");
  const child = spawnDisposableNode(code, fixture.root);
  return new Promise((resolve, reject) => {
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode !== 0) reject(new Error("Disposable SQLite child exited " + exitCode + ": " + stderr));
      else {
        try { resolve(JSON.parse(stdout) as { won: boolean; pid: number }); }
        catch (error) { reject(error); }
      }
    });
  });
}

describe("HIGH-13 real two-process fixture and migrated durable lease contract", () => {
  it("runs two OS processes against one isolated WAL DB with exactly one atomic write winner", async () => {
    fixture = createDisposableFixture("twoprocess");
    const db = fixture.openDatabase();
    try {
      db.pragma("journal_mode = WAL");
      db.exec("CREATE TABLE test_lease (task_id TEXT PRIMARY KEY, owner TEXT NOT NULL)");
    } finally { db.close(); }
    const [first, second] = await Promise.all([
      compete(fixture.sqlitePath, "worker-a"),
      compete(fixture.sqlitePath, "worker-b"),
    ]);
    expect(first.pid).not.toBe(second.pid);
    expect([first.won, second.won].filter(Boolean)).toHaveLength(1);
    const verify = fixture.openDatabase();
    try {
      expect(verify.prepare("SELECT COUNT(*) AS n FROM test_lease").get()).toEqual({ n: 1 });
    } finally { verify.close(); }
  }, 30000);

  it("HIGH-13: production schema has a durable fenced task execution lease after R3 cutover", () => {
    fixture = createDisposableFixture("lease-schema");
    const db = fixture.openDatabase();
    try {
      applyBaseSchemaMigration(db);
      runMigrations(db);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.some(({name}) => name === "task_leases")).toBe(true);
    } finally { db.close(); }
  });
});
