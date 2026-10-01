import { describe, expect, it } from "vitest";
import { createAuthorizationService } from "../../src/application/services/authorization-service.js";
import { operationDescriptorPort } from "../../src/application/services/operation-catalog.js";
import { createExecuteToolUseCase } from "../../src/application/use-cases/tools/execute-tool.usecase.js";
import type { ToolDescriptor } from "../../src/domain/tool/tool-descriptor.js";
import type { PrincipalId, SessionId, ToolId, TaskId, StepId } from "../../src/domain/shared/ids.js";
import { captureWorkspaceScope } from "../../src/domain/workspace/workspace-scope.js";
import type { ToolInputValidatorPort } from "../../src/application/ports/outbound/operations.port.js";
import type { WorkspaceContextRepository } from "../../src/application/ports/outbound/support.port.js";
import type { ToolHandlerPort } from "../../src/application/use-cases/tools/execute-tool.usecase.js";

const id="read_file" as ToolId, p="principal-r2" as PrincipalId, session="session-r2" as SessionId;
const principal={id:p,permission:"READ" as const,scopes:[]};
const scope=captureWorkspaceScope({principalId:p,sessionId:session,root:"/allowed",allowedRoots:["/allowed"],unrestricted:false,capturedAt:"2026-09-20T00:00:00Z"});
const descriptor:ToolDescriptor={id,requiredPermission:"READ",risk:"low",approval:"never",effect:"read_only",workspaceScope:"read",supportsIdempotency:false,capabilities:[]};
function harness(options:{allow?:boolean; failedAudit?:boolean}={}) {
 const calls:{toolId:ToolId;args:unknown;root:string|null}[]=[];
 const state={scope};
 const workspace:WorkspaceContextRepository={
   async get(sessionId,principalId){return sessionId===session&&principalId===p?state.scope:null;},
   async set(){throw new Error("unexpected write");},
   async remove(){throw new Error("unexpected remove");},
 };
 const validator:ToolInputValidatorPort={validate(_,value){
   return value && typeof value==="object" && !Array.isArray(value) ? {valid:true,value}:{valid:false,reason:"invalid"};
 }};
 const handler:ToolHandlerPort={async execute(toolId,args,s){
   calls.push({toolId,args,root:s.root});return {safe:true};
 }};
 const auth={decide:()=>options.allow===false?{kind:"blocked" as const,reason:"denied"}:{kind:"allowed" as const}};
 const usecase=createExecuteToolUseCase({
   catalog:{get(name){return name===id?descriptor:null;}},validator,authorization:auth,
   handler,audit:{async record(){if(options.failedAudit)throw new Error("audit unavailable");}},workspace,
 });
 return {usecase,calls,state,workspace,descriptor};
}
describe("R2.02 common application execution gateway",()=>{
 it("resolves direct workspace by trusted principal/session, and task workspace from immutable captured context",async()=>{
   const h=harness();
   const direct=await h.usecase.execute({principal,descriptorId:id,arguments:{path:"file"},directContext:{sessionId:session}});
   expect(direct).toMatchObject({kind:"succeeded",output:{safe:true}});
   expect(h.calls).toEqual([{toolId:id,args:{path:"file"},root:"/allowed"}]);
   const captured=captureWorkspaceScope({...scope,root:"/original",allowedRoots:["/original"]});
   h.state.scope=captureWorkspaceScope({...scope,root:"/new",allowedRoots:["/new"]});
   const task=await h.usecase.execute({principal,descriptorId:id,arguments:{path:"file"},taskContext:{taskId:"task-r2" as TaskId,stepId:1 as StepId,workspaceScope:captured}});
   expect(task.kind).toBe("succeeded");
   expect(h.calls[1]?.root).toBe("/original");
 });
 it("cannot spoof direct scope through tool arguments, unknown tool, or forged session",async()=>{
   const h=harness();
   const spoof=await h.usecase.execute({principal,descriptorId:id,arguments:{path:"x",scope:{root:"/outside"}},directContext:{sessionId:"bad" as SessionId}});
   expect(spoof.kind).toBe("blocked");
   const missing=await h.usecase.execute({principal,descriptorId:"not-a-tool" as ToolId,arguments:{},directContext:{sessionId:session}});
   expect(missing.kind).toBe("blocked");
   expect(h.calls).toHaveLength(0);
 });
 it("rejects malformed input and authorization denials without invoking handler",async()=>{
   const h=harness();
   expect((await h.usecase.execute({principal,descriptorId:id,arguments:"bad",directContext:{sessionId:session}})).kind).toBe("blocked");
   const denied=harness({allow:false});
   expect((await denied.usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}})).kind).toBe("blocked");
   expect([...h.calls,...denied.calls]).toHaveLength(0);
 });
 it("never dispatches a mutation without a verified approval and authorization",async()=>{
   const h=harness();const mutation:ToolDescriptor={...descriptor,effect:"non_idempotent_mutation",approval:"always"};
   const calls:{toolId:ToolId}[]=[];
   const g=createExecuteToolUseCase({
     catalog:{get:()=>mutation},
     validator:{validate:(_id,value)=>({valid:true,value})},
     authorization:{decide:()=>({kind:"allowed"})},
     handler:{async execute(toolId){calls.push({toolId});return "MUTATED";}},
     audit:{async record(){}},
     workspace:h.workspace,
   });
   const response=await g.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}});
   expect(response.kind).toBe("approval_required");
   expect(calls).toHaveLength(0);
 });
 it("enforces canonical descriptors and server ceiling before calling an outbound port",async()=>{
   const h=harness();
   const useCase=createExecuteToolUseCase({
     catalog:operationDescriptorPort,
     validator:{validate:(_id,input)=>({valid:true,value:input})},
     authorization:createAuthorizationService({serverCeiling:"READ",allowUnrestricted:false}),
     handler:{async execute(toolId,args,workspace){h.calls.push({toolId,args,root:workspace.root});return {safe:true};}},
     audit:{async record(){}},workspace:h.workspace,
   });
   const trusted={...principal,permission:"ADMIN" as const,origin:"local_stdio" as const};
   expect(await useCase.execute({principal:trusted,descriptorId:"write_file" as ToolId,arguments:{path:"x"},directContext:{sessionId:session}}))
     .toMatchObject({kind:"blocked",reason:"server_permission_ceiling"});
   expect((await useCase.execute({principal:trusted,descriptorId:id,arguments:{path:"x"},directContext:{sessionId:session}})).kind).toBe("succeeded");
   expect(h.calls).toHaveLength(1);
 });
 it("preserves successful effect outcome if post-effect audit fails",async()=>{
   const h=harness({failedAudit:true});
   expect(await h.usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}}))
     .toMatchObject({kind:"succeeded",observabilityDegraded:true});
   expect(h.calls).toHaveLength(1);
 });
 it("returns a recoverable reason code instead of an opaque tool_handler_failure",async()=>{
   // A handler that fails must surface WHY in a fixed, message-free label so a
   // client can react (call set_workspace, pick a smaller file, ...) instead of
   // blind-retrying. The thrown message must never be echoed.
   const cases:[Error,string][]=[
     [new Error("Access denied: no active workspace. Add a root with add_workspace_roots and select it with set_workspace first."),"workspace_missing_or_ungranted"],
     [new Error("Access denied: path outside workspace. Allowed: /allowed."),"path_outside_workspace"],
     [new Error("Access denied: sensitive-file denylist"),"sensitive_file_rejected"],
     [new Error("File exceeds 1000000 byte limit"),"size_limit_exceeded"],
     [new Error("Target is not a file"),"not_a_file"],
     [Object.assign(new Error("ENOENT: no such file or directory, open 'D:/secret/path/file.txt'"),{code:"ENOENT"}),"resource_not_found"],
     [new Error("totally unexpected internal boom"),"tool_handler_failure"],
   ];
   for (const [thrown,expected] of cases) {
     const usecase=createExecuteToolUseCase({
       catalog:{get:()=>descriptor},
       validator:{validate:(_id,value)=>({valid:true,value})},
       authorization:{decide:()=>({kind:"allowed" as const})},
       handler:{async execute(){throw thrown;}},
       audit:{async record(){}},workspace:harness().workspace,
     });
     const result=await usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}});
     expect(result.kind).toBe("failed");
     const reason=(result as {reason:string}).reason;
     expect(reason).toBe(expected);
     // The label never carries the thrown message, a path, or credentials.
     expect(reason).not.toContain("D:/");
     expect(reason).not.toContain("add_workspace_roots");
     expect(JSON.stringify(result)).not.toContain("secret/path");
   }
 });
});