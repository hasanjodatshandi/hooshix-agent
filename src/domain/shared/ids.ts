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
