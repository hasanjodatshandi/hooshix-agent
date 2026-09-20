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
/** Pure application ports. Concrete argument classifiers, approvals and handlers live in composition. */
export interface ToolOperationPolicyPort {
  classify(input: { readonly descriptor: ToolDescriptor; readonly args: unknown; readonly scope: WorkspaceScope; readonly principal: Principal }):
    Promise<"allowed" | "approval_required" | "blocked"> | "allowed" | "approval_required" | "blocked";
}
export interface ToolApprovalVerifierPort {
  verify(input: { readonly approvalId: number; readonly taskId: TaskId; readonly stepId: StepId;
    readonly toolId: ToolId; readonly args: unknown; readonly scope: WorkspaceScope; readonly principal: Principal }): Promise<boolean>;
}


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
    /** Supplied only by the trusted task runtime after persisted approval consumption. */
    readonly approvalId?: number;
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
  readonly operationPolicy?: ToolOperationPolicyPort;
  readonly approvals?: ToolApprovalVerifierPort;
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

      // First enforce identity/role/workspace. An operation-specific classifier
      // cannot bypass the server ceiling, even if its decision is "allowed".
      const initial=deps.authorization.decide({principal,descriptor,scope});
      if (initial.kind==="blocked") return deny(principal,descriptorId,initial.reason);

      let operationPolicy:"allowed"|"approval_required"|"blocked" = "allowed";
      if (deps.operationPolicy) {
        try { operationPolicy=await deps.operationPolicy.classify({descriptor,args:validated.value,scope,principal}); }
        catch { return deny(principal,descriptorId,"operation_policy_unavailable"); }
      } else if (descriptor.effect!=="read_only" || descriptor.workspaceScope==="scope_mutation") {
        operationPolicy="approval_required";
      }
      if (operationPolicy==="blocked") return deny(principal,descriptorId,"operation_policy_blocked");

      // Never accept an approval fingerprint or "approved" flag from tool args.
      // The verifier must consult the persisted, single-use approval bound to
      // the exact task, step, tool, args and immutable workspace scope.
      let approvalVerified=false;
      if (taskContext?.approvalId!==undefined) {
        if (!Number.isSafeInteger(taskContext.approvalId) || taskContext.approvalId<=0 || !deps.approvals)
          return deny(principal,descriptorId,"invalid_approval_context");
        try {
          approvalVerified=await deps.approvals.verify({
            approvalId:taskContext.approvalId,taskId:taskContext.taskId,stepId:taskContext.stepId,
            toolId:descriptorId,args:validated.value,scope,principal,
          });
        } catch { return deny(principal,descriptorId,"approval_verification_failed"); }
        if (!approvalVerified) return deny(principal,descriptorId,"approval_not_bound_to_exact_operation");
      }

      const needsApproval=descriptor.approval==="always" || descriptor.approval==="admin-and-approval" ||
        operationPolicy==="approval_required" ||
        (descriptor.effect!=="read_only" && !deps.operationPolicy);
      if (needsApproval && !approvalVerified)
        return {kind:"approval_required",reason:"verified_task_approval_required"};

      const decision=deps.authorization.decide({principal,descriptor,scope,operationPolicy,approvalVerified});
      if (decision.kind!=="allowed") {
        if (decision.kind==="blocked") return deny(principal,descriptorId,decision.reason);
        return decision;
      }

      let result:ToolExecutionResult;
      try {
        result={kind:"succeeded",output:await deps.handler.execute(descriptorId,validated.value,scope)};
      } catch (error) {
        // Only expose a fixed, non-secret control-plane error code. Never echo
        // arbitrary subprocess stderr, filesystem paths or credential-bearing messages.
        const knownBudgetFailure=error instanceof Error &&
          error.message.includes("maxConsecutiveFailures");
        result={kind:"failed",reason:knownBudgetFailure
          ?"maxConsecutiveFailures_budget_exhausted":"tool_handler_failure"};
      }
      // Persist a distinct security decision event for any successfully
      // executed privilege elevation or workspace mutation. The exact
      // one-use approval is already consumed before handler dispatch; this
      // event cannot itself authorize an effect or replay a consumed request.
      if (result.kind==="succeeded" &&
          (scope.unrestricted || descriptor.workspaceScope==="scope_mutation")) {
        try {
          await deps.securityEvents?.record({
            kind:scope.unrestricted?"approved_unrestricted_effect_executed":"workspace_mutation_executed",
            principalId:principal.id,toolId:descriptorId,
            reason:taskContext
              ? `task=${taskContext.taskId};step=${taskContext.stepId};approval=${taskContext.approvalId??"none"}`
              : "direct_authorized_selection",
          });
        } catch {
          // An audit sink failure after a known side effect is degradation,
          // not an execution failure that could trigger a duplicate retry.
          result={...result,observabilityDegraded:true};
        }
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