import type { Principal } from "../../domain/auth/principal.js";
import { getOperationDescriptor } from "./operation-catalog.js";
import type { ToolDescriptor, PermissionLevel } from "../../domain/tool/tool-descriptor.js";
import type { WorkspaceScope } from "../../domain/workspace/workspace-scope.js";
export type AuthorizationDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "approval_required"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string };
const PERMISSION_ORDER: Readonly<Record<PermissionLevel,number>> = { READ: 0, PROJECT_ACCESS: 1, DEVELOPER: 2, ADMIN: 3 };
export interface AuthorizationService { decide(input: { readonly principal: Principal; readonly descriptor: ToolDescriptor; readonly scope: WorkspaceScope; readonly operationPolicy?: "allowed" | "approval_required" | "blocked"; readonly approvalVerified?: boolean }): AuthorizationDecision; }
/** R1 minimal fail-closed authorization. R2 will add effective scope and exact-action binding. */
export function createR1AuthorizationService(): AuthorizationService {
 return { decide({ principal, descriptor, scope }) {
   if (!principal.id || principal.id !== scope.principalId) return { kind: "blocked", reason: "principal_scope_mismatch" };
   if (PERMISSION_ORDER[principal.permission] < PERMISSION_ORDER[descriptor.requiredPermission]) return { kind: "blocked", reason: "insufficient_permission" };
   if (descriptor.workspaceScope !== "none" && (scope.root === null || !scope.allowedRoots.includes(scope.root))) return { kind: "blocked", reason: "workspace_missing_or_ungranted" };
   if (descriptor.approval !== "never" || descriptor.effect !== "read_only" || descriptor.workspaceScope === "scope_mutation")
     return { kind: "approval_required", reason: "r1_no_mutation_or_scope_expansion_dispatch" };
   return { kind: "allowed" };
 } };
}
/**
 * R2 application policy; takes server ceiling from validated infrastructure config.
 * An inbound transport must establish principal.origin and may only supply its
 * authenticated scopes; a claimed descriptor/approval fingerprint is not a grant.
 */
export function createAuthorizationService(settings: {
  readonly serverCeiling: PermissionLevel;
  readonly allowUnrestricted: boolean;
}): AuthorizationService {
  function blocked(reason: string): AuthorizationDecision { return {kind:"blocked", reason}; }
  const ceilingRank=PERMISSION_ORDER[settings.serverCeiling];
  return { decide(input) {
    const {principal,descriptor,scope}=input;
    if (!principal?.id || !scope || scope.principalId!==principal.id) return blocked("principal_scope_mismatch");
    if (principal.origin!=="local_stdio" && principal.origin!=="http_oauth") return blocked("untrusted_principal_origin");
    const canonical=getOperationDescriptor(descriptor.id);
    if (!canonical) return blocked("unknown_operation");
    if (descriptor.requiredPermission !== canonical.requiredPermission || descriptor.effect !== canonical.effect || descriptor.approval !== canonical.approval || descriptor.workspaceScope !== canonical.workspaceScope || descriptor.risk !== canonical.risk) return blocked("descriptor_metadata_mismatch");
    if (PERMISSION_ORDER[principal.permission]===undefined || ceilingRank===undefined) return blocked("invalid_permission_level");
    if (PERMISSION_ORDER[canonical.requiredPermission]>ceilingRank) return blocked("server_permission_ceiling");
    if (PERMISSION_ORDER[canonical.requiredPermission]>PERMISSION_ORDER[principal.permission]) return blocked("principal_permission_insufficient");

    if (principal.origin==="http_oauth") {
      const requiredScope=canonical.securityClass==="monitoring"?"hooshix:monitoring:read"
        :canonical.securityClass==="workspace_scope"?"hooshix:workspace:manage"
        :canonical.securityClass==="task_control"?"hooshix:task:manage"
        :canonical.securityClass==="process" || canonical.securityClass==="git_mutation" || canonical.securityClass==="package_mutation"?"hooshix:execute"
        :canonical.effect==="read_only"?"hooshix:read":"hooshix:project:write";
      if (!principal.scopes.includes(requiredScope)) return blocked("principal_scope_insufficient");
    }

    if (scope.unrestricted) {
      if (!settings.allowUnrestricted || PERMISSION_ORDER[principal.permission]<PERMISSION_ORDER.ADMIN || ceilingRank<PERMISSION_ORDER.ADMIN)
        return blocked("unrestricted_requires_server_allow_and_admin");
      if (principal.origin==="http_oauth" && !principal.scopes.includes("hooshix:admin"))
        return blocked("unrestricted_requires_admin_oauth_scope");
      // A server configuration bit or old global flag is never itself an
      // authorization grant. Each unrestricted effect needs an exact, consumed
      // and single-use Task approval bound to the requested arguments.
      if (!input.approvalVerified)
        return {kind:"approval_required",reason:"unrestricted_exact_task_approval_required"};
    }
    if (canonical.workspaceScope!=="none" && canonical.workspaceScope!=="scope_mutation") {
      if (!scope.root || !scope.allowedRoots.includes(scope.root)) return blocked("workspace_missing_or_ungranted");
    }

    // The only approvalVerified source is the gateway's trusted ApprovalVerifierPort.
    // In the absence of concrete per-argument policy, effectful operations fail closed.
    const policy = input.operationPolicy;
    if (policy==="blocked") return blocked("operation_policy_blocked");
    if (policy==="approval_required" && !input.approvalVerified)
      return {kind:"approval_required",reason:"operation_specific_approval_required"};
    if (canonical.approval==="always" || canonical.approval==="admin-and-approval") {
      if (!input.approvalVerified) return {kind:"approval_required",reason:"verified_task_approval_required"};
    } else if (canonical.approval==="on-risk") {
      if ((canonical.effect!=="read_only" || canonical.workspaceScope==="scope_mutation") &&
          policy!=="allowed" && !input.approvalVerified)
        return {kind:"approval_required",reason:"argument_policy_or_verified_approval_required"};
    } else if (canonical.effect!=="read_only" && policy!=="allowed" && !input.approvalVerified) {
      return {kind:"approval_required",reason:"unknown_mutation_policy"};
    }
    return {kind:"allowed"};
  }};
}