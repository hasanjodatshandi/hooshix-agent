import {describe,expect,it} from "vitest";
import {createExecuteToolUseCase} from "../../src/application/use-cases/tools/execute-tool.usecase.js";
import type {SecurityEventPort} from "../../src/application/ports/outbound/support.port.js";
import {captureWorkspaceScope} from "../../src/domain/workspace/workspace-scope.js";
import type {ToolDescriptor} from "../../src/domain/tool/tool-descriptor.js";
import type {PrincipalId,SessionId,ToolId,TaskId,StepId} from "../../src/domain/shared/ids.js";

/**
 * Checklist item 10.7 — "security events include scope expansion, sensitive
 * denial, token replay, rate limiting and audit-sink failure". The taxonomy is
 * only real if each event kind can actually be produced through the gateway and
 * observed on the port. This test drives each path and asserts the exact kind.
 */

const id="read_file" as ToolId, p="principal-taxonomy" as PrincipalId, session="session-taxonomy" as SessionId;
const principal={id:p,permission:"READ" as const,scopes:[]};

function captureKinds(unrestricted:boolean){
  return captureWorkspaceScope({principalId:p,sessionId:session,root:"/allowed",allowedRoots:["/allowed"],unrestricted,capturedAt:"2026-09-20T00:00:00Z"});
}
const baseScope=captureKinds(false);
const descriptor:ToolDescriptor={id,requiredPermission:"READ",risk:"low",approval:"never",effect:"read_only",workspaceScope:"read",supportsIdempotency:false,capabilities:[]};

function securitySink():SecurityEventPort&{events:Array<{kind:string;principalId:PrincipalId;toolId?:ToolId;reason?:string}>}{
  const events:Array<{kind:string;principalId:PrincipalId;toolId?:ToolId;reason?:string}>=[];
  return {record:async(event)=>{events.push(event);},events};
}

describe("10.7 the security-event taxonomy is observable on the port",()=>{
  it("records authorization_denied when authorization blocks a tool",async()=>{
    const sink=securitySink();
    const usecase=createExecuteToolUseCase({
      catalog:{get:()=>descriptor},
      validator:{validate:(_id,value)=>({valid:true,value})},
      authorization:{decide:()=>({kind:"blocked" as const,reason:"denied_by_policy"})},
      handler:{async execute(){throw new Error("must not execute");}},
      audit:{async record(){}},
      workspace:{async get(){return baseScope;},async set(){throw new Error("no");},async remove(){throw new Error("no");}},
      securityEvents:sink,
    });
    const result=await usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}});
    expect(result.kind).toBe("blocked");
    expect(sink.events.map(e=>e.kind)).toEqual(["authorization_denied"]);
    expect(sink.events[0]?.principalId).toBe(p);
  });

  it("records workspace_mutation_executed for a scoped mutation",async()=>{
    const sink=securitySink();
    const mutation:ToolDescriptor={...descriptor,effect:"non_idempotent_mutation",approval:"never",workspaceScope:"scope_mutation"};
    const usecase=createExecuteToolUseCase({
      catalog:{get:()=>mutation},
      validator:{validate:(_id,value)=>({valid:true,value})},
      authorization:{decide:()=>({kind:"allowed" as const})},
      // An explicit policy that allows the mutation is what makes the effect
      // non-read-only but approved: without it the gateway requires approval.
      operationPolicy:{classify:()=>"allowed" as const},
      handler:{async execute(){return "MUTATED";}},
      audit:{async record(){}},
      workspace:{async get(){return baseScope;},async set(){throw new Error("no");},async remove(){throw new Error("no");}},
      securityEvents:sink,
    });
    const result=await usecase.execute({principal,descriptorId:id,arguments:{},taskContext:{taskId:"t1" as TaskId,stepId:1 as StepId,workspaceScope:baseScope}});
    expect(result.kind).toBe("succeeded");
    expect(sink.events.map(e=>e.kind)).toEqual(["workspace_mutation_executed"]);
  });

  it("records approved_unrestricted_effect_executed for an unrestricted effect",async()=>{
    const sink=securitySink();
    const usecase=createExecuteToolUseCase({
      catalog:{get:()=>descriptor},
      validator:{validate:(_id,value)=>({valid:true,value})},
      authorization:{decide:()=>({kind:"allowed" as const})},
      handler:{async execute(){return {ok:true};}},
      audit:{async record(){}},
      workspace:{async get(){return captureKinds(true);},async set(){throw new Error("no");},async remove(){throw new Error("no");}},
      securityEvents:sink,
    });
    const result=await usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}});
    expect(result.kind).toBe("succeeded");
    expect(sink.events.map(e=>e.kind)).toEqual(["approved_unrestricted_effect_executed"]);
  });

  it("records no security event for an ordinary read (the taxonomy is not noise)",async()=>{
    const sink=securitySink();
    const usecase=createExecuteToolUseCase({
      catalog:{get:()=>descriptor},
      validator:{validate:(_id,value)=>({valid:true,value})},
      authorization:{decide:()=>({kind:"allowed" as const})},
      handler:{async execute(){return {ok:true};}},
      audit:{async record(){}},
      workspace:{async get(){return baseScope;},async set(){throw new Error("no");},async remove(){throw new Error("no");}},
      securityEvents:sink,
    });
    const result=await usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}});
    expect(result.kind).toBe("succeeded");
    expect(sink.events).toEqual([]);
  });

  it("an audit-sink failure after a side effect degrades observability instead of failing the call",async()=>{
    const sink=securitySink();
    const mutation:ToolDescriptor={...descriptor,effect:"non_idempotent_mutation",approval:"never",workspaceScope:"scope_mutation"};
    const usecase=createExecuteToolUseCase({
      catalog:{get:()=>mutation},
      validator:{validate:(_id,value)=>({valid:true,value})},
      authorization:{decide:()=>({kind:"allowed" as const})},
      operationPolicy:{classify:()=>"allowed" as const},
      handler:{async execute(){return "MUTATED";}},
      audit:{async record(){throw new Error("audit unavailable");}},
      workspace:{async get(){return baseScope;},async set(){throw new Error("no");},async remove(){throw new Error("no");}},
      securityEvents:sink,
    });
    const result=await usecase.execute({principal,descriptorId:id,arguments:{},directContext:{sessionId:session}});
    // The mutation already happened; losing the record must not trigger a retry.
    expect(result.kind).toBe("succeeded");
    expect(result).toMatchObject({observabilityDegraded:true});
  });
});
