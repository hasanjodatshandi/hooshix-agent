import type { Principal } from "../../../domain/auth/principal.js";
import type { ToolDescriptor } from "../../../domain/tool/tool-descriptor.js";
import type { ToolId } from "../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
import type { ToolInputValidatorPort } from "../../ports/outbound/operations.port.js";
import type { AuditPort } from "../../ports/outbound/support.port.js";
import type { AuthorizationService } from "../../services/authorization-service.js";
export type ToolExecutionResult =
 | { readonly kind: "succeeded"; readonly output: unknown; readonly observabilityDegraded?: boolean }
 | { readonly kind: "approval_required"; readonly reason: string }
 | { readonly kind: "blocked"; readonly reason: string }
 | { readonly kind: "failed"; readonly reason: string }
 | { readonly kind: "outcome_unknown"; readonly reason: string };
export interface ToolHandlerPort { execute(toolId: ToolId, args: unknown, scope: WorkspaceScope): Promise<unknown>; }
export interface ToolDescriptorPort { get(id: ToolId): ToolDescriptor | null; }
export interface ExecuteToolUseCase {
 execute(input: { readonly principal: Principal; readonly descriptorId: ToolId; readonly arguments: unknown; readonly scope: WorkspaceScope }): Promise<ToolExecutionResult>;
}
/** R1 bounded vertical-slice prototype: read-only only. It is not connected to legacy MCP/Tasks before R2. */
export function createExecuteToolUseCase(deps: {
 readonly catalog: ToolDescriptorPort; readonly validator: ToolInputValidatorPort;
 readonly authorization: AuthorizationService; readonly handler: ToolHandlerPort; readonly audit: AuditPort;
}): ExecuteToolUseCase {
 return { async execute({ principal, descriptorId, arguments: args, scope }) {
   const descriptor = deps.catalog.get(descriptorId);
   if (!descriptor) return { kind: "blocked", reason: "unknown_tool" };
   const checked = deps.validator.validate(descriptorId, args);
   if (!checked.valid) return { kind: "blocked", reason: "invalid_arguments" };
   const decision = deps.authorization.decide({ principal, descriptor, scope });
   if (decision.kind !== "allowed") return decision;
   // R1 never authorizes a side effect even if a supplied policy is permissive.
   if (descriptor.effect !== "read_only" || descriptor.approval !== "never")
     return { kind: "approval_required", reason: "mutation_not_wired_in_r1" };
   let result: ToolExecutionResult;
   try {
     result = { kind: "succeeded", output: await deps.handler.execute(descriptorId, checked.value, scope) };
   } catch {
     result = { kind: "failed", reason: "tool_handler_failure" };
   }
   try { await deps.audit.record({ action: descriptorId, correlationId: "r1-architecture" as never, status: result.kind }); }
   catch { if (result.kind === "succeeded") return { ...result, observabilityDegraded: true }; }
   return result;
 } };
}
