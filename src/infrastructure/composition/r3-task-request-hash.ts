import {createHash} from "node:crypto";
import type {TaskPlan} from "../../application/dto/legacy-task-plan.js";
import {selectTool} from "../../application/services/legacy-tool-orchestrator.js";

/** Stable serialization for a normalized Task creation request. Only the
 * SHA-256 digest is persisted, never the raw arguments or credentials. */
function canonical(value:unknown):string {
  if(value===null||typeof value!=="object"){
    const text=JSON.stringify(value);
    if(text===undefined)throw new Error("unserializable_task_create_argument");
    return text;
  }
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  const object=value as Record<string,unknown>;
  return "{"+Object.keys(object).filter(key=>object[key]!==undefined).sort()
    .map(key=>JSON.stringify(key)+":"+canonical(object[key])).join(",")+"}";
}
export function fingerprintTaskCreate(plan:TaskPlan):string {
  const context=plan.executionContext;
  if(!context?.principalId||!context.sessionId||!context.origin)
    throw new Error("task_request_scope_unbound");
  const normalized={
    version:1,title:plan.task,description:plan.description??"",
    steps:plan.steps.map(step=>({
      id:step.id,action:step.action,tool:step.tool??selectTool(step),
      arguments:step.arguments??{},dependsOn:step.dependsOn??[],
      runWhen:step.runWhen??"success",timeout:step.timeout??30000,
    })),
    retryPolicy:{
      maxTotalAttempts:plan.retryPolicy?.maxTotalAttempts??null,
      maxConsecutiveFailures:plan.retryPolicy?.maxConsecutiveFailures??null,
    },
    scope:{
      principalId:context.principalId,sessionId:context.sessionId,origin:context.origin,
      scopes:[...(context.scopes??[])].sort(),
      workspace:context.workspace,roots:[...(context.allowedRootsSnapshot??context.roots)].sort(),
      unrestricted:context.unrestricted,
    },
  };
  return createHash("sha256").update(canonical(normalized),"utf8").digest("hex");
}
