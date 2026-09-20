import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {createTaskRuntimeService} from "../../src/core/runtime/composition-root.js";
import {saveTaskPlan,getTaskPlan,listStepExecutionReceipts,beginStepExecutionReceipt,finishStepExecutionReceipt} from "../../src/core/memory/task-repository.js";
import {createMutationReceipt,finalizeMutationReceipt} from "../../src/core/loop/execution-receipt.js";
import {recordTaskReconciliation,resolveTaskReconciliation,getTaskReconciliations} from "../../src/core/recovery/task-reconciliation.js";
import {createTaskPlan} from "../../src/core/planner/task-planner.js";

function pair(tool:"write_file"|"create_file"="write_file",key?:string){
  const service=createTaskRuntimeService();
  const task=service.create({title:"R3 resolution subject",steps:[{
    action:"original external effect",tool,
    arguments:{path:"tests/NEVER_WRITE_R3",content:"fixture",...(key?{idempotencyKey:key}:{})},
  }]});
  task.steps[0].status="outcome_unknown";task.steps[0].attempts=1;saveTaskPlan(task,"failed");
  const evidence=service.create({title:"independent outcome verification",steps:[{
    action:"inspect observed effect",tool:"list_directory",arguments:{path:"tests"},
  }]});
  evidence.steps[0].status="completed";saveTaskPlan(evidence,"completed");
  return {service,task,evidence};
}
describe("R3.05 explicit evidence-based Task reconciliation",()=>{
  it("audit-only default does not resolve or replay an unknown mutation",()=>{
    const {task,evidence}=pair();
    const report=recordTaskReconciliation({taskId:task.id,stepId:1,finding:"effect_observed",
      evidence:"A separate verified read-only inspection recorded the effect",
      verificationTaskId:evidence.id});
    expect(report.stepStatus).toBe("outcome_unknown");
    expect(getTaskPlan(task.id)!.steps[0].status).toBe("outcome_unknown");
  });
  it("explicit verified effect-observed decision distinguishes reconciled success from original tool completion",()=>{
    const {service,task,evidence}=pair();
    const res=service.reconcile({taskId:task.id,stepId:1,finding:"effect_observed",
      decision:"confirmed_succeeded",evidence:"Read-only evidence shows target effect independently",
      verificationTaskId:evidence.id});
    expect(res).toMatchObject({applied:true,replayed:false,stepStatus:"reconciled_succeeded",taskStatus:"completed"});
    const reloaded=getTaskPlan(task.id)!;
    expect(reloaded.steps[0].output).toBeUndefined();
    expect(reloaded.steps[0].attempts).toBe(1);
    expect(getTaskReconciliations(task.id)).toHaveLength(1);
  });
  it("confirmed negative evidence records reconciled_failed but never schedules the same mutation for retry",()=>{
    const {service,task,evidence}=pair();
    const result=service.reconcile({taskId:task.id,stepId:1,finding:"effect_not_observed",
      decision:"confirmed_failed",evidence:"Independent verification shows no committed target effect",
      verificationTaskId:evidence.id});
    expect(result).toMatchObject({stepStatus:"reconciled_failed",taskStatus:"failed"});
    expect(getTaskPlan(task.id)!.steps[0].status).toBe("reconciled_failed");
  });
  it("rejects unsafe non-idempotent replays and unkeyed create_file despite operator assertion",()=>{
    for(const [tool,key] of [["write_file","fixture-key"],["create_file",undefined]] as const){
      const {service,task,evidence}=pair(tool,key);
      expect(()=>service.reconcile({taskId:task.id,stepId:1,
        finding:"effect_not_observed",decision:"safe_to_retry",
        evidence:"Verified separate read-only inspection of the target path",
        verificationTaskId:evidence.id})).toThrow(/idempotency/);
      expect(getTaskPlan(task.id)!.steps[0].status).toBe("outcome_unknown");
    }
  });
  it("supports explicit retry-safe classification only for durable keyed idempotent create_file effect",()=>{
    const {service,task,evidence}=pair("create_file",randomUUID());
    const step=task.steps[0];
    step.status="running";saveTaskPlan(task,"executing");
    const receipt=createMutationReceipt(step,"create_file")!;
    beginStepExecutionReceipt(task.id,step,0,receipt);
    finishStepExecutionReceipt(task.id,finalizeMutationReceipt(receipt,"outcome_unknown"));
    step.status="outcome_unknown";saveTaskPlan(task,"failed");
    expect(listStepExecutionReceipts(task.id,1)).toHaveLength(1);
    const res=service.reconcile({taskId:task.id,stepId:1,finding:"effect_not_observed",
      decision:"safe_to_retry",evidence:"Separate read-only evidence and durable create-only idempotency key",
      verificationTaskId:evidence.id});
    expect(res).toMatchObject({applied:true,stepStatus:"pending",taskStatus:"planning",replayed:false});
    expect(getTaskPlan(task.id)!.steps[0].attempts).toBe(1);
    expect(listStepExecutionReceipts(task.id,1)).toMatchObject([{
      status:"outcome_unknown",reconciliation:"effect_not_observed",
    }]);
  });
  it("refuses unverified or unrelated verification, and rejects replayed resolution",()=>{
    const {service,task,evidence}=pair();
    expect(()=>service.reconcile({taskId:task.id,stepId:1,decision:"confirmed_succeeded",
      finding:"effect_observed",evidence:"Unverified operator assertion"})).toThrow(/verification/);
    const altered=createTaskPlan("false verification",[{action:"mutate",tool:"write_file",
      arguments:{path:"tests/NEVER_WRITE_R3",content:"fixture"},status:"completed"}]);
    saveTaskPlan(altered,"completed");
    expect(()=>resolveTaskReconciliation({taskId:task.id,stepId:1,
      decision:"confirmed_succeeded",evidence:"Incorrect mutating verification fixture",
      verificationTaskId:altered.id})).toThrow(/read-only/);
    const first=service.reconcile({taskId:task.id,stepId:1,decision:"confirmed_succeeded",
      finding:"effect_observed",evidence:"Separate read-only proof after the external effect",
      verificationTaskId:evidence.id});
    expect(first).toMatchObject({applied:true});
    expect(()=>service.reconcile({taskId:task.id,stepId:1,decision:"confirmed_succeeded",
      finding:"effect_observed",evidence:"Duplicate verified classification",
      verificationTaskId:evidence.id})).toThrow(/outcome_unknown|reconciliation/);
  });
});