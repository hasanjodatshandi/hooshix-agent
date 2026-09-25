import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import Database from "better-sqlite3";
import {describe,expect,it} from "vitest";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {runMigrations,LATEST_MIGRATION_VERSION} from "../../src/core/memory/database/migrations.js";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

describe("R6.01 migration-only SQLite schema initialization",()=>{
  it("creates a versioned, atomic baseline and runs historical incremental migrations once",()=>{
    const fixture=createDisposableFixture("r6-initial-schema");
    try{
      const db=fixture.openDatabase();
      try{
        applyBaseSchemaMigration(db);
        const base=db.prepare("SELECT name FROM schema_migrations WHERE version=0").get() as {name:string};
        expect(base.name).toBe("r6-initial-schema");
        runMigrations(db);
        runMigrations(db);
        const versions=db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{version:number}>;
        expect(versions.map(x=>x.version)).toEqual(Array.from({length:LATEST_MIGRATION_VERSION+1},(_,i)=>i));
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_access_tokens'").get()).toBeTruthy();
        expect(db.pragma("quick_check",{simple:true})).toBe("ok");
      }finally{db.close();}
    }finally{fixture.cleanup();}
  });

  it("rolls back an incomplete baseline migration without changing a preexisting schema",()=>{
    const fixture=createDisposableFixture("r6-schema-atomic");
    try{
      const db=fixture.openDatabase();
      try{
        db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
        db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES (0,?,?)")
          .run("preexisting-marker","2026-09-21T00:00:00.000Z");
        expect(()=>applyBaseSchemaMigration(db)).toThrow();
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get())
          .toBeUndefined();
        expect((db.prepare("SELECT name FROM schema_migrations WHERE version=0").get() as {name:string}).name)
          .toBe("preexisting-marker");
        expect(db.pragma("quick_check",{simple:true})).toBe("ok");
      }finally{db.close();}
    }finally{fixture.cleanup();}
  });

  it("preserves existing versioned user data without retroactively installing the new base marker",()=>{
    const fixture=createDisposableFixture("r6-legacy-db");
    try{
      const seed=fixture.openDatabase();
      try{
        applyBaseSchemaMigration(seed);
        runMigrations(seed);
        seed.prepare("INSERT INTO tool_calls(correlation_id,tool,status,created_at) VALUES(?,?,?,?)")
          .run("r6-historical-row","read_file","success","2026-09-21T00:00:00Z");
        seed.prepare("DELETE FROM schema_migrations WHERE version=0").run();
      }finally{seed.close();}
      const repo=process.cwd();
      const entry=pathToFileURL(path.join(repo,"src","core","memory","database","index.ts")).href;
      const script=`import assert from "node:assert/strict";
        import {withAgentDatabase,closeAgentDatabase} from ${JSON.stringify(entry)};
        const result=withAgentDatabase(db=>({
          marker:db.prepare("SELECT version FROM schema_migrations WHERE version=0").get(),
          count:db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE correlation_id=?").get("r6-historical-row").n,
          migrations:db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n
        }));
        assert.equal(result.marker,undefined);
        assert.equal(result.count,1);
        assert.equal(result.migrations,${LATEST_MIGRATION_VERSION});
        closeAgentDatabase();
        console.log("R6_HISTORICAL_DB_PRESERVED");`;
      const loader=pathToFileURL(path.join(repo,"node_modules","tsx","dist","loader.mjs")).href;
      const child=spawnSync(process.execPath,["--import",loader,"--input-type=module","-e",script],{
        cwd:fixture.root,windowsHide:true,encoding:"utf8",maxBuffer:65536,timeout:12000,
        env:{...process.env,HOOSHIX_DB_PATH:fixture.sqlitePath,
          HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
          HOOSHIX_WORKSPACE:fixture.root}
      });
      expect(child.status,child.stderr||child.error?.message).toBe(0);
      expect(child.stdout.trim()).toBe("R6_HISTORICAL_DB_PRESERVED");
      const verify=new Database(fixture.sqlitePath,{readonly:true,fileMustExist:true});
      try{
        expect(verify.prepare("SELECT version FROM schema_migrations WHERE version=0").get()).toBeUndefined();
        expect((verify.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE correlation_id=?")
          .get("r6-historical-row") as {n:number}).n).toBe(1);
      }finally{verify.close();}
    }finally{fixture.cleanup();}
  },20000);

  it("never silently heals an existing unrelated database and leaves its rows intact",()=>{
    const fixture=createDisposableFixture("r6-existing-db");
    const repo=process.cwd();
    try{
      const seed=new Database(fixture.sqlitePath);
      try{
        seed.exec("CREATE TABLE sentinel (name TEXT NOT NULL)");
        seed.prepare("INSERT INTO sentinel(name) VALUES(?)").run("preexisting-user-row");
      }finally{seed.close();}
      const entry=pathToFileURL(path.join(repo,"src","core","memory","database","index.ts")).href;
      const script=`import assert from "node:assert/strict";
        import {openAgentDatabase,withAgentDatabase,closeAgentDatabase} from ${JSON.stringify(entry)};
        const db=openAgentDatabase();
        const row=db.prepare("SELECT name FROM sentinel LIMIT 1").get();
        assert.equal(row.name,"preexisting-user-row");
        assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get(),undefined);
        assert.throws(()=>withAgentDatabase(()=>undefined),/schema_migrations/);
        closeAgentDatabase();
        console.log("R6_EXISTING_DB_UNMODIFIED");`;
      const loader=pathToFileURL(path.join(repo,"node_modules","tsx","dist","loader.mjs")).href;
      const child=spawnSync(process.execPath,["--import",loader,"--input-type=module","-e",script],{
        cwd:fixture.root,windowsHide:true,encoding:"utf8",maxBuffer:65536,timeout:12000,
        env:{...process.env,HOOSHIX_DB_PATH:fixture.sqlitePath,
          HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
          HOOSHIX_WORKSPACE:fixture.root}
      });
      expect(child.status,child.stderr||child.error?.message).toBe(0);
      expect(child.stdout.trim()).toBe("R6_EXISTING_DB_UNMODIFIED");
      const verify=new Database(fixture.sqlitePath,{readonly:true,fileMustExist:true});
      try{
        expect((verify.prepare("SELECT name FROM sentinel LIMIT 1").get() as {name:string}).name)
          .toBe("preexisting-user-row");
        expect(verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get()).toBeUndefined();
      }finally{verify.close();}
      expect(fs.existsSync(fixture.sqlitePath)).toBe(true);
    }finally{fixture.cleanup();}
  },20000);
});
