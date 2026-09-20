import path from "node:path";
import { describe, expect, it } from "vitest";
import { resumeApprovedTask } from "../../src/core/loop/resume-orchestrator.js";
import { createApprovalRequest, approveRequest, getApprovalRequest } from "../../src/core/governance/approval-memory.js";
import { saveCheckpoint } from "../../src/core/memory/checkpoint-memory.js";
import { fingerprintTaskEffect } from "../../src/infrastructure/composition/r2-approval-fingerprint.js";
import type { TaskPlan } from "../../src/application/dto/legacy-task-plan.js";

function fixture(taskId:string,state:"waiting_approval"|"cancelled"):TaskPlan {
  const root=path.resolve(".");
  return {
    id:taskId,task:"resume",state,
    executionContext:{
      principalId:"local-stdio",sessionId:"local-stdio-session",origin:"local_stdio",scopes:[],
      workspace:root,roots:[root],allowedRootsSnapshot:[root],unrestricted:false,
      createdAt:new Date().toISOString(),
    },
    steps:[
      {id:1,action:"normal first",status:"completed",arguments:{}},
      {id:2,action:"delete file",tool:"delete_file",status:"pending",arguments:{}},
    ],
  };
}
function checkpointAndApprove(taskId:string,plan:TaskPlan) {
  const correlationId="resume-orch-corr-"+taskId;
  saveCheckpoint({taskId,stepId:2,stepIndex:1,
    state:{status:"pending_approval"},correlationId});
  const context=plan.executionContext!;
  const approvalId=createApprovalRequest({
    taskId,stepId:2,action:"delete file",toolId:"delete_file",
    risk:"high",reason:"delete",correlationId,
    requestFingerprint:fingerprintTaskEffect({
      taskId,stepId:2,action:"delete file",toolId:"delete_file",
      args:{},context,
    }),
    principalId:context.principalId,sessionId:context.sessionId,
    expiresAt:new Date(Date.now()+3600_000).toISOString(),
  });
  expect(approveRequest(approvalId)).toBe(true);
  return approvalId;
}

describe("resume orchestrator exact-action authorization",()=>{
  it("resumes a checkpoint with the same persisted, bound approval",async()=>{
    const taskId="resume-orch-"+Date.now();
    const plan=fixture(taskId,"waiting_approval");
    const approvalId=checkpointAndApprove(taskId,plan);
    const result=await resumeApprovedTask(approvalId,plan,async()=>({ok:true}));
    expect(result?.status).toBe("completed");
    expect(getApprovalRequest(approvalId)?.status).toBe("consumed");
  });
  it("does not burn a legitimate approval while a plan is cancelled",async()=>{
    const taskId="resume-orch-cancelled-"+Date.now();
    const plan=fixture(taskId,"cancelled");
    const approvalId=checkpointAndApprove(taskId,plan);
    expect(await resumeApprovedTask(approvalId,plan,async()=>({ok:true}))).toBeNull();
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
    const retry=fixture(taskId,"waiting_approval");
    const result=await resumeApprovedTask(approvalId,retry,async()=>({ok:true}));
    expect(result?.status).toBe("completed");
  });
  it("rejects changed arguments and workspace elevation without consuming the original grant",async()=>{
    const taskId="resume-orch-changed-"+Date.now();
    const plan=fixture(taskId,"waiting_approval");
    const approvalId=checkpointAndApprove(taskId,plan);
    let dispatched=false;
    const executor=async()=>{dispatched=true;return {effect:true};};
    plan.steps[1]!.arguments={path:"different-target.txt"};
    expect(await resumeApprovedTask(approvalId,plan,executor)).toBeNull();
    expect(dispatched).toBe(false);
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
    plan.steps[1]!.arguments={};
    plan.executionContext={...plan.executionContext!,unrestricted:true};
    expect(await resumeApprovedTask(approvalId,plan,executor)).toBeNull();
    expect(dispatched).toBe(false);
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
  });
  it("never consumes or executes an old approval with no task/argument/scope fingerprint",async()=>{
    const taskId="resume-orch-unbound-"+Date.now();
    const plan=fixture(taskId,"waiting_approval");
    saveCheckpoint({taskId,stepId:2,stepIndex:1,state:{status:"pending_approval"},correlationId:"unbound-legacy"});
    const approvalId=createApprovalRequest({taskId,stepId:2,action:"delete file",risk:"high",reason:"legacy"});
    expect(approveRequest(approvalId)).toBe(true);
    let executed=false;
    expect(await resumeApprovedTask(approvalId,plan,async()=>{executed=true;return {}; })).toBeNull();
    expect(executed).toBe(false);
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
  });
});