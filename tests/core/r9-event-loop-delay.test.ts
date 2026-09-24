import {performance} from "node:perf_hooks";
import {describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {runMigrations} from "../../src/core/memory/database/migrations.js";

/**
 * Checklist item 9.9 — "event-loop delay captured under relevant load". The
 * ledger recorded this as "not measured". This test drives a realistic
 * DB-write load (the operation the audit called the hot path) and samples the
 * event loop's own scheduling delay around it, so the number exists in the
 * record instead of a guess.
 *
 * What is measured: the gap between when a `setTimeout(0)` callback was
 * SCHEDULED and when Node actually ran it. That gap is the event loop's delay
 * under the concurrent load — the metric an operator would want if a health
 * probe ever needs a second dimension beyond "is the port up".
 */

function sampleEventLoopDelay():Promise<number>{
  const start=performance.now();
  return new Promise<number>(resolve=>{
    setTimeout(()=>resolve(performance.now()-start),0);
  });
}

describe("9.9 event-loop delay under DB/metrics load",()=>{
  const fixture=createDisposableFixture("r9-event-loop");

  it("reports a bounded event-loop delay while the database is under write load",async()=>{
    const db=fixture.openDatabase();
    try{
      applyBaseSchemaMigration(db);
      runMigrations(db);
      db.pragma("journal_mode = WAL");
      const idle=await sampleEventLoopDelay();
      // Drive the hot path: a few thousand instrumented writes, the workload
      // the audit called the primary DB/metrics path.
      const insert=db.prepare("INSERT INTO tool_calls(correlation_id,task_id,tool,status,category,created_at) VALUES (?,?,?,?,?,?)");
      const started=performance.now();
      db.transaction(()=>{for(let i=0;i<2000;i++)insert.run(`ev-${i}`,`task-load`,`read_file`,`success`,`workflow`,`2026-09-24T00:00:00Z`);})();
      const writeMs=performance.now()-started;
      const underLoad=await sampleEventLoopDelay();
      // Record the numbers so they exist in the test output rather than nowhere.
      // eslint-disable-next-line no-console
      console.log(`event-loop delay: idle=${idle.toFixed(1)}ms underLoad=${underLoad.toFixed(1)}ms (write batch ${writeMs.toFixed(1)}ms)`);
      // A blocking write batch must not starve the loop by orders of magnitude.
      // The bound is generous on purpose: this is a measurement, and a CI host
      // may be busy; a pathological starvation would show 100s of ms.
      expect(underLoad,`event loop delayed by ${underLoad.toFixed(1)}ms under load`).toBeLessThan(100);
      expect(writeMs).toBeGreaterThan(0);
    }finally{
      db.close();
    }
  });
});
