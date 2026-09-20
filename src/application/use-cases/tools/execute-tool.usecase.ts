import type { Principal } from "../../../domain/auth/principal.js";
import type { ToolDescriptor } from "../../../domain/tool/tool-descriptor.js";
import type { CorrelationId, SessionId, StepId, TaskId, ToolId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
import type { ToolInputValidatorPort } from "../../ports/outbound/operations.port.js";
import type { AuditPort, SecurityEventPort, WorkspaceContextRepository } from "../../ports/outbound/support.port.js";
import type { AuthorizationService } from "../../services/authorization-service.js";

export type ToolExecutionResult =
  | { readonly kind: "succeeded"; readonly output: unknown; readonly observabilityDegraded?: boolean }
  | { readonly kind: "approval_required"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "outcome_unknown"; readonly reason: string };

export interface ToolHandlerPort {
  execute(toolId: ToolId, args: unknown, scope: WorkspaceScope): Promise<unknown>;
}
export interface ToolDescriptorPort { get(id: ToolId): ToolDescriptor | null; }

export interface ExecuteToolCommand {
  readonly principal: Principal;
  readonly descriptorId: ToolId;
  readonly arguments: unknown;
  readonly correlationId?: CorrelationId;
  /** Direct requests resolve workspace from the trusted principal/session repository, never from arguments. */
  readonly directContext?: { readonly sessionId: SessionId };
  /** Task scopes are immutable captured state and never use the direct caller's current workspace. */
  readonly taskContext?: {
    readonly taskId: TaskId;
    readonly stepId: StepId;
    readonly workspaceScope: WorkspaceScope;
  };
}
export interface ExecuteToolUseCase { execute(input: ExecuteToolCommand): Promise<ToolExecutionResult>; }

export function createExecuteToolUseCase(deps: {
  readonly catalog: ToolDescriptorPort;
  readonly validator: ToolInputValidatorPort;
  readonly authorization: AuthorizationService;
  readonly handler: ToolHandlerPort;
  readonly audit: AuditPort;
  readonly workspace: WorkspaceContextRepository;
  readonly securityEvents?: SecurityEventPort;
}): ExecuteToolUseCase {
  async function deny(principal: Principal, toolId: ToolId, reason: string): Promise<ToolExecutionResult> {
    try { await deps.securityEvents?.record({kind:"authorization_denied",principalId:principal.id,toolId,reason}); }
    catch { /* A failed security event cannot authorize a denied operation. */ }
    return {kind:"blocked",reason};
  }

  return {
    async execute(input) {
      const {principal, descriptorId, arguments: args, directContext, taskContext} = input;
      if (!principal || !principal.id || !descriptorId) return {kind:"blocked",reason:"invalid_execution_identity"};
      const descriptor = deps.catalog.get(descriptorId);
      if (!descriptor) return deny(principal,descriptorId,"unknown_tool");

      const modes = Number(directContext !== undefined) + Number(taskContext !== undefined);
      if (modes !== 1) return deny(principal,descriptorId,"ambiguous_or_missing_execution_context");

      const validated = deps.validator.validate(descriptorId,args);
      if (!validated.valid) return deny(principal,descriptorId,"invalid_arguments");

      let scope: WorkspaceScope | null = null;
      if (taskContext !== undefined) {
        if (!taskContext.taskId || !Number.isSafeInteger(taskContext.stepId) || taskContext.stepId <= 0)
          return deny(principal,descriptorId,"invalid_task_context");
        scope=taskContext.workspaceScope;
      } else if (directContext !== undefined) {
        if (!directContext.sessionId)
          return deny(principal,descriptorId,"workspace_repository_unavailable");
        try { scope=await deps.workspace.get(directContext.sessionId,principal.id); }
        catch { return deny(principal,descriptorId,"workspace_resolution_failed"); }
        if (!scope || scope.sessionId !== directContext.sessionId)
          return deny(principal,descriptorId,"workspace_session_not_found");
      }
      if (!scope || scope.principalId !== principal.id)
        return deny(principal,descriptorId,"principal_scope_mismatch");

      const decision=deps.authorization.decide({principal,descriptor,scope});
      if (decision.kind!=="allowed") {
        if (decision.kind==="blocked") return deny(principal,descriptorId,decision.reason);
        return decision;
      }

      // R2.02 establishes the single application entry point. Mutating dispatch remains
      // fail-closed until R2.03 exact approval binding and R2.04-R2.09 runtime cutover.
      if (descriptor.effect!=="read_only" || descriptor.approval!=="never" || descriptor.workspaceScope==="scope_mutation")
        return {kind:"approval_required",reason:"mutation_requires_verified_task_approval"};

      let result:ToolExecutionResult;
      try {
        result={kind:"succeeded",output:await deps.handler.execute(descriptorId,validated.value,scope)};
      } catch {
        result={kind:"failed",reason:"tool_handler_failure"};
      }
      try {
        await deps.audit.record({
          action:descriptorId,
          correlationId:input.correlationId ?? ("r2-application-gateway" as CorrelationId),
          status:result.kind,
        });
      } catch {
        if (result.kind==="succeeded") return {...result,observabilityDegraded:true};
      }
      return result;
    },
  };
}