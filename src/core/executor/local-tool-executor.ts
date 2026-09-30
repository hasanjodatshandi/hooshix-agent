import type { TaskStep } from "../../application/dto/legacy-task-plan.js";
import { validateToolName, type ToolName } from "../../application/services/legacy-tool-orchestrator.js";
import { auditToolCall } from "../memory/tool-audit.js";
import { dispatchToHandler } from "./legacy-tool-handler-composition.js";
import { resolveTaskWorkspace } from "../../security/task-workspace.js";
import { runWithWorkspaceScope } from "../../security/workspace-guard.js";
import { getActiveWorkspace, isUnrestrictedMode } from "../../security/workspace-guard.js";
import { createR2RuntimeGateway, requireSuccessfulGateway } from "./r2-runtime-gateway.js";
import { getTrustedTaskApproval } from "../governance/r2-trusted-task-approval.js";
import { runWithPolicyApproval } from "../governance/policy-decision-point.js";
import { requestsUnrestrictedEffect, hasInvalidUnrestrictedArgument } from "../governance/r2-unrestricted-operation.js";
import { getTrustedInboundIdentity } from "../runtime/r2-trusted-inbound-identity.js";
import { captureWorkspaceScope } from "../../domain/workspace/workspace-scope.js";
import type { Principal } from "../../domain/auth/principal.js";
import type { PrincipalId, SessionId, TaskId, StepId, ToolId } from "../../domain/shared/ids.js";
import { getConfiguredPermissionLevel } from "../../infrastructure/config/permission-config.js";

/**
 * Tools whose handler returns a subset of fields that need enrichment
 * to match the MCP tool registration output (used by template resolver).
 */
const FILE_TOOLS_WITH_PATH = new Set<ToolName>([
  "read_file", "write_file", "create_file", "modify_file",
  "delete_file", "restore_file", "list_directory", "search_files",
]);

/**
 * Enrich raw handler result with context fields so template resolver
 * can access {{stepN.output.path}}, {{stepN.output.backupId}}, etc.
 * This makes local executor output consistent with MCP tool output.
 */
function enrichResult(tool: ToolName, args: Record<string, unknown>, raw: unknown): unknown {
  if (raw === undefined || raw === null) return raw;
  // If the handler already returned a rich object, don't override
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    // Already has meaningful fields (backupId, text, etc.) — merge missing context
    if (FILE_TOOLS_WITH_PATH.has(tool) && "path" in args && !("path" in obj)) {
      return { ...obj, path: args.path };
    }
    if (tool === "create_file" && "path" in args && !("path" in obj)) {
      return { ...obj, path: args.path, created: true };
    }
    return raw;
  }
  // read_file returns a string — leave as-is (template resolver doesn't need {{stepN.output.text}})
  // list_directory and search_files return arrays — leave as-is
  return raw;
}

import type { TaskExecutionContext } from "../../application/dto/legacy-task-plan.js";

export function createLocalToolExecutor(correlationId: string, taskId?: string, executionContext?: TaskExecutionContext) {
  return async (tool: string, step: TaskStep, signal?: AbortSignal): Promise<unknown> => {
    const validatedTool = validateToolName(tool);
    const input = step.arguments ?? {};
    if(hasInvalidUnrestrictedArgument(validatedTool,input))throw new Error("invalid_unrestricted_operation");
    // NOTE: deliberately NOT wrapped in runWithPolicyApproval here. Approval
    // context is granted ONLY by the task loop for steps that passed a real
    // approval (closed-agent-loop wraps approval_required steps after
    // task_approve/task_resume). A blanket wrap here would auto-satisfy every
    // policy gate invoked inside handlers (e.g. the execute_command cwd
    // escalation) — that was the task_run workspace-isolation bypass.
    // R2: Task executor and direct MCP enter the same application gateway.
    // Derive scope ONLY from the persisted Task snapshot, never the current
    // direct caller/session or arguments. Historical unbound Task approval
    // records cannot authorize a new effect.
    if (!executionContext || !taskId) {
      // A standalone helper call has no persisted Task approval or Task scope.
      // Route it through the same *direct* policy, never synthesize a Task grant.
      const identity=getTrustedInboundIdentity();
      const direct=()=>auditToolCall(tool,correlationId,undefined,async()=>{
        const gateway=createR2RuntimeGateway({
          execute:async(id,args)=> {
            const active=getActiveWorkspace();
            return dispatchToHandler(id as ToolName,args as Record<string,unknown>,
              correlationId,{workspace:active,roots:active?[active]:[],
                unrestricted:isUnrestrictedMode()},signal);
          },
        });
        return requireSuccessfulGateway(await gateway.execute({
          principal:identity.principal,descriptorId:validatedTool as ToolId,
          arguments:input,directContext:{sessionId:identity.sessionId},
        }));
      });
      return enrichResult(validatedTool,input,await direct());
    }
    const owner=executionContext.principalId ?? "local-stdio";
    const session=executionContext.sessionId ?? "local-stdio-session";
    const capturedRoots=executionContext.allowedRootsSnapshot ?? executionContext.roots;
    const active=executionContext.workspace;
    const legacyLocal=executionContext.origin===undefined &&
      owner==="local-stdio" && getTrustedInboundIdentity().principal.origin==="local_stdio";
    const principal:Principal={
      id:owner as PrincipalId,
      origin:executionContext.origin ?? (legacyLocal?"local_stdio":undefined),
      scopes:[...(executionContext.scopes??[])],
      permission:({READ_ONLY:"READ",PROJECT_ACCESS:"PROJECT_ACCESS",DEVELOPER_MODE:"DEVELOPER",ADMIN_MODE:"ADMIN"} as const)[getConfiguredPermissionLevel()],
    };
    const scope=captureWorkspaceScope({
      principalId:principal.id,sessionId:session as SessionId,root:active,
      allowedRoots:active?[active]:[],
      unrestricted:executionContext.unrestricted || requestsUnrestrictedEffect(validatedTool,input),
      capturedAt:executionContext.createdAt ?? new Date().toISOString(),
    });
    // The snapshot of the root pool is preserved by the plan, but a Task
    // receives file access only to its originally selected workspace.
    if(active && !capturedRoots.includes(active)) throw new Error("task_workspace_not_in_captured_roots");
    const execute=()=>auditToolCall(tool,correlationId,taskId,async()=>{
      const gateway=createR2RuntimeGateway({
        execute:async(id,args)=>{
          const dispatch=()=>dispatchToHandler(id as ToolName,args as Record<string,unknown>,
            correlationId,executionContext,signal);
          // This handler port runs only AFTER authorization and the atomic
          // single-use exact-action approval claim. No Task-loop or caller
          // may activate the legacy service-level compatibility flag.
          return getTrustedTaskApproval()!==undefined
            ? runWithPolicyApproval(id,dispatch)
            : dispatch();
        },
      });
      const result=await gateway.execute({
        principal,descriptorId:validatedTool as ToolId,arguments:input,
        taskContext:{taskId:taskId as TaskId,stepId:step.id as StepId,
          workspaceScope:scope,approvalId:getTrustedTaskApproval()},
      });
      return requireSuccessfulGateway(result);
    });
    const resolvedWorkspace = resolveTaskWorkspace(executionContext);
    const raw = await (resolvedWorkspace.workspace
      ? runWithWorkspaceScope(resolvedWorkspace.workspace, execute)
      : execute());
    return enrichResult(validatedTool, input, raw);
  };
}