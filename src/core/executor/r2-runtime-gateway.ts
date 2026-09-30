import fs from "node:fs";
import path from "node:path";
import type { Principal } from "../../domain/auth/principal.js";
import type { PrincipalId, SessionId, TaskId, StepId } from "../../domain/shared/ids.js";
import { captureWorkspaceScope, type WorkspaceScope } from "../../domain/workspace/workspace-scope.js";
import type { ToolExecutionResult, ToolHandlerPort } from "../../application/use-cases/tools/execute-tool.usecase.js";
import { createExecuteToolUseCase } from "../../application/use-cases/tools/execute-tool.usecase.js";
import { createAuthorizationService } from "../../application/services/authorization-service.js";
import { operationDescriptorPort, getOperationDescriptor } from "../../application/services/operation-catalog.js";
import { getConfiguredPermissionLevel } from "../../infrastructure/config/permission-config.js";
import { readLegacyWorkspaceBootstrapSettings } from "../../infrastructure/config/legacy-workspace-bootstrap.js";
import { getTrustedInboundIdentity } from "../runtime/r2-trusted-inbound-identity.js";
import { getActiveWorkspace, isUnrestrictedMode, listWorkspaceRoots } from "../../security/workspace-guard.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { getApprovalRequest, claimApprovedTaskEffect } from "../../core/governance/approval-memory.js";
import { getTaskPlan } from "../../core/memory/task-repository.js";
import { requestsUnrestrictedEffect, hasInvalidUnrestrictedArgument } from "../governance/r2-unrestricted-operation.js";
import { runWithApprovedUnrestrictedScope } from "../../security/workspace-guard.js";
import { fingerprintTaskEffect } from "../governance/r2-approval-fingerprint.js";
import { saveDecisionWithContext } from "../../core/memory/context-memory.js";

function serverCeiling() {
  const level=getConfiguredPermissionLevel();
  return ({READ_ONLY:"READ",PROJECT_ACCESS:"PROJECT_ACCESS",DEVELOPER_MODE:"DEVELOPER",ADMIN_MODE:"ADMIN"} as const)[level];
}
function isAllowedRoot(p:string, roots:readonly string[]): boolean {
  const canonical=process.platform==="win32"?p.toLowerCase():p;
  return roots.some(r => (process.platform==="win32"?r.toLowerCase():r)===canonical);
}
function currentScope(principal:Principal, sessionId:SessionId):WorkspaceScope {
  const root=getActiveWorkspace();
  // Effective active root is the ONLY file-access scope; the persisted pool is
  // an explicit selection option and is never implicit read/write authority.
  return captureWorkspaceScope({
    principalId:principal.id,sessionId,root,
    allowedRoots:root?[root]:[],
    unrestricted:isUnrestrictedMode(),capturedAt:new Date().toISOString(),
  });
}

