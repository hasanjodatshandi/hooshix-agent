import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import Database from "better-sqlite3";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {LATEST_MIGRATION_VERSION,runMigrations} from "../../src/core/memory/database/migrations.js";

/**
 * R10 — release readiness evidence. The migration + restore rehearsal
 * (scripts/release-db-rehearsal.mjs) copies the live database with SQLite
 * online backup, runs every migration on the COPY, and asserts the migrated
 * schema reaches the current head version. It previously hard-coded that
 * expected version (8), which silently rotted to 17 as R3–R6 landed; the
 * rehearsal then "passed" against a stale assumption rather than the code.
 *
 * The expected version now comes from LATEST_MIGRATION_VERSION in the migration
 * module itself. These two tests keep the constant honest from both
 * directions: it must equal the highest migrate() call in the file, and the
 * rehearsal script must read it rather than re-declare it.
 */

const REPO=process.cwd();
const migrationsSource=fs.readFileSync(
  path.resolve(REPO,"src","core","memory","database","migrations.ts"),"utf8");

describe("R10 release readiness",()=>{
  it("LATEST_MIGRATION_VERSION equals the highest migrate() call (not a stale constant)",()=>{
    const versions=[...migrationsSource.matchAll(/migrate\(\s*db,\s*(\d+)\s*,/g)]
      .map((match)=>Number(match[1]));
    expect(versions.length,"runMigrations must define at least one migration").toBeGreaterThan(0);
    const highest=Math.max(...versions);
    expect(LATEST_MIGRATION_VERSION,
      `LATEST_MIGRATION_VERSION is ${LATEST_MIGRATION_VERSION} but the highest migrate() call is ${highest}; bump the constant when you add a migration`)
      .toBe(highest);
  });

  it("the rehearsal script reads the exported constant and never re-declares a schema version",()=>{
    const script=fs.readFileSync(
      path.resolve(REPO,"scripts","release-db-rehearsal.mjs"),"utf8");
    expect(script).toContain("LATEST_MIGRATION_VERSION");
    // The old failure mode: a hard-coded expected version inside the script.
    expect(script).not.toMatch(/schemaVersion\s*!==\s*\d+/);
  });

  it("a fresh in-memory database migrates cleanly to the current head",()=>{
    // This is the rehearsal's core promise, executed directly through the same
    // path a brand-new deployment takes: the base schema is created first
    // (applyBaseSchemaMigration), then every incremental migration applies on
    // top of it. A database that has never seen any migration must reach the
    // head version with a consistent schema.
    const db=new Database(":memory:");
    try{
      // pragma("foreign_key_check") only reports violations when FK enforcement
      // is on; the production connection sets this in openAgentDatabase().
      db.pragma("foreign_keys = ON");
      applyBaseSchemaMigration(db);
      runMigrations(db);
      const row=db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version:number};
      expect(row.version).toBe(LATEST_MIGRATION_VERSION);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      // Migrations must be idempotent: running them again changes nothing.
      runMigrations(db);
      const rerun=db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version:number};
      expect(rerun.version).toBe(LATEST_MIGRATION_VERSION);
    }finally{
      db.close();
    }
  });
});
