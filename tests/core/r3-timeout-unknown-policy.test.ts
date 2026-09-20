import {randomUUID} from "node:crypto";
import {describe,expect,it,afterEach} from "vitest";
import {createTaskPlan} from "../../src/core/planner/task-planner.js";
import {runClosedAgentLoop} from "../../src/core/loop/closed-agent-loop.js";
import {getTaskPlan,saveTaskPlan,listStepExecutionReceipts} from "../../src/core/memory/task-repository.js";
import {createTaskRuntimeService} from "../../src/core/runtime/composition-root.js";

const previous=process.env.HOOSHIX_TERMINATION_GRACE_MS;
afterEach(()=>{if(previous===undefined)delete process.env.HOOSHIX_TERMINATION_GRACE_MS;
  else process.env.HOOSHIX_TERMINATION_GRACE_MS=previous;});
function plan(){
  const result=createTaskPlan("R3 handshake fixture",[
    {action:"fixture mutate",tool:"write_file",arguments:{path:"tests/R3_NEVER_WRITTEN",content:"fixture"},timeout:10},
    {action:"must not execute after uncertain effect",tool:"get_system_info",arguments:{}},
  ]);
  result.id=randomUUID();saveTaskPlan(result,"planning");return result;
}
describe("R3.03 and R3.04 bounded termination and fail-closed unknown policy",()=>{
  it("waits for delayed tool acknowledgement after cancellation; treats observed completion as success without a second invocation",async()=>{
    process.env.HOOSHIX_TERMINATION_GRACE_MS="130";
    const task=plan();let calls=0;let settled=false;
    const outcome=await runClosedAgentLoop(task,async()=>{
      calls++;await new Promise<void>(resolve=>setTimeout(resolve,50));
      settled=true;return {ok:true};
    },2);
    expect(settled).toBe(true);
    expect(outcome.status).toBe("completed");
    expect(calls).toBe(2); // one mutation and one subsequent read-only operation
    expect(listStepExecutionReceipts(task.id,1)[0].status).toBe("succeeded");
  },2000);
  it("unacknowledged cancellation uses bounded grace and never retries/executes a later step even if maxRecovery is positive",async()=>{
    process.env.HOOSHIX_TERMINATION_GRACE_MS="25";
    const task=plan();let mutated=0;let readonly=0;let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    try{
      const started=Date.now();
      const result=await runClosedAgentLoop(task,async(tool)=>{
        if(tool==="write_file"){mutated++;await pending;return {ok:true};}
        readonly++;return {};
      },2);
      expect(Date.now()-started).toBeGreaterThanOrEqual(25);
      expect(mutated).toBe(1);
      expect(readonly).toBe(0);
      expect(result.status).toBe("failed");
      expect(result.reason).toBe("outcome_unknown_requires_reconciliation");
      const stored=getTaskPlan(task.id)!;
      expect(stored.steps[0].status).toBe("outcome_unknown");
      expect(stored.steps[0].attempts).toBe(1);
      expect(stored.steps[0].lastReceipt).toMatchObject({status:"outcome_unknown",
        termination:"unknown",reconciliation:"unresolved"});
      const second=await runClosedAgentLoop(stored,async()=>{mutated++;return {};},2);
      expect(second.status).toBe("failed");
      expect(mutated).toBe(1);
      expect(getTaskPlan(task.id)!.steps[0].attempts).toBe(1);
    }finally{release();}
  },2500);
  it("aborted adapter rejecting after timeout still does not prove mutation failed without effect",async()=>{
    process.env.HOOSHIX_TERMINATION_GRACE_MS="130";
    const task=plan();let calls=0;
    const result=await runClosedAgentLoop(task,async()=>{
      calls++;await new Promise<void>((_,reject)=>setTimeout(()=>reject(Error("cancelled")),30));
      return {};
    },2);
    expect(result.status).toBe("failed");
    expect(calls).toBe(1);
    expect(result.plan.steps[0].lastReceipt).toMatchObject({status:"outcome_unknown",termination:"unknown"});
  },2500);
  it("Task runtime refuses an unknown mutation even when a later pending step exists",async()=>{
    const service=createTaskRuntimeService();
    const task=service.create({title:"R3 runtime fail-closed",steps:[
      {action:"fixture mutation",tool:"write_file",
        arguments:{path:"tests/R3_NEVER_WRITTEN",content:"fixture"}},
      {action:"must not execute",tool:"get_system_info",arguments:{}},
    ]});
    task.state="failed";task.steps[0].status="outcome_unknown";
    saveTaskPlan(task,"failed");
    await expect(service.run(task.id,2)).rejects.toThrow(/outcome_unknown|reconciliation/i);
    expect(getTaskPlan(task.id)?.steps[1].status).toBe("pending");
  });
  it("invalid termination grace config fails closed before dispatch",async()=>{
    process.env.HOOSHIX_TERMINATION_GRACE_MS="broken";
    const task=plan();let calls=0;
    const result=await runClosedAgentLoop(task,async()=>{calls++;return{};},0);
    expect(calls).toBe(0);
    expect(result.status).toBe("failed");
  });
});