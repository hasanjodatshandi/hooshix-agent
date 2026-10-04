/**
 * CI-1.03 — Chat Isolation error codes (design 09 §2).
 *
 * These live in the domain, not in `core/errors.ts`, because the application
 * layer has to raise them and the G1 layering rule forbids `application/` from
 * importing `core/`. `core/errors.ts` keeps its own taxonomy for the execution
 * loop; the only error that crosses into the loop today is
 * CONTEXT_EPOCH_STALE, which the lease adapter raises directly from `core/`.
 *
 * Each message is a stable lowercase sentinel. The Owner Console (CI-G6b) maps
 * them to HTTP status codes, and they are deliberately indistinguishable in
 * detail: the server must not become an oracle that lets one chat probe which
 * Context or record another chat owns (threat T07).
 */
export type ContextErrorCode =
  | "CONTEXT_NOT_BOUND"
  | "CONTEXT_INACTIVE"
  | "RESOURCE_UNAVAILABLE"
  | "SCOPE_INSUFFICIENT"
  | "WORKSPACE_DENIED"
  | "HANDOFF_APPROVAL_REQUIRED"
  | "TRANSFER_IN_PROGRESS"
  | "HANDOFF_TOKEN_EXPIRED";

/**
 * Base class so every isolation refusal carries a typed `code` the gateway can
 * switch on, mirroring `AgentError` without depending on it. Kept structurally
 * identical (a `code` field plus a stable `name`) so a caller that handles one
 * handles all.
 */
export class ContextError extends Error {
  readonly code: ContextErrorCode;

  constructor(code: ContextErrorCode, message: string) {
    super(message);
    this.name = "ContextError";
    this.code = code;
  }
}

export class ContextNotBoundError extends ContextError {
  constructor() {
    super("CONTEXT_NOT_BOUND", "context_not_bound");
    this.name = "ContextNotBoundError";
  }
}

export class ContextInactiveError extends ContextError {
  constructor() {
    super("CONTEXT_INACTIVE", "context_inactive");
    this.name = "ContextInactiveError";
  }
}

export class TransferInProgressError extends ContextError {
  constructor() {
    super("TRANSFER_IN_PROGRESS", "transfer_in_progress");
    this.name = "TransferInProgressError";
  }
}
