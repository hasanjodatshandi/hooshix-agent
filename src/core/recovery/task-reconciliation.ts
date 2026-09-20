import { getTaskPlan, saveMemoryItem, listMemoryItems, applyTaskReconciliationDecision } from "../memory/task-repository.js";
import { OPERATION_CATALOG } from "../../application/services/operation-catalog.js";
import type { TaskPlan } from "../../application/dto/legacy-task-plan.js";

export type ReconciliationFinding="effect_observed"|"effect_not_observed"|"undetermined";
export type ReconciliationDecision=
  "confirmed_succeeded"|"confirmed_failed"|"safe_to_retry"|
  "still_unknown"|"manual_intervention_required";

type ReconciliationInput={
  taskId:string;stepId:number;finding:ReconciliationFinding;
  evidence:string;verificationTaskId?:string;
};

function validateEvidence(input:ReconciliationInput):TaskPlan {
  const plan=getTaskPlan(input.taskId);
  if(!plan)throw new Error("Task not found");
  const step=plan.steps.find(s=>s.id===input.stepId);
  if(!step||step.status!=="outcome_unknown")
    throw new Error("Reconciliation is only allowed for a step currently in outcome_unknown");
  if(plan.state!=="failed")throw new Error("Task must be terminal-failed before reconciliation");
  if(input.evidence.trim().length<12)
    throw new Error("Reconciliation evidence must describe what was checked");
  if(input.verificationTaskId===input.taskId)
    throw new Error("Verification task must be separate from the interrupted task");
  if(input.finding==="effect_observed"&&!input.verificationTaskId)
    throw new Error("effect_observed requires a separate completed read-only verification task");
  if(input.verificationTaskId){
    const verification=getTaskPlan(input.verificationTaskId);
    if(!verification||verification.state!=="completed"||
      verification.executionContext?.principalId!==plan.executionContext?.principalId||
      verification.executionContext?.sessionId!==plan.executionContext?.sessionId||
      verification.steps.length===0||verification.steps.some(step=>
        step.status!=="completed"||!step.tool||
        !Object.hasOwn(OPERATION_CATALOG,step.tool)||
        OPERATION_CATALOG[step.tool as keyof typeof OPERATION_CATALOG].effect!=="read_only"))
      throw new Error("Verification task must exist, be completed, and contain only completed read-only steps from the same principal/session");
  }
  return plan;
}

/** Audit-only compatibility mode: preserves the original unknown step and
 * avoids silently treating operator assertions as original tool results. */
export function recordTaskReconciliation(input:ReconciliationInput){
  const plan=validateEvidence(input);
  const step=plan.steps.find(s=>s.id===input.stepId)!;
  const record={
    taskId:input.taskId,stepId:input.stepId,finding:input.finding,
    evidence:input.evidence.trim(),verificationTaskId:input.verificationTaskId??null,
    recordedAt:new Date().toISOString(),interruptedToolResult:"unknown",replayed:false,
  };
  const memoryId=saveMemoryItem({taskId:input.taskId,kind:"outcome_reconciliation",content:record});
  return {memoryId,...record,taskStatus:plan.state,stepStatus:step.status};
}

/** Explicit operator decision. Positive classifications require an independent
 * completed read-only Task. These are evidence-supported decisions, never
 * retroactive proof that the interrupted tool invocation returned normally. */
export function resolveTaskReconciliation(input:{
  taskId:string;stepId:number;decision:ReconciliationDecision;
  evidence:string;verificationTaskId?:string;
}){
  const finding:ReconciliationFinding=input.decision==="confirmed_succeeded"?"effect_observed":
    input.decision==="confirmed_failed"||input.decision==="safe_to_retry"?"effect_not_observed":"undetermined";
  if(input.decision==="still_unknown"||input.decision==="manual_intervention_required")
    return {...recordTaskReconciliation({...input,finding}),decision:input.decision,applied:false};
  const plan=validateEvidence({...input,finding});
  if(!input.verificationTaskId)throw new Error("resolution_requires_independent_read_only_verification");
  const step=plan.steps.find(s=>s.id===input.stepId)!;
  if(input.decision==="safe_to_retry"){
    const receipt=step.lastReceipt;
    if(step.tool!=="create_file"||receipt?.effect!=="idempotent_mutation"||
      receipt.toolId!=="create_file"||!receipt.idempotencyKeyHash)
      throw new Error("safe_to_retry_requires_verified_durable_tool_idempotency");
  }
  applyTaskReconciliationDecision({
    taskId:input.taskId,stepId:input.stepId,decision:input.decision,
    evidence:input.evidence.trim(),verificationTaskId:input.verificationTaskId,
  });
  const refreshed=getTaskPlan(input.taskId)!;
  return {taskId:input.taskId,stepId:input.stepId,decision:input.decision,
    applied:true,replayed:false,originalToolResult:"unknown",
    taskStatus:refreshed.state,stepStatus:refreshed.steps.find(s=>s.id===input.stepId)?.status};
}

export function getTaskReconciliations(taskId:string){
  return listMemoryItems({taskId,kind:"outcome_reconciliation",limit:100}).items;
}
