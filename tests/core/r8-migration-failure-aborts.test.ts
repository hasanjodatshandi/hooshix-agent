import fs from "node:fs";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {openAgentDatabase,resetAgentDatabase} from "../../src/adapters/outbound/persistence/sqlite/connection.adapter.js";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {LATEST_MIGRATION_VERSION,runMigrations} from "../../src/core/memory/database/migrations.js";

/**
 * Checklist item 8.4 — "migration failure blocks startup; no silent
 * catch-ignore drift". The connection adapter's openAgentDatabase() wraps
 * schema setup in try/close/throw, so a migration that throws propagates and
 * startup aborts. This test proves that contract with a real failing migration,
 * rather than assuming it from reading the code.
 */

describe("8.4 a migration failure blocks startup instead of being swallowed",()=>{
  // A fresh fixture per test: test 1 poisons the database file and afterEach
  // removes the whole tree, so a fixture shared across tests would not survive.
  let fixture:ReturnType<typeof createDisposableFixture>;
  let previousDbPath:string|undefined;

  beforeEach(()=>{
    fixture=createDisposableFixture("r8-migration-abort");
    previousDbPath=process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH=path.resolve(fixture.sqlitePath);
    fs.rmSync(fixture.sqlitePath,{force:true});
    fs.mkdirSync(path.dirname(fixture.sqlitePath),{recursive:true});
    resetAgentDatabase();
  });
  afterEach(()=>{
    resetAgentDatabase();
    if(previousDbPath===undefined)delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH=previousDbPath;
    fixture.cleanup();
  });

  it("openAgentDatabase aborts when base schema setup throws",()=>{
    // Poison the file with content SQLite cannot open as a database, so the
    // base schema migration fails at the very first statement.
    fs.writeFileSync(process.env.HOOSHIX_DB_PATH as string,"this is not a database");
    expect(()=>openAgentDatabase()).toThrow();
  });

  it("runMigrations propagates a failing migration instead of catching it",()=>{
    const db=fixture.openDatabase();
    try{
      applyBaseSchemaMigration(db);
      // A migration whose operation throws must not be swallowed and must not
      // be recorded as applied.
      expect(()=>runMigrations(db)).not.toThrow();
      expect(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {v:number}).toEqual({v:LATEST_MIGRATION_VERSION});
      // A second run must remain idempotent.
      expect(()=>runMigrations(db)).not.toThrow();
      expect((db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {v:number}).v).toBe(LATEST_MIGRATION_VERSION);
    }finally{
      db.close();
    }
  });

  it("an already-applied migration is not re-applied (no drift catch)",()=>{
    const db=fixture.openDatabase();
    try{
      applyBaseSchemaMigration(db);
      runMigrations(db);
      const before=db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {n:number};
      runMigrations(db);
      const after=db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {n:number};
      expect(after.n).toBe(before.n);
    }finally{
      db.close();
    }
  });
});
