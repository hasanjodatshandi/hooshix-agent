/**
 * Typed error taxonomy for the execution loop. Recovery decisions and the
 * closed-agent-loop switch on these codes instead of fragile message
 * substrings — the previous substring classifier silently misrouted every
 * timeout ("timed out" vs "timeout") to `stop` instead of `retry`.
 */

export type ErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "SECURITY_POLICY"
  | "MISSING_CONTEXT_VARIABLE"
  | "FILE_NOT_FOUND"
  | "APPROVAL_REQUIRED"
  | "INVALID_ARGUMENT"
  | "UNKNOWN_TOOL"
  | "GOVERNANCE_BLOCKED"
  | "WORKSPACE_CONTEXT_INVALID"
  | "MEMORY_CONTENT_REQUIRED"
  | "EXECUTION"
  /**
   * CI-1.03 — Chat Isolation error codes (design 09 §2). They exist so the
   * gateway can distinguish "refused by isolation policy" from a generic
   * EXECUTION failure, without leaking which Context or record was involved.
   */
  | "CONTEXT_NOT_BOUND"
  | "CONTEXT_INACTIVE"
  | "RESOURCE_UNAVAILABLE"
  | "SCOPE_INSUFFICIENT"
  | "WORKSPACE_DENIED"
  | "CONTEXT_EPOCH_STALE"
  | "HANDOFF_APPROVAL_REQUIRED"
  | "TRANSFER_IN_PROGRESS"
  | "HANDOFF_TOKEN_EXPIRED"
  | "WORKTREE_CONFLICT";

export class AgentError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentError";
    this.code = code;
  }
}

export class TimeoutError extends AgentError {
  constructor(timeoutMs: number) {
    super("TIMEOUT", `Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export class SecurityPolicyError extends AgentError {
  constructor(message: string) {
    super("SECURITY_POLICY", message.startsWith("Access denied") || message.startsWith("Approval required")
      ? message
      : `Access denied: ${message}`);
    this.name = "SecurityPolicyError";
  }
}

export class NetworkError extends AgentError {
  constructor(message: string) {
    super("NETWORK", message);
    this.name = "NetworkError";
  }
}

export class WorkspaceContextInvalidError extends AgentError {
  readonly reason: string;
  readonly workspace: string | null;

  constructor(reason: string, workspace: string | null, message?: string) {
    super("WORKSPACE_CONTEXT_INVALID", message ?? `Workspace context invalid: ${reason}`);
    this.name = "WorkspaceContextInvalidError";
    this.reason = reason;
    this.workspace = workspace;
  }
}

/**
 * CI-1.03 — Chat Isolation errors.
 *
 * Every message is a fixed sentinel, never interpolating ids, paths or Context
 * state. Two reasons:
 *   1. `classifyHandlerFailure` matches these exact strings (below), so a
 *      caller gets a stable recoverable label.
 *   2. `RESOURCE_UNAVAILABLE` is deliberately identical whether a record is
 *      missing or merely owned by another Context — the server must not become
 *      an oracle that lets chat B enumerate chat A's task ids (threat T07).
 */
export class ContextNotBoundError extends AgentError {
  constructor() {
    super("CONTEXT_NOT_BOUND", "context_not_bound");
    this.name = "ContextNotBoundError";
  }
}

export class ContextInactiveError extends AgentError {
  constructor() {
    super("CONTEXT_INACTIVE", "context_inactive");
    this.name = "ContextInactiveError";
  }
}

export class ResourceUnavailableError extends AgentError {
  constructor() {
    super("RESOURCE_UNAVAILABLE", "resource_unavailable");
    this.name = "ResourceUnavailableError";
  }
}

export class ScopeInsufficientError extends AgentError {
  constructor() {
    super("SCOPE_INSUFFICIENT", "scope_insufficient");
    this.name = "ScopeInsufficientError";
  }
}

export class WorkspaceDeniedError extends AgentError {
  constructor() {
    super("WORKSPACE_DENIED", "workspace_denied");
    this.name = "WorkspaceDeniedError";
  }
}

export class ContextEpochStaleError extends AgentError {
  constructor() {
    super("CONTEXT_EPOCH_STALE", "context_epoch_stale");
    this.name = "ContextEpochStaleError";
  }
}

export class HandoffApprovalRequiredError extends AgentError {
  constructor() {
    super("HANDOFF_APPROVAL_REQUIRED", "handoff_approval_required");
    this.name = "HandoffApprovalRequiredError";
  }
}

export class TransferInProgressError extends AgentError {
  constructor() {
    super("TRANSFER_IN_PROGRESS", "transfer_in_progress");
    this.name = "TransferInProgressError";
  }
}

export class HandoffTokenExpiredError extends AgentError {
  constructor() {
    super("HANDOFF_TOKEN_EXPIRED", "handoff_token_expired");
    this.name = "HandoffTokenExpiredError";
  }
}

export class WorktreeConflictError extends AgentError {
  constructor() {
    super("WORKTREE_CONFLICT", "worktree_conflict");
    this.name = "WorktreeConflictError";
  }
}

/** Map an arbitrary thrown value (or raw message string) to a stable error code. */
export function classifyError(error: unknown): ErrorCode {
  if (error instanceof AgentError) return error.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return "EXECUTION";
  // Legacy string heuristics as a fallback for errors raised by 3rd-party code.
  if (/timed?\s?out|timeout|ETIMEDOUT|deadline/i.test(message)) return "TIMEOUT";
  if (/network|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(message)) return "NETWORK";
  if (/Access denied|outside workspace|SECURITY_POLICY/i.test(message)) return "SECURITY_POLICY";
  if (/missing context variable|MISSING_CONTEXT_VARIABLE/i.test(message)) return "MISSING_CONTEXT_VARIABLE";
  if (/approval required|Approval required|permission denied/i.test(message)) return "APPROVAL_REQUIRED";
  if (/ENOENT|no such file|file not found/i.test(message)) return "FILE_NOT_FOUND";
  if (/unknown tool|unsupported task tool/i.test(message)) return "UNKNOWN_TOOL";
  if (/WORKSPACE_CONTEXT_INVALID|ROOT_NO_LONGER_ALLOWED|PATH_NO_LONGER_EXISTS|WORKSPACE_NOT_CONFIGURED/i.test(message)) return "WORKSPACE_CONTEXT_INVALID";
  if (/invalid|schema|argument/i.test(message)) return "INVALID_ARGUMENT";
  return "EXECUTION";
}

/** Is the error transient (safe to retry) per the recovery policy? */
export function isTransientError(error: unknown): boolean {
  const code = classifyError(error);
  return code === "TIMEOUT" || code === "NETWORK";
}
