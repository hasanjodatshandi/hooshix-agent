export type DomainErrorCode =
  | "INVALID_ID" | "INVALID_TASK" | "DUPLICATE_STEP" | "MISSING_DEPENDENCY"
  | "CYCLIC_DEPENDENCY" | "TASK_TERMINAL" | "OUTCOME_UNRESOLVED"
  | "AUTHORIZATION_DENIED" | "APPROVAL_REQUIRED" | "IDEMPOTENCY_CONFLICT";
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
