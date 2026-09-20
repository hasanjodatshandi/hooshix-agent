import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {createTaskRuntimeService} from "../../src/core/runtime/composition-root.js";
import {getTaskPlan,saveTaskPlan} from "../../src/core/memory/task-repository.js";
import {createTaskPlan} from "../../src/core/planner/task-planner.js";
import {backupAgentDatabase,runMigrations} from "../../src/core/memory/database.js";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

describe("R3.08 canonical Task creation idempotency",()=>{
  const make=(key:string,extra?:{title?:string;path?:string;retry?:number;arguments?:Record<string,unknown>})=>({
    title:extra?.title??"same immutable request",idempotencyKey:key,
    steps:[{action:"inspect",tool:"read_file" as const,
      arguments:extra?.arguments??{path:extra?.path??"README.md"}}],
    retryPolicy:{maxTotalAttempts:extra?.retry??5},
  });
  it("same key and semantically equal request reuses existing Task; telemetry correlation is not payload",()=>{
    const runtime=createTaskRuntimeService(),key=randomUUID();
    const first=runtime.create({...make(key),correlationId:randomUUID()});
    const second=runtime.create({...make(key),correlationId:randomUUID()});
    expect(second.id).toBe(first.id);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(getTaskPlan(first.id)?.requestHash).toBe(first.requestHash);
    expect(first.requestHash).not.toContain("README.md");
  });
  it("object key order and equivalent explicit default dependencies are canonical",()=>{
    const runtime=createTaskRuntimeService(),key=randomUUID();
    const first=runtime.create({...make(key,{arguments:{path:"README.md",nested:{a:1,b:2}}})});
    const second=runtime.create({...make(key,{arguments:{nested:{b:2,a:1},path:"README.md"}})});
    expect(second.id).toBe(first.id);
  });
  it.each([
    [{title:"different title"},"title"],
    [{path:"package.json"},"arguments"],
    [{retry:7},"retryPolicy"],
  ] as const)("same key with changed %s rejects conflict and does not mutate the existing Task",async(change,_label)=>{
    const runtime=createTaskRuntimeService(),key=randomUUID();
    const first=runtime.create(make(key));
    expect(()=>runtime.create(make(key,change))).toThrow("idempotency_key_payload_conflict");
    expect(getTaskPlan(first.id)?.requestHash).toBe(first.requestHash);
    expect(getTaskPlan(first.id)?.steps[0].arguments).toEqual({path:"README.md"});
  });
  it("different captured workspace scope never shares the same-key Task",async()=>{
    const runtime=createTaskRuntimeService(),key=randomUUID();
    const first=runtime.create(make(key));
    const distinct=createTaskPlan("same immutable request",[{
      action:"inspect",tool:"read_file",arguments:{path:"README.md"},
    }]);
    distinct.executionContext={...first.executionContext!,workspace:"D:/not-this-root"};
    distinct.retryPolicy={maxTotalAttempts:5};
    distinct.requestHash=(await import("../../src/infrastructure/composition/r3-task-request-hash.js")).fingerprintTaskCreate(distinct);
    expect(distinct.requestHash).not.toEqual(first.requestHash);
  });
  it("historical keyed Task without a verified request hash fails closed",()=>{
    const runtime=createTaskRuntimeService(),key=randomUUID();
    const plan=createTaskPlan("same immutable request",[{
      action:"inspect",tool:"read_file",arguments:{path:"README.md"},
    }]);
    plan.idempotencyKey=key;
    plan.executionContext=runtime.create(make(randomUUID())).executionContext;
    saveTaskPlan(plan,"planning");
    expect(()=>runtime.create(make(key))).toThrow("idempotency_key_legacy_hash_missing");
    expect(getTaskPlan(plan.id)?.requestHash).toBeUndefined();
  });
  it("new migration on an isolated copied v12 database preserves original rows and keys",async()=>{
    const fixture=createDisposableFixture("r3key");
    const runtime=createTaskRuntimeService(),existing=runtime.create(make(randomUUID()));
    try{
      await backupAgentDatabase(fixture.sqlitePath);
      const db=fixture.openDatabase();
      try{
        db.prepare("DELETE FROM schema_migrations WHERE version=13").run();
        db.exec("ALTER TABLE tasks DROP COLUMN request_hash");
        const before=db.prepare("SELECT id,idempotency_key,title FROM tasks WHERE id=?").get(existing.id);
        runMigrations(db);
        expect(db.prepare("SELECT version FROM schema_migrations WHERE version=13").get()).toBeTruthy();
        expect(db.prepare("SELECT id,idempotency_key,title FROM tasks WHERE id=?").get(existing.id)).toEqual(before);
        expect((db.prepare("SELECT request_hash FROM tasks WHERE id=?").get(existing.id) as {request_hash:string|null}).request_hash).toBeNull();
      }finally{db.close();}
    }finally{fixture.cleanup();}
  });
});
