import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { getTaskPlan, saveTaskPlan, listStepExecutionReceipts } from "../../src/core/memory/task-repository.js";
import { backupAgentDatabase, runMigrations } from "../../src/core/memory/database.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

describe("R3.02 durable mutation execution receipts",()=>{
  const mutation=()=>createTaskPlan("receipt fixture",[{action:"fixture write",tool:"write_file",
    arguments:{path:"tests/receipt-marker-DO-NOT-CREATE",content:"SECRET_TEST_SENTINEL"},timeout:1000}]);

  it("persists an intent before the side effect, then finalizes a truthful receipt and hydrates the same metadata everywhere",async()=>{
    const plan=mutation();saveTaskPlan(plan,"planning");
    let dispatched=0;
    const finished=await runClosedAgentLoop(plan,async()=>{
      dispatched++;
      const during=getTaskPlan(plan.id)!.steps[0].lastReceipt!;
      expect(during.status).toBe("started");
      expect(during.finishedAt).toBeUndefined();
      expect(during.executionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(during.effect).toBe("non_idempotent_mutation");
      expect(during.effectId).toBe(during.executionId);
      expect(listStepExecutionReceipts(plan.id,1)).toEqual([during]);
      return {path:"tests/receipt-marker-DO-NOT-CREATE",sha256:"a".repeat(64)};
    },0);
    expect(dispatched).toBe(1);
    expect(finished.status).toBe("completed");
    const receipt=getTaskPlan(plan.id)!.steps[0].lastReceipt!;
    expect(receipt).toMatchObject({status:"succeeded",termination:"completed",
      reconciliation:"not_required",postconditionRevision:"a".repeat(64)});
    expect(Date.parse(receipt.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(receipt.startedAt));
    expect(listStepExecutionReceipts(plan.id,1)).toEqual([receipt]);
    expect(JSON.stringify(receipt)).not.toContain("SECRET_TEST_SENTINEL");
    expect(finished.plan.steps[0].lastReceipt).toEqual(receipt);
  });

  it("records known failure with explicit outcome while retaining the preceding intent and no synthetic success",async()=>{
    const plan=mutation();saveTaskPlan(plan,"planning");
    const result=await runClosedAgentLoop(plan,async()=>{throw new Error("fixture failed");},0);
    expect(result.status).toBe("failed");
    const receipt=getTaskPlan(plan.id)!.steps[0].lastReceipt!;
    expect(receipt).toMatchObject({status:"failed_known",termination:"completed",reconciliation:"not_required"});
    expect(receipt.finishedAt).toBeTruthy();
    expect(listStepExecutionReceipts(plan.id,1)).toHaveLength(1);
  });

  it("marks timed-out mutation as unknown without claiming termination, preserves receipt for reconciliation",async()=>{
    const previousGrace=process.env.HOOSHIX_TERMINATION_GRACE_MS;
    process.env.HOOSHIX_TERMINATION_GRACE_MS="15";
    const plan=mutation();plan.steps[0].timeout=8;saveTaskPlan(plan,"planning");
    let settle!:()=>void;
    const underlying=new Promise<void>(resolve=>{settle=resolve;});
    const result=await runClosedAgentLoop(plan,async()=>{await underlying;return {notProven:true};},0);
    expect(result.plan.steps[0].status).toBe("outcome_unknown");
    const receipt=getTaskPlan(plan.id)!.steps[0].lastReceipt!;
    expect(receipt).toMatchObject({status:"outcome_unknown",termination:"unknown",reconciliation:"unresolved"});
    expect(receipt.finishedAt).toBeTruthy();
    settle();
    if(previousGrace===undefined)delete process.env.HOOSHIX_TERMINATION_GRACE_MS;
    else process.env.HOOSHIX_TERMINATION_GRACE_MS=previousGrace;
  });

  it("preserves every previous attempt receipt independently, including after normal plan saves",async()=>{
    const plan=mutation();saveTaskPlan(plan,"planning");
    await runClosedAgentLoop(plan,async()=>{throw Error("first");},0);
    const first=getTaskPlan(plan.id)!.steps[0].lastReceipt!;
    const again=getTaskPlan(plan.id)!;
    again.steps[0].status="pending";
    again.state="planning";
    saveTaskPlan(again,"planning");
    await runClosedAgentLoop(again,async()=>({ok:true}),0);
    const receipts=listStepExecutionReceipts(plan.id,1);
    expect(receipts).toHaveLength(2);
    expect(receipts.map(r=>r.executionId)).toEqual([first.executionId,expect.any(String)]);
    expect(receipts[1].executionId).not.toBe(first.executionId);
    expect(receipts.map(r=>r.status)).toEqual(["failed_known","succeeded"]);
    expect(getTaskPlan(plan.id)!.steps[0].lastReceipt).toEqual(receipts[1]);
  });

  it("does not record a mutation effect before a human approval is granted",async()=>{
    const plan=createTaskPlan("approval receipt",[{action:"remove fixture",tool:"delete_file",
      arguments:{path:"tests/receipt-marker-DO-NOT-CREATE"}}]);
    saveTaskPlan(plan,"planning");
    const result=await runClosedAgentLoop(plan,async()=>{throw Error("must not dispatch");},0);
    expect(result.status).toBe("pending_approval");
    expect(getTaskPlan(plan.id)!.steps[0].lastReceipt).toBeUndefined();
    expect(listStepExecutionReceipts(plan.id,1)).toEqual([]);
  });

  it("does not manufacture an execution receipt when mutation template resolution fails before dispatch",async()=>{
    const plan=createTaskPlan("template receipt",[
      {action:"source",tool:"get_system_info",arguments:{}},
      {action:"unresolved fixture",tool:"write_file",dependsOn:[1],
        arguments:{path:"tests/receipt-marker-DO-NOT-CREATE",content:"{{step1.output.missing}}"}},
    ]);
    saveTaskPlan(plan,"planning");
    let mutationDispatched=false;
    const result=await runClosedAgentLoop(plan,async(tool)=>{
      if(tool==="write_file")mutationDispatched=true;
      return {present:"different property"};
    },0);
    expect(result.status).toBe("failed");
    expect(mutationDispatched).toBe(false);
    expect(listStepExecutionReceipts(plan.id,2)).toEqual([]);
  });

  it("prevents receipt completion twice or with a forged execution identity",async()=>{
    const plan=mutation();saveTaskPlan(plan,"planning");
    await runClosedAgentLoop(plan,async()=>({ok:true}),0);
    const receipt=listStepExecutionReceipts(plan.id,1)[0];
    const repo=await import("../../src/core/memory/task-repository.js");
    expect(()=>repo.finishStepExecutionReceipt(plan.id,receipt)).toThrow(
      "execution_receipt_not_started_or_identity_mismatch");
    expect(()=>repo.finishStepExecutionReceipt(plan.id,{
      ...receipt,executionId:randomUUID() as typeof receipt.executionId,
    })).toThrow("execution_receipt_not_started_or_identity_mismatch");
    expect(listStepExecutionReceipts(plan.id,1)).toEqual([receipt]);
  });

  it("rejects a second attempt with the same task/step/attempt number BEFORE any effect",async()=>{
    const plan=mutation();saveTaskPlan(plan,"planning");
    await runClosedAgentLoop(plan,async()=>({ok:true}),0);
    const first=listStepExecutionReceipts(plan.id,1)[0];
    const repo=await import("../../src/core/memory/task-repository.js");
    const duplicate={...first,
      executionId:randomUUID() as typeof first.executionId,
      effectId:randomUUID(),startedAt:new Date().toISOString(),
      finishedAt:undefined,status:"started" as const,
      reconciliation:"unresolved" as const,termination:undefined,postconditionRevision:undefined,
    };
    const step=getTaskPlan(plan.id)!.steps[0];
    step.status="running";
    expect(()=>repo.beginStepExecutionReceipt(plan.id,step,0,duplicate)).toThrow();
    expect(getTaskPlan(plan.id)!.steps[0].status).toBe("completed");
    expect(listStepExecutionReceipts(plan.id,1)).toEqual([first]);
  });

  it("records the canonical selected tool when an older Task step omitted tool metadata",async()=>{
    const plan=createTaskPlan("legacy tool selector",[{action:"implement write replace",
      arguments:{path:"tests/receipt-marker-DO-NOT-CREATE",content:"fixture"}}]);
    saveTaskPlan(plan,"planning");
    let selected="";
    const result=await runClosedAgentLoop(plan,async(tool)=>{selected=tool;return {ok:true};},0);
    expect(result.status).toBe("completed");
    expect(selected).toBe("write_file");
    expect(getTaskPlan(plan.id)!.steps[0].lastReceipt?.toolId).toBe("write_file");
    expect(listStepExecutionReceipts(plan.id,1)).toHaveLength(1);
  });

  it("never creates a mutation receipt for read-only tools",async()=>{
    const plan=createTaskPlan("read",[{action:"read",tool:"get_system_info",arguments:{}}]);
    saveTaskPlan(plan,"planning");
    const result=await runClosedAgentLoop(plan,async()=>({ok:true}),0);
    expect(result.status).toBe("completed");
    expect(getTaskPlan(plan.id)!.steps[0].lastReceipt).toBeUndefined();
    expect(listStepExecutionReceipts(plan.id,1)).toEqual([]);
  });

  it("migrates a disposable copy from v10, preserving task rows and adding immutable receipt history",async()=>{
    const fixture=createDisposableFixture("r3receipt");
    const plan=mutation();plan.id=randomUUID();saveTaskPlan(plan,"planning");
    try{
      await backupAgentDatabase(fixture.sqlitePath);
      const db=fixture.openDatabase();
      try{
        db.prepare("DELETE FROM schema_migrations WHERE version=11").run();
        db.exec("DROP TABLE IF EXISTS execution_receipts");
        const old=db.prepare("SELECT title,status,task_revision FROM tasks WHERE id=?").get(plan.id);
        runMigrations(db);
        expect(db.prepare("SELECT version FROM schema_migrations WHERE version=11").get()).toBeTruthy();
        expect(db.prepare("SELECT title,status,task_revision FROM tasks WHERE id=?").get(plan.id)).toEqual(old);
        expect((db.prepare("SELECT COUNT(*) AS n FROM execution_receipts").get() as {n:number}).n).toBe(0);
      }finally{db.close();}
    }finally{fixture.cleanup();}
  });
});