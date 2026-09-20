import {describe,expect,it,vi} from "vitest";
vi.mock("../../src/adapters/outbound/persistence/sqlite/repositories/tool-call-audit.adapter.js",()=>({
  insertToolCallAuditRow:vi.fn(()=>{throw new Error("fixture audit sink unavailable");}),
}));
vi.mock("../../src/core/loop/checkpoint-integration.js",()=>({
  checkpointStep:vi.fn(()=>{throw new Error("fixture checkpoint sink unavailable");}),
}));
vi.mock("../../src/core/memory/context-memory.js",()=>({
  saveDecisionWithContext:vi.fn(()=>{throw new Error("fixture decision sink unavailable");}),
  saveExecutionWithContext:vi.fn(()=>{throw new Error("fixture timeline sink unavailable");}),
  saveTaskWithContext:vi.fn(()=>{throw new Error("fixture task-memory sink unavailable");}),
}));
import {auditToolCall} from "../../src/core/memory/tool-audit.js";
import {createTaskPlan} from "../../src/core/planner/task-planner.js";
import {runClosedAgentLoop} from "../../src/core/loop/closed-agent-loop.js";
import {getTaskPlan,listStepExecutionReceipts,saveTaskPlan} from "../../src/core/memory/task-repository.js";
import {telemetryDegradationCount} from "../../src/core/trace/telemetry-degradation.js";
import {PersistentRecoveryObservability} from "../../src/core/trace/persistent-recovery-observability.js";

describe("R3.10 telemetry failures never replace a known business outcome",()=>{
  it("returns a successful external tool result even when the audit sink fails",async()=>{
    const before=telemetryDegradationCount();
    let calls=0;
    const result=await auditToolCall("write_file","fixture-correlation",undefined,async()=>{
      calls++;return {effect:"confirmed_return_value"};
    });
    expect(result).toEqual({effect:"confirmed_return_value"});
    expect(calls).toBe(1);
    expect(telemetryDegradationCount()).toBeGreaterThan(before);
  });
  it("propagates the ORIGINAL tool error when failure auditing also fails",async()=>{
    const before=telemetryDegradationCount();
    const realFailure=new Error("fixture business effect failed");
    await expect(auditToolCall("write_file","fixture-correlation",undefined,async()=>{
      throw realFailure;
    })).rejects.toBe(realFailure);
    expect(telemetryDegradationCount()).toBeGreaterThan(before);
  });
  it("does not fail or retry a completed mutation after checkpoint/timeline sinks throw",async()=>{
    const plan=createTaskPlan("R3 successful effect with telemetry outage",[
      {action:"fixture mutation",tool:"write_file",arguments:{path:"tests/R3_NOT_CREATED",content:"fixture"}},
    ]);
    saveTaskPlan(plan,"planning");
    let mutations=0;
    const before=telemetryDegradationCount();
    const outcome=await runClosedAgentLoop(plan,async()=>{mutations++;return {ok:true};},2);
    expect(outcome.status).toBe("completed");
    expect(mutations).toBe(1);
    expect(getTaskPlan(plan.id)?.steps[0]).toMatchObject({status:"completed",attempts:1,output:{ok:true}});
    expect(listStepExecutionReceipts(plan.id,1)[0].status).toBe("succeeded");
    expect(telemetryDegradationCount()).toBeGreaterThan(before);
  });
  it("does not allow recovery-observability storage errors to rewrite a successful record callback",()=>{
    const observability=new PersistentRecoveryObservability({save:()=>{throw Error("fixture recovery sink unavailable");}} as never);
    const before=telemetryDegradationCount();
    expect(()=>observability.record({recoveryId:"r",correlationId:"c",action:"stop",
      reason:"test",retryCount:1,startedAt:new Date().toISOString(),status:"completed"})).not.toThrow();
    expect(telemetryDegradationCount()).toBeGreaterThan(before);
  });
});
