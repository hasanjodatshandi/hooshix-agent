import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {connectInProcessMcp,json} from "../helpers/in-process-mcp.js";
import {getTaskPlan,saveTaskPlan} from "../../src/core/memory/task-repository.js";
import {persistAppendedTaskSteps} from "../../src/adapters/outbound/persistence/sqlite/repositories/task-tool-persistence.adapter.js";

describe("R3.09 terminal Task append invariants",()=>{
  async function fixture(state:"completed"|"cancelled"|"failed",stepStatus:"completed"|"cancelled"|"failed"|"outcome_unknown"="failed"){
    const mc=await connectInProcessMcp();
    const task=json(await mc.client.callTool({name:"task_create",arguments:{
      title:"R3 append fixture "+randomUUID(),steps:[{action:"read",tool:"read_file",arguments:{path:"README.md"}}],
    }})) as {id:string};
    const plan=getTaskPlan(task.id)!;
    plan.state=state;plan.steps[0].status=stepStatus;
    saveTaskPlan(plan,state);
    return {mc,plan};
  }
  it.each(["completed","cancelled"] as const)("rejects %s append with zero rows changed",async state=>{
    const {mc,plan}=await fixture(state,state==="completed"?"completed":"cancelled");
    try{
      const rejected=await mc.client.callTool({name:"task_append_steps",arguments:{
        taskId:plan.id,steps:[{action:"must not append",tool:"read_file",arguments:{path:"README.md"}}],
      }});
      expect(rejected.isError).toBe(true);
      expect(getTaskPlan(plan.id)).toMatchObject({state,revision:plan.revision??0,
        steps:[{id:1,status:state}]});
      expect(getTaskPlan(plan.id)?.steps).toHaveLength(1);
      expect(()=>persistAppendedTaskSteps(plan.id,1,[{
        id:2,action:"forbidden",tool:"read_file",arguments:{path:"README.md"},
        dependsOn:[1],status:"pending",
      }],plan.revision??0)).toThrow("terminal_task_append_forbidden");
    }finally{await mc.close();}
  });
  it("failed Task can append corrective step atomically, incrementing durable revision",async()=>{
    const {mc,plan}=await fixture("failed","failed");
    try{
      const accepted=json(await mc.client.callTool({name:"task_append_steps",arguments:{
        taskId:plan.id,steps:[{action:"independent correction",tool:"read_file",
          arguments:{path:"README.md"},runWhen:"always"}],
      }})) as {appended:number;revision:number;newState:string};
      expect(accepted).toMatchObject({appended:1,revision:(plan.revision??0)+1,newState:"planning"});
      const updated=getTaskPlan(plan.id)!;
      expect(updated).toMatchObject({state:"planning",revision:(plan.revision??0)+1});
      expect(updated.steps).toHaveLength(2);
      expect(updated.steps[0].status).toBe("failed");
      expect(updated.steps[1]).toMatchObject({id:2,status:"pending",runWhen:"always"});
      expect(()=>persistAppendedTaskSteps(plan.id,1,[{
        id:2,action:"racy append",tool:"read_file",arguments:{path:"README.md"},
        dependsOn:[1],status:"pending",
      }],plan.revision??0)).toThrow();
      expect(getTaskPlan(plan.id)?.steps).toHaveLength(2);
    }finally{await mc.close();}
  });
  it("refuses failed Task whose mutating result remains unknown, before any append",async()=>{
    const {mc,plan}=await fixture("failed","outcome_unknown");
    try{
      const rejected=await mc.client.callTool({name:"task_append_steps",arguments:{
        taskId:plan.id,steps:[{action:"unsafe correction",tool:"read_file",arguments:{path:"README.md"}}],
      }});
      expect(rejected.isError).toBe(true);
      expect(getTaskPlan(plan.id)?.steps).toHaveLength(1);
      expect(getTaskPlan(plan.id)?.steps[0].status).toBe("outcome_unknown");
    }finally{await mc.close();}
  });
});
