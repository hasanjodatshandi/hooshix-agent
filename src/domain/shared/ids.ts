/** Branded identifiers prevent cross-aggregate mixups without runtime dependencies. */
declare const identity: unique symbol;
export type BrandedId<Kind extends string> = string & { readonly [identity]: Kind };
export type TaskId = BrandedId<"TaskId">;
export type StepId = number & { readonly [identity]: "StepId" };
export type ToolId = BrandedId<"ToolId">;
export type ApprovalId = BrandedId<"ApprovalId">;
export type ExecutionId = BrandedId<"ExecutionId">;
export type PrincipalId = BrandedId<"PrincipalId">;
export type SessionId = BrandedId<"SessionId">;
export type CorrelationId = BrandedId<"CorrelationId">;
export type IdempotencyKey = BrandedId<"IdempotencyKey">;
/**
 * CI-1.01 — Chat Isolation identifiers. A Context is an independent execution
 * environment (workspace, plan/task/approval, DB, logs); a Binding ties one
 * verified credential/connection to exactly one Context; a Grant is a
 * workspace authorization held by a Context. See docs/implementation/CI_MASTER_PLAN.md.
 */
export type ContextId = BrandedId<"ContextId">;
export type BindingId = BrandedId<"BindingId">;
export type GrantId = BrandedId<"GrantId">;
export type ConnectionId = BrandedId<"ConnectionId">;
export type IntentId = BrandedId<"IntentId">;
export type FencingToken = BrandedId<"FencingToken">;
/** Monotonic ownership epoch. Bumped atomically on every transfer so a worker
 *  holding a stale epoch cannot commit after handoff (threat T08). */
export type ContextEpoch = number & { readonly [identity]: "ContextEpoch" };
export type Instant = string & { readonly [identity]: "Instant" };
export function requireNonblankId<T extends string>(value: string, label: string): BrandedId<T> {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new DomainIdError(label);
  return value as BrandedId<T>;
}
export class DomainIdError extends Error {
  readonly code = "INVALID_ID";
  constructor(label: string) { super("Invalid " + label); this.name = "DomainIdError"; }
}
export function requireStepId(value: number): StepId {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DomainIdError("StepId");
  return value as StepId;
}
/** CI-1.01 — ownership epochs start at 1 and only ever increase. */
export function requireContextEpoch(value: number): ContextEpoch {
  if (!Number.isSafeInteger(value) || value < 1) throw new DomainIdError("ContextEpoch");
  return value as ContextEpoch;
}
