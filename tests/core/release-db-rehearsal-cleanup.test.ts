import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import Database from "better-sqlite3";
import {describe,expect,it} from "vitest";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {runMigrations} from "../../src/core/memory/database/migrations.js";

const runner=path.resolve("scripts/release-db-rehearsal.mjs");
function sha(file:string){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
function reportPaths(output:string):string[]{
  const matches=[...output.matchAll(/"(?:rehearsalCopy|restoreRehearsalCopy)":\s*("(?:[^"\\]|\\.)*")/g)];
  return matches.map(m=>JSON.parse(m[1]) as string);
}
function assertNoCopies(output:string){
  expect(output).toContain('"kind": "release_rehearsal_cleanup"');
  expect(output).toContain('"sensitiveArtifactsRemoved": true');
  expect(output).toContain('"remainingCount": 0');
  const entries=reportPaths(output);
  // Early failures may occur before the restore copy exists, so that path
  // is correctly reported as null. Every materialized copy must be gone.
  expect(entries.length).toBeGreaterThanOrEqual(1);
  for(const file of entries){
    for(const suffix of ["","-wal","-shm"]){
      expect(fs.existsSync(file+suffix),`sensitive rehearsal artifact persisted: ${path.basename(file+suffix)}`).toBe(false);
    }
  }
}
function invoke(source:string){
  return spawnSync(process.execPath,[runner],{
    cwd:process.cwd(),env:{...process.env,HOOSHIX_DB_PATH:source},
    encoding:"utf8",timeout:40_000,maxBuffer:1024*1024,
  });
}

describe("release DB rehearsal clears sensitive backups",()=>{
  it("passes migration+restore on a disposable real SQLite database and cleans all backups",()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-db-cleanup-pass-"));
    try{
      const source=path.join(dir,"test-source.db");
      const db=new Database(source);
      db.pragma("foreign_keys = ON");
      applyBaseSchemaMigration(db);
      runMigrations(db);
      db.close();
      const initial=sha(source);
      const result=invoke(source);
      expect(result.status,`stdout=${result.stdout} stderr=${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('"result": "PASS"');
      expect(result.stdout).toContain('"restoreDrill"');
      assertNoCopies(result.stdout);
      expect(sha(source)).toBe(initial);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  },55_000);

  it("also clears backups after a recoverable copy-validation failure",()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-db-cleanup-fail-"));
    try{
      const source=path.join(dir,"unsupported-source.db");
      const db=new Database(source);
      db.exec("CREATE TABLE legacy_unrelated(id INTEGER)");
      db.close();
      const initial=sha(source);
      const result=invoke(source);
      expect(result.status,`stdout=${result.stdout} stderr=${result.stderr}`).not.toBe(0);
      expect(result.stderr).toContain('"result": "FAIL"');
      expect(result.stdout).toContain('"result": "PASS"'); // Cleanup, not migration
      assertNoCopies(result.stderr+result.stdout);
      expect(sha(source)).toBe(initial);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  },55_000);
});
