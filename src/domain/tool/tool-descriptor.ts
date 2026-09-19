import type { ToolId } from "../shared/ids.js";
export type PermissionLevel = "READ" | "DEVELOPER" | "ADMIN";
export type ToolRisk = "low" | "medium" | "high" | "critical";
export type ToolEffect = "read_only" | "idempotent_mutation" | "non_idempotent_mutation";
export type ToolWorkspaceClass = "none" | "read" | "write" | "scope_mutation" | "process";
export type ApprovalPolicy = "never" | "on-risk" | "always" | "admin-and-approval";
export interface ToolDescriptor {
  readonly id: ToolId;
  readonly requiredPermission: PermissionLevel;
  readonly risk: ToolRisk;
  readonly approval: ApprovalPolicy;
  readonly effect: ToolEffect;
  readonly workspaceScope: ToolWorkspaceClass;
  readonly supportsIdempotency: boolean;
  readonly capabilities: readonly string[];
}
