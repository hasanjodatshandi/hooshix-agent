import fs from "node:fs";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {openAgentDatabase,resetAgentDatabase} from "../../src/core/memory/database/index.js";

/**
 * H3 — a deleted database file must NOT be silently re-created. The old logic
 * treated "file absent" as "first run" unconditionally, so deleting the
 * database of a running (or restarted) process produced a fresh EMPTY database
 * and a green readiness probe while every task, grant and audit row was gone —
 * a total, quiet data loss reported as healthy.
 *
 * The fix is a companion .identity marker: it is written when a database is
 * initialized here, and a subsequent open that finds the marker but no database
 * fails loudly instead of fabricating an empty one.
 */
describe("H3 removed database is not silently re-created",()=>{
  const dbPath=path.resolve("data",`h3-identity-${process.env.VITEST_WORKER_ID??"single"}.db`);
  const identityPath=`${dbPath}.identity`;
  // The global setup owns HOOSHIX_DB_PATH (it points every worker at an isolated
  // tree). This suite repoints it at a scratch fixture; the previous afterEach
  // DELETED the variable, so the global beforeEach that ran before the next test
  // reopened the database at the default ./data/agent-memory.db — the LIVE
  // production database — and ran migrations and workspace-root writes on it.
  // Restore, never delete.
  const inheritedDbPath=process.env.HOOSHIX_DB_PATH;

  function wipe():void{
    for(const suffix of ["","-wal","-shm",".identity"]) fs.rmSync(dbPath+suffix,{force:true});
  }

  beforeEach(()=>{
    wipe();
    process.env.HOOSHIX_DB_PATH=dbPath;
    // The global setup resets the shared handle too, but this test changes the
    // DB path AFTER that reset, and the previous worker-wide open (at the
    // setup's path) must not be handed back as a cache hit here.
    resetAgentDatabase();
  });
  afterEach(()=>{
    resetAgentDatabase();
    if(inheritedDbPath===undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH=inheritedDbPath;
    wipe();
  });

  it("initializes a brand-new database and leaves an identity marker",()=>{
    const db=openAgentDatabase();
    expect(db.prepare("SELECT 1 AS ok").get()).toEqual({ok:1});
    expect(fs.existsSync(identityPath)).toBe(true);
  });

  it("re-opens an existing database normally",()=>{
    openAgentDatabase().prepare("CREATE TABLE h3_probe (id INTEGER PRIMARY KEY)").run();
    openAgentDatabase().prepare("INSERT INTO h3_probe (id) VALUES (1)").run();
    resetAgentDatabase();   // drop the cached handle, keep the files
    const db=openAgentDatabase();
    expect(db.prepare("SELECT count(*) AS n FROM h3_probe").get()).toEqual({n:1});
  });

  it("fails loudly when the database file is removed after initialization",()=>{
    openAgentDatabase();                 // initialize + marker
    resetAgentDatabase();                // release the handle
    fs.rmSync(dbPath);                   // simulate an operator/backup mistake
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(()=>openAgentDatabase()).toThrow(/removed after initialization/i);
    // And it must NOT have fabricated a replacement database.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("allows an explicit acknowledgement to reinitialize",()=>{
    openAgentDatabase();
    resetAgentDatabase();
    fs.rmSync(dbPath);
    expect(()=>openAgentDatabase()).toThrow(/removed after initialization/i);
    // Deleting the marker is the operator's explicit "I accept the loss".
    fs.rmSync(identityPath);
    const db=openAgentDatabase();
    expect(db.prepare("SELECT 1 AS ok").get()).toEqual({ok:1});
  });
});
