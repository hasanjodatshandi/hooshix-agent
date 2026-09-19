import type { Principal } from "../../domain/auth/principal.js";
import type { ToolDescriptor, PermissionLevel } from "../../domain/tool/tool-descriptor.js";
import type { WorkspaceScope } from "../../domain/workspace/workspace-scope.js";
export type AuthorizationDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "approval_required"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string };
const PERMISSION_ORDER: Readonly<Record<PermissionLevel,number>> = { READ: 0, DEVELOPER: 1, ADMIN: 2 };
export interface AuthorizationService { decide(input: { readonly principal: Principal; readonly descriptor: ToolDescriptor; readonly scope: WorkspaceScope; readonly approvedActionFingerprint?: string }): AuthorizationDecision; }
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
