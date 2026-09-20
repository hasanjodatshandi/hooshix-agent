import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {createTaskRuntimeService} from "../../src/core/runtime/composition-root.js";
import {getTaskPlan,findInterruptedTasks,saveTaskPlan} from "../../src/core/memory/task-repository.js";
import {getResumableTasks} from "../../src/core/memory/resume-memory.js";
import {restoreInterruptedTasks} from "../../src/core/recovery/startup-recovery.js";
import {createApprovalRequest} from "../../src/core/governance/approval-memory.js";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {backupAgentDatabase,runMigrations} from "../../src/core/memory/database.js";

describe("R3.01 canonical Task aggregate hydration",()=>{
  it("preserves every currently persisted non-default Task and Step field in normal, report, resume and crash discovery",()=>{
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({
      title:"R3 full semantic aggregate",description:"Canonical repository round-trip",
      correlationId:randomUUID(),idempotencyKey:randomUUID(),
      retryPolicy:{maxTotalAttempts:9,maxConsecutiveFailures:4},
      steps:[
        {action:"original source",tool:"get_system_info",arguments:{},runWhen:"always",timeout:17000},
        {action:"dependent read",tool:"read_file",arguments:{path:"README.md"},dependsOn:[1],runWhen:"failure",timeout:4321},
      ],
    });
    plan.maxRecovery=3;
    plan.totalRunCount=6;
    plan.revision=7;
    plan.state="executing";
    plan.steps[0].status="completed";
    plan.steps[0].output={memory:{bytes:123},nested:["a","b"]};
    plan.steps[0].attempts=2;
    plan.steps[0].failedAttempts=1;
    plan.steps[0].attemptHistory=[{attempt:1,status:"failed",error:"transient",timestamp:"2026-09-20T00:00:00.000Z"},
      {attempt:2,status:"completed",timestamp:"2026-09-20T00:00:01.000Z"}];
    plan.steps[1].status="running";
    plan.steps[1].templateArguments={path:"{{step1.output.path}}"};
    plan.steps[1].attempts=4;
    plan.steps[1].failedAttempts=2;
    plan.steps[1].attemptHistory=[{attempt:3,status:"failed",error:"interrupted",timestamp:"2026-09-20T00:00:02.000Z"}];
    plan.steps[1].error="last failure";
    plan.steps[1].errorType="NETWORK";
    saveTaskPlan(plan,"executing",plan.correlationId);

    const normal=getTaskPlan(plan.id)!;
    expect(normal).toBeTruthy();
    expect(normal).toMatchObject({
      id:plan.id,task:plan.task,description:plan.description,
      correlationId:plan.correlationId,idempotencyKey:plan.idempotencyKey,
      state:"executing",maxRecovery:3,totalRunCount:6,revision:7,
      retryPolicy:{maxTotalAttempts:9,maxConsecutiveFailures:4},
      executionContext:plan.executionContext,
      steps:plan.steps,
    });
    expect(normal.createdAt).toMatch(/^20\d\d-/);
    expect(normal.updatedAt).toMatch(/^20\d\d-/);
    const interrupted=findInterruptedTasks().find(row=>row.id===plan.id);
    const resumable=getResumableTasks().find(row=>row.id===plan.id);
    const startup=restoreInterruptedTasks().find(row=>row.task.id===plan.id);
    const reported=runtime.report(plan.id).task;
    expect(interrupted).toEqual(normal);
    expect(resumable).toEqual(normal);
    expect(startup?.task).toEqual(normal);
    expect(reported).toEqual(normal);
  });

  it("migrates a disposable copy of a version-9 Task DB without changing historical Task records",async()=>{
    const fixture=createDisposableFixture("r3-migrate");
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"R3 v9 historical record",idempotencyKey:randomUUID(),
      steps:[{action:"existing read",tool:"get_system_info",arguments:{}}]});
    try {
      await backupAgentDatabase(fixture.sqlitePath);
      const db=fixture.openDatabase();
      try {
        // Emulate the supported v9 schema ONLY on the isolated DB backup.
        db.exec("ALTER TABLE tasks DROP COLUMN task_revision");
        db.prepare("DELETE FROM schema_migrations WHERE version=10").run();
        const prior=db.prepare("SELECT title,description,status,idempotency_key FROM tasks WHERE id=?")
          .get(plan.id);
        expect(prior).toBeTruthy();
        runMigrations(db);
        expect(db.prepare("SELECT version FROM schema_migrations WHERE version=10").get()).toBeTruthy();
        const column=(db.prepare("PRAGMA table_info(tasks)").all() as Array<{name:string}>)
          .find(row=>row.name==="task_revision");
        expect(column).toBeDefined();
        expect(db.prepare("SELECT title,description,status,idempotency_key FROM tasks WHERE id=?")
          .get(plan.id)).toEqual(prior);
        expect((db.prepare("SELECT task_revision FROM tasks WHERE id=?").get(plan.id) as {task_revision:number}).task_revision).toBe(0);
      }finally{db.close();}
    }finally{fixture.cleanup();}
  });

  it("uses exactly the same persisted pending-approval metadata in normal and crash hydration",()=>{
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"R3 approval mapper",steps:[{
      action:"await human",tool:"delete_file",arguments:{path:"never-executed"},status:"pending_approval",
    }]});
    plan.state="waiting_approval";
    saveTaskPlan(plan,"waiting_approval");
    const approvalId=createApprovalRequest({taskId:plan.id,stepId:1,action:"await human",
      risk:"critical",reason:"human approval required",correlationId:plan.correlationId});
    const normal=getTaskPlan(plan.id)!;
    expect(normal.pendingApproval).toMatchObject({
      approvalId,stepId:1,action:"await human",risk:"critical",reason:"human approval required",
    });
    expect(findInterruptedTasks().find(row=>row.id===plan.id)).toEqual(normal);
    expect(getResumableTasks().find(row=>row.id===plan.id)).toEqual(normal);
    expect(restoreInterruptedTasks().find(row=>row.task.id===plan.id)?.task).toEqual(normal);
    expect(runtime.get(plan.id)).toEqual(normal);
  });
});