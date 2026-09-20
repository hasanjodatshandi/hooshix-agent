import {describe,expect,it} from "vitest";
import {createTaskPlan} from "../../src/core/planner/task-planner.js";
import {createMutationReceipt} from "../../src/core/loop/execution-receipt.js";
import {beginStepExecutionReceipt,getTaskPlan,saveTaskPlan,listStepExecutionReceipts} from "../../src/core/memory/task-repository.js";
import {recoverInterruptedTasks} from "../../src/core/recovery/crash-recovery.js";
import {acquireTaskLease,releaseTaskLease} from "../../src/core/memory/task-lease.js";

describe("R3.06 crash receipt reconciliation",()=>{
  it("does not corrupt or replay a still-running Task owned by another live process",async()=>{
    const plan=createTaskPlan("live owner cannot be hijacked by startup recovery",[
      {action:"external effect still running",tool:"write_file",
        arguments:{path:"tests/never-create.txt",content:"NO EFFECT"}},
    ]);
    plan.steps[0].status="running";plan.steps[0].attempts=1;
    saveTaskPlan(plan,"executing");
    const intent=createMutationReceipt(plan.steps[0],"write_file")!;
    beginStepExecutionReceipt(plan.id,plan.steps[0],0,intent);
    const lease=acquireTaskLease(plan.id,"other-live-process",5000);
    try{
      const recovered=await recoverInterruptedTasks();
      expect(recovered.find(x=>x.taskId===plan.id)).toMatchObject({status:"skipped"});
      expect(getTaskPlan(plan.id)).toMatchObject({state:"executing",
        steps:[{status:"running",attempts:1}]});
      expect(listStepExecutionReceipts(plan.id,1)).toMatchObject([{
        executionId:intent.executionId,status:"started",
      }]);
    }finally{releaseTaskLease(lease);}
    const recoveredAfterRelease=await recoverInterruptedTasks();
    expect(recoveredAfterRelease.find(x=>x.taskId===plan.id)?.status).toBe("failed");
    expect(getTaskPlan(plan.id)?.steps[0].status).toBe("outcome_unknown");
    expect(listStepExecutionReceipts(plan.id,1)[0].status).toBe("outcome_unknown");
  });

  it("converts persisted STARTED mutation into durable UNKNOWN exactly once, without replay",async()=>{
    const plan=createTaskPlan("crash after effect",[
      {action:"fixture effect",tool:"write_file",arguments:{path:"tests/never-create.txt",content:"NEVER"}},
      {action:"later step",tool:"get_system_info",arguments:{}},
    ]);
    plan.steps[0].status="running";plan.steps[0].attempts=1;
    saveTaskPlan(plan,"executing");
    const intent=createMutationReceipt(plan.steps[0],"write_file")!;
    beginStepExecutionReceipt(plan.id,plan.steps[0],0,intent);
    const first=await recoverInterruptedTasks();
    expect(first.find(result=>result.taskId===plan.id)).toMatchObject({status:"failed"});
    const saved=getTaskPlan(plan.id)!;
    expect(saved.state).toBe("failed");
    expect(saved.steps[0].status).toBe("outcome_unknown");
    expect(saved.steps[0].attempts).toBe(1);
    expect(saved.steps[1].status).toBe("pending");
    expect(listStepExecutionReceipts(plan.id,1)).toMatchObject([{
      executionId:intent.executionId,status:"outcome_unknown",
      termination:"unknown",reconciliation:"unresolved"
    }]);
    expect((await recoverInterruptedTasks()).some(entry=>entry.taskId===plan.id)).toBe(false);
  });
  it("refuses to infer mutating effect success from a finished receipt when Task step is still running",async()=>{
    const plan=createTaskPlan("crash after receipt finalization",[
      {action:"effect finalized before step persisted",tool:"write_file",arguments:{path:"tests/never-create.txt",content:"NEVER"}},
    ]);
    plan.steps[0].status="running";plan.steps[0].attempts=1;saveTaskPlan(plan,"executing");
    const intent=createMutationReceipt(plan.steps[0],"write_file")!;
    beginStepExecutionReceipt(plan.id,plan.steps[0],0,intent);
    const {finishStepExecutionReceipt}=await import("../../src/core/memory/task-repository.js");
    const {finalizeMutationReceipt}=await import("../../src/core/loop/execution-receipt.js");
    finishStepExecutionReceipt(plan.id,finalizeMutationReceipt(intent,"succeeded",{sha256:"a".repeat(64)}));
    await recoverInterruptedTasks();
    const saved=getTaskPlan(plan.id)!;
    expect(saved.state).toBe("failed");
    expect(saved.steps[0].status).toBe("outcome_unknown");
    expect(saved.steps[0].lastReceipt?.status).toBe("succeeded");
  });
  it("continues read-only interrupted operations but not historical operations with missing Tool ID",async()=>{
    const readable=createTaskPlan("interrupted read",[
      {action:"read",tool:"get_system_info",arguments:{}}]);
    readable.steps[0].status="running";saveTaskPlan(readable,"executing");
    const historical=createTaskPlan("unclassified old operation",[
      {action:"some old effect",arguments:{}}]);
    historical.steps[0].status="running";saveTaskPlan(historical,"executing");
    const recovered=await recoverInterruptedTasks();
    expect(recovered.find(row=>row.taskId===readable.id)?.status).toBe("recovered");
    expect(getTaskPlan(readable.id)?.steps[0].status).toBe("completed");
    expect(recovered.find(row=>row.taskId===historical.id)?.status).toBe("failed");
    expect(getTaskPlan(historical.id)?.steps[0].status).toBe("outcome_unknown");
  });
});