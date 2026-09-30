import {describe,expect,it} from "vitest";
import {createTaskRuntimeService} from "../../src/core/runtime/composition-root.js";
import {connectInProcessMcp,json} from "../helpers/in-process-mcp.js";
import {runWithTrustedInboundIdentity} from "../../src/core/runtime/r2-trusted-inbound-identity.js";
import {createR2RuntimeGateway} from "../../src/core/executor/r2-runtime-gateway.js";
import type {PrincipalId,SessionId,ToolId} from "../../src/domain/shared/ids.js";

const user="r2-owner" as PrincipalId;
const a={principal:{id:user,permission:"DEVELOPER" as const,origin:"http_oauth" as const,
  scopes:["hooshix:read","hooshix:task:manage"]},sessionId:"r2-session-A" as SessionId};
const b={...a,sessionId:"r2-session-B" as SessionId};
describe("R2.04 principal/session-bound Task scope",()=>{
 it("never exposes or executes a Task from a different HTTP session, even with the same bearer principal",async()=>{
   const runtime=createTaskRuntimeService();
   const plan=runWithTrustedInboundIdentity(a,()=>runtime.create({
     title:"R2 session-owned read",steps:[{action:"read info",tool:"get_system_info",arguments:{}}],
   }));
   expect(runWithTrustedInboundIdentity(a,()=>runtime.get(plan.id)?.id)).toBe(plan.id);
   expect(runWithTrustedInboundIdentity(a,()=>runtime.list(100).some(t=>t.id===plan.id))).toBe(true);
   expect(runWithTrustedInboundIdentity(b,()=>runtime.list(100).some(t=>t.id===plan.id))).toBe(false);
   expect(()=>runWithTrustedInboundIdentity(b,()=>runtime.get(plan.id)))
     .toThrow("task_principal_session_mismatch");
   await expect(runWithTrustedInboundIdentity(b,()=>runtime.run(plan.id,0)))
     .rejects.toThrow("task_principal_session_mismatch");
   let calls=0;
   const gate=createR2RuntimeGateway({async execute(){calls++;return {ok:true};}});
   const unauthorized=await runWithTrustedInboundIdentity(b,()=>gate.execute({
     principal:b.principal,descriptorId:"task_get" as ToolId,arguments:{taskId:plan.id},
     directContext:{sessionId:b.sessionId},
   }));
   expect(unauthorized.kind).toBe("blocked");
   expect(calls).toBe(0);
   const authorized=await runWithTrustedInboundIdentity(a,()=>gate.execute({
     principal:a.principal,descriptorId:"task_get" as ToolId,arguments:{taskId:plan.id},
     directContext:{sessionId:a.sessionId},
   }));
   expect(authorized.kind).toBe("succeeded");
   expect(calls).toBe(1);
   expect((await runWithTrustedInboundIdentity(a,()=>runtime.run(plan.id,0))).status)
     .toBe("completed");
 });
 it("does not reveal a foreign session's Task via a shared idempotency key",async()=>{
   const harness=await connectInProcessMcp();
   const key="r2-bound-idempotency-"+crypto.randomUUID();
   const args={title:"session-bound idempotency",idempotencyKey:key,
     steps:[{action:"inspect",tool:"get_system_info",arguments:{}}]};
   try {
     const created=await runWithTrustedInboundIdentity(a,()=>
       harness.client.callTool({name:"task_create",arguments:args}));
     expect(created.isError).not.toBe(true);
     const id=json(created).id as string;
     expect(id).toBeTruthy();
     const foreign=await runWithTrustedInboundIdentity(b,()=>
       harness.client.callTool({name:"task_create",arguments:args}));
     expect(foreign.isError).toBe(true);
     expect(JSON.stringify(foreign)).not.toContain(id);
     const own=await runWithTrustedInboundIdentity(a,()=>
       harness.client.callTool({name:"task_create",arguments:args}));
     expect(json(own).id).toBe(id);
   }finally{await harness.close();}
 });
 it("rejects foreign approval and cancellation before mutating Task state",async()=>{
   const runtime=createTaskRuntimeService();
   const plan=runWithTrustedInboundIdentity(a,()=>runtime.create({
     title:"R2 session-owned approval",steps:[
       {action:"delete test fixture",tool:"delete_file",arguments:{path:"r2-nonexistent-test-fixture.txt"}},
     ],
   }));
   const pending=await runWithTrustedInboundIdentity(a,()=>runtime.run(plan.id,0));
   expect(pending.status).toBe("pending_approval");
   const id=pending.approvalId!;
   expect(()=>runWithTrustedInboundIdentity(b,()=>runtime.approve(id)))
     .toThrow("task_principal_session_mismatch");
   await expect(runWithTrustedInboundIdentity(b,()=>runtime.resume(id)))
     .rejects.toThrow("task_principal_session_mismatch");
   expect(()=>runWithTrustedInboundIdentity(b,()=>runtime.cancel(plan.id)))
     .toThrow("task_principal_session_mismatch");
   expect(runWithTrustedInboundIdentity(a,()=>runtime.get(plan.id)?.state))
     .toBe("waiting_approval");
   expect(runWithTrustedInboundIdentity(a,()=>runtime.cancel(plan.id))).toBe(true);
 });
});