import crypto from "node:crypto";
import { requestsUnrestrictedEffect } from "./r2-unrestricted-operation.js";
import type { TaskExecutionContext, TaskStep } from "../../application/dto/legacy-task-plan.js";
import { buildStepContext, resolveTemplates, hasTemplates, validateTemplates } from "../../application/services/template-resolver.js";

/** Canonical JSON identity for an exact authorized Task effect, never tool-controlled. */
function canonical(value:unknown):string {
  if(value===null || typeof value!=="object") {
    const serialized=JSON.stringify(value);
    if(serialized===undefined) throw new Error("unserializable_approval_argument");
    return serialized;
  }
  if(Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  const object=value as Record<string,unknown>;
  return "{"+Object.keys(object).sort().filter(k=>object[k]!==undefined)
    .map(k=>JSON.stringify(k)+":"+canonical(object[k])).join(",")+"}";
}
export interface ApprovalEffectIdentity {
  readonly taskId:string;readonly stepId:number;readonly action:string;
  readonly toolId:string;readonly args:unknown;readonly context:TaskExecutionContext;
}
/**
 * The workspace-pool control tools whose effect IS to create or change the
 * active workspace/roots. At bootstrap there is deliberately no active
 * workspace yet, so requiring one to fingerprint their approval is a
 * chicken-and-egg dead end: the fingerprint silently becomes NULL, and resume
 * fail-closes with `approval_cannot_resume` — exactly why `add_workspace_roots`
 * could never be approved via a task. They stay bound EXACTLY (principal,
 * session, the current roots snapshot, toolId and args), so the grant still
 * cannot be replayed against a different pool, principal, or argument; only
 * the impossible workspace component is relaxed.
 */
const WORKSPACE_POOL_CONTROL_TOOLS: ReadonlySet<string> = new Set([
  "add_workspace_roots","remove_workspace_root","set_workspace",
]);
export function fingerprintTaskEffect(value:ApprovalEffectIdentity):string {
  const workspaceIndependent=WORKSPACE_POOL_CONTROL_TOOLS.has(value.toolId);
  if(!value.context.principalId || !value.context.sessionId ||
    (!workspaceIndependent && !value.context.workspace) || !value.toolId ||
    !Number.isSafeInteger(value.stepId))
    throw new Error("approval_effect_identity_incomplete");
  const payload={
    version:1,taskId:value.taskId,stepId:value.stepId,action:value.action,
    toolId:value.toolId,args:value.args,
    scope:{
      principalId:value.context.principalId,sessionId:value.context.sessionId,
      workspace:value.context.workspace,
      roots:value.context.allowedRootsSnapshot ?? value.context.roots,
      unrestricted:value.context.unrestricted || requestsUnrestrictedEffect(value.toolId,value.args),
    },
  };
  return crypto.createHash("sha256").update(canonical(payload),"utf8").digest("hex");
}
/** Compute the exact argument payload at approval time without mutating the plan. */
export function resolveApprovedTaskArgs(step:TaskStep, completedSteps:TaskStep[]):Record<string,unknown> {
  const source=step.templateArguments ?? step.arguments ?? {};
  if(!hasTemplates(source)) return source;
  const context=buildStepContext(completedSteps);
  validateTemplates(source,context);
  return resolveTemplates(source,context);
}