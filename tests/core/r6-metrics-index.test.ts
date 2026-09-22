import {describe,expect,it} from "vitest";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {runMigrations} from "../../src/core/memory/database/migrations.js";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

const index="idx_tool_calls_task_category_created_at";
describe("R6.04 evidence-based Metrics index migration",()=>{
  it("upgrades an existing v16 SQLite fixture to v17 without changing historical rows",()=>{
    const fixture=createDisposableFixture("r6-index-upgrade");
    try{
      const db=fixture.openDatabase();
      try{
        applyBaseSchemaMigration(db);
        runMigrations(db);
        // Simulate a historical v16 install in this disposable database only.
        db.exec(`DROP INDEX ${index}; DELETE FROM schema_migrations WHERE version=17`);
        db.prepare("INSERT INTO tool_calls(correlation_id,task_id,tool,status,category,created_at) VALUES (?,?,?,?,?,?)")
          .run("r6-existing-audit","task-fixture","read_file","success","workflow","2026-09-21T00:00:00Z");
        const before=(db.prepare("SELECT COUNT(*) AS n FROM tool_calls").get() as {n:number}).n;
        runMigrations(db);
        runMigrations(db);
        expect((db.prepare("SELECT COUNT(*) AS n FROM tool_calls").get() as {n:number}).n).toBe(before);
        expect((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=17").get() as {n:number}).n).toBe(1);
        const columns=(db.prepare(`PRAGMA index_info('${index}')`).all() as Array<{name:string}>).map(x=>x.name);
        expect(columns).toEqual(["task_id","category","created_at"]);
        const plan=db.prepare("EXPLAIN QUERY PLAN SELECT tool FROM tool_calls WHERE created_at<=? AND task_id=? AND category=? ORDER BY created_at DESC LIMIT ? OFFSET ?")
          .all("2026-09-22T00:00:00Z","task-fixture","workflow",50,0) as Array<{detail:string}>;
        expect(plan.map(x=>x.detail).join(" ")).toContain(index);
        expect(db.pragma("quick_check",{simple:true})).toBe("ok");
      }finally{db.close();}
    }finally{fixture.cleanup();}
  });
});
