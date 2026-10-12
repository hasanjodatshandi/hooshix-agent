import { describe, expect, it } from "vitest";
import { fingerprintTaskEffect } from "../../src/core/governance/r2-approval-fingerprint.js";
import { resumeApprovedTask } from "../../src/core/loop/resume-orchestrator.js";
import { approveRequest, createApprovalRequest, getApprovalRequest } from "../../src/core/governance/approval-memory.js";
import { saveCheckpoint } from "../../src/core/memory/checkpoint-memory.js";
import type { TaskExecutionContext, TaskPlan } from "../../src/application/dto/legacy-task-plan.js";

// A bootstrap context with NO active workspace — the state a fresh connection
// is in before any project is selected. Roots snapshot is the current pool.
const noWorkspace:TaskExecutionContext = {
  principalId:"p1",sessionId:"s1",workspace:null,roots:[],allowedRootsSnapshot:[],unrestricted:false,
};
const withWorkspace=(workspace:string):TaskExecutionContext => ({...noWorkspace,workspace});
const base=(over:Partial<Parameters<typeof fingerprintTaskEffect>[0]>)=>({
  taskId:"t1",stepId:1,action:"act",toolId:"add_workspace_roots",args:{paths:["D:/new"]},context:noWorkspace,...over,
});

describe("approval fingerprint workspace-independence (bootstrap dead-end fix)",()=>{
  it("fingerprints workspace-pool control tools with no active workspace instead of throwing",()=>{
    for(const toolId of ["add_workspace_roots","remove_workspace_root","set_workspace"]){
      expect(()=>fingerprintTaskEffect(base({toolId}))).not.toThrow();
      expect(fingerprintTaskEffect(base({toolId}))).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("is deterministic and still bound to the pool snapshot + args",()=>{
    const a=fingerprintTaskEffect(base({}));
    expect(a).toBe(fingerprintTaskEffect(base({})));
    // Different roots snapshot (pool changed) => different grant identity.
    expect(fingerprintTaskEffect(base({context:{...noWorkspace,allowedRootsSnapshot:["D:/other"]}}))).not.toBe(a);
    // Different argument payload => different grant identity (no replay).
    expect(fingerprintTaskEffect(base({args:{paths:["D:/evil"]}}))).not.toBe(a);
  });
  it("still requires a workspace for real filesystem effects",()=>{
    expect(()=>fingerprintTaskEffect(base({toolId:"delete_file",args:{path:"a.txt"}})))
      .toThrow("approval_effect_identity_incomplete");
    // Same tool succeeds once an active workspace exists.
    expect(()=>fingerprintTaskEffect(base({toolId:"delete_file",args:{path:"a.txt"},context:withWorkspace("D:/proj")})))
      .not.toThrow();
  });
  it("still rejects a missing principal or session even for control tools",()=>{
    expect(()=>fingerprintTaskEffect(base({context:{...noWorkspace,principalId:undefined}})))
      .toThrow("approval_effect_identity_incomplete");
  });
});

/** The dead end itself: a Task created with no active workspace used to produce a
 *  NULL fingerprint, so task_approve → task_resume could never run. */
describe("approval bootstrap resume (no active workspace)",()=>{
  function bootstrapPlan(taskId:string):TaskPlan {
    return {
      id:taskId,task:"grant my first project",state:"waiting_approval",
      executionContext:{...noWorkspace,principalId:"local-stdio",sessionId:"local-stdio-session"},
      steps:[{id:1,action:"Add project root",tool:"add_workspace_roots",status:"pending",arguments:{paths:["D:/projects/app-a"]}}],
    };
  }
  function approved(taskId:string,plan:TaskPlan):number {
    const correlationId="bootstrap-corr-"+taskId;
    saveCheckpoint({taskId,stepId:1,stepIndex:0,state:{status:"pending_approval"},correlationId});
    const context=plan.executionContext!;
    const approvalId=createApprovalRequest({
      taskId,stepId:1,action:"Add project root",toolId:"add_workspace_roots",
      risk:"high",reason:"pool change",correlationId,
      requestFingerprint:fingerprintTaskEffect({
        taskId,stepId:1,action:"Add project root",toolId:"add_workspace_roots",
        args:plan.steps[0]!.arguments,context,
      }),
      principalId:context.principalId,sessionId:context.sessionId,
      expiresAt:new Date(Date.now()+3600_000).toISOString(),
    });
    expect(approveRequest(approvalId)).toBe(true);
    return approvalId;
  }
  it("resumes the approved pool change and dispatches the exact effect",async()=>{
    const taskId="bootstrap-resume-"+Date.now();
    const plan=bootstrapPlan(taskId);
    const approvalId=approved(taskId,plan);
    const seen:string[]=[];
    const result=await resumeApprovedTask(approvalId,plan,async(_tool,step)=>{
      seen.push(String((step.arguments as {paths:string[]}).paths[0]));
      return {ok:true};
    });
    expect(result?.status).toBe("completed");
    expect(seen).toEqual(["D:/projects/app-a"]);
    expect(getApprovalRequest(approvalId)?.status).toBe("consumed");
  });
  it("refuses the same approval once the argument payload changed",async()=>{
    const taskId="bootstrap-tampered-"+Date.now();
    const plan=bootstrapPlan(taskId);
    const approvalId=approved(taskId,plan);
    plan.steps[0]!.arguments={paths:["D:/projects/evil"]};
    let dispatched=false;
    expect(await resumeApprovedTask(approvalId,plan,async()=>{dispatched=true;return {ok:true};})).toBeNull();
    expect(dispatched).toBe(false);
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
  });
});