export function createR2RuntimeGateway(handler:ToolHandlerPort) {
  return createExecuteToolUseCase({
    catalog:operationDescriptorPort,
    validator:{validate(toolId,value){
      const d=getOperationDescriptor(toolId);
      if(!d||!value||typeof value!=="object"||Array.isArray(value))
        return {valid:false,reason:"invalid_arguments"};
      const args=value as Record<string,unknown>;
      if(d.requiredArguments.some(key=>!Object.hasOwn(args,key)||args[key]===undefined))
        return {valid:false,reason:"missing_required_argument"};
      return {valid:true,value:args};
    }},
    authorization:createAuthorizationService({
      serverCeiling:serverCeiling(),
      allowUnrestricted:readLegacyWorkspaceBootstrapSettings().unrestrictedBootOptIn,
    }),
    workspace:{
      async get(session,principal) {
        const id=getTrustedInboundIdentity();
        if(id.sessionId!==session||id.principal.id!==principal) return null;
        return currentScope(id.principal,session);
      },
      async set(){throw new Error("workspace_context_is_transport_managed");},
      async remove(){throw new Error("workspace_context_is_transport_managed");},
    },
    operationPolicy:{classify({descriptor,args,scope,principal}){
      const data=args as Record<string,unknown>;
      if(hasInvalidUnrestrictedArgument(descriptor.id,data))return "blocked";
      if(data.unrestricted===true && !scope.unrestricted)return "blocked";
      const executionDescriptor=getOperationDescriptor(descriptor.id);
      if(!executionDescriptor)return "blocked";
      if(executionDescriptor.securityClass==="task_control") {
        const checkOwner=(id:unknown):boolean=>{
          if(typeof id!=="string"||!id) return false;
          const task=getTaskPlan(id);
          const ctx=task?.executionContext;
          return !!ctx && ctx.principalId===principal.id &&
            ctx.sessionId===scope.sessionId && ctx.origin===principal.origin;
        };
        const taskIds:unknown[]=[];
        if(typeof data.taskId==="string") taskIds.push(data.taskId);
        if(typeof data.sourceTaskId==="string") taskIds.push(data.sourceTaskId);
        if(typeof data.targetTaskId==="string") taskIds.push(data.targetTaskId);
        if(data.approvalId!==undefined) {
          const request=typeof data.approvalId==="number" && Number.isSafeInteger(data.approvalId)
            ? getApprovalRequest(data.approvalId):undefined;
          if(!request) return "blocked";
          taskIds.push(request.task_id);
        }
        if(taskIds.some(id=>!checkOwner(id))) return "blocked";
        const requiredTaskId=new Set([
          "task_get","task_run","task_report","task_cancel","task_reconcile",
          "task_replay","task_append_steps","task_links",
        ]);
        if(requiredTaskId.has(descriptor.id) && typeof data.taskId!=="string") return "blocked";
        if(descriptor.id==="task_link" &&
           (typeof data.sourceTaskId!=="string"||typeof data.targetTaskId!=="string"))
          return "blocked";
        if(["task_approve","task_resume"].includes(descriptor.id) && taskIds.length!==1)
          return "blocked";
      }
      // Scope selection cannot add a new permitted root; persistent pool
      // changes require the exact approved task, even with autoapproval enabled.
      if(descriptor.id==="set_workspace") {
        const target=data.path;
        if(typeof target!=="string") return "blocked";
        const allowed=listWorkspaceRoots().filter(root=>root.exists).map(root=>root.path);
        // Selection may target another PREAUTHORIZED root; validating against
        // the current root would incorrectly make that safe switch impossible.
        try { if(!isAllowedRoot(fs.realpathSync(path.resolve(target)),allowed)) return "blocked"; }
        catch { return "blocked"; }
      }
      if(scope.unrestricted)return "approval_required";
      if(!executionDescriptor.id.startsWith("task_") &&
          !executionDescriptor.id.startsWith("project_") &&
          !executionDescriptor.id.startsWith("memory_")) {
        const decision=policyDecisionPoint.evaluate({tool:descriptor.id,arguments:data});
        if(!decision.allowed) return "blocked";
        if(decision.requiresApproval) return "approval_required";
      }
      // Control operations enter the same application authorization boundary;
      // their own Task/Approval lifecycle still guards subsequent effects.
      return "allowed";
    }},
    approvals:{async verify({approvalId,taskId,stepId,toolId,args,scope,principal}){
      const record=getApprovalRequest(approvalId);
      const plan=getTaskPlan(taskId);
      const step=plan?.steps.find(item=>item.id===stepId);
      const ctx=plan?.executionContext;
      if(!record||!step||!ctx||!record.request_fingerprint||
         !record.expires_at||record.expires_at<=new Date().toISOString()||
         record.status!=="consumed"||record.dispatched_at!==null||
         record.task_id!==taskId||record.step_id!==stepId||
         record.tool_id!==toolId||record.action!==step.action||
         record.principal_id!==principal.id||record.session_id!==scope.sessionId||
         ctx.principalId!==principal.id||ctx.sessionId!==scope.sessionId||
         ctx.workspace!==scope.root||
         (ctx.unrestricted || requestsUnrestrictedEffect(toolId,args))!==scope.unrestricted ||
         (scope.root!==null &&
          (!(ctx.allowedRootsSnapshot??ctx.roots).includes(scope.root) ||
           scope.allowedRoots.length!==1 || scope.allowedRoots[0]!==scope.root)) ||
         (scope.root===null && scope.allowedRoots.length!==0))
        return false;
      let actual:string;
      try {actual=fingerprintTaskEffect({
        taskId,stepId,action:step.action,toolId,args,context:ctx,
      });}catch{return false;}
      if(actual!==record.request_fingerprint)return false;
      // Atomic, single-use claim precedes the effect. On crash the request
      // remains dispatched and must be reconciled rather than replayed.
      return claimApprovedTaskEffect({
        approvalId,taskId,stepId,toolId,requestFingerprint:actual,
        principalId:principal.id,sessionId:scope.sessionId,
      });
    }},
    handler:{async execute(id,args,scope){
      if(scope.unrestricted)
        return runWithApprovedUnrestrictedScope(()=>handler.execute(id,args,scope));
      return handler.execute(id,args,scope);
    }},
    audit:{async record(event){
      saveDecisionWithContext({action:"r2_gateway:"+event.action,reason:event.status,
        context:{correlationId:event.correlationId,createdAt:new Date().toISOString()}});
    }},
    securityEvents:{async record(event){
      saveDecisionWithContext({action:"r2_security:"+event.kind,
        reason:event.reason??"denied"});
    }},
  });
}
export async function requireSuccessfulGateway(result:ToolExecutionResult):Promise<unknown> {
  if(result.kind==="succeeded") return result.output;
  throw new Error(result.kind==="approval_required"
    ? "Approval required: "+result.reason : result.reason);
}
export function trustedLocalTaskScope(input:{
  readonly taskId:TaskId; readonly stepId:StepId;
  readonly workspace:string|null; readonly roots:readonly string[];
  readonly unrestricted:boolean; readonly principalId?:PrincipalId; readonly sessionId?:SessionId;
}):WorkspaceScope {
  const identity=getTrustedInboundIdentity();
  const owner=input.principalId??identity.principal.id;
  const session=input.sessionId??identity.sessionId;
  return captureWorkspaceScope({
    principalId:owner,sessionId:session,root:input.workspace,allowedRoots:input.roots,
    unrestricted:input.unrestricted,capturedAt:new Date().toISOString(),
  });
}