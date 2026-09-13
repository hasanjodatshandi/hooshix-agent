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
  | "EXECUTION";

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
  if (/invalid|schema|argument/i.test(message)) return "INVALID_ARGUMENT";
  return "EXECUTION";
}

/** Is the error transient (safe to retry) per the recovery policy? */
export function isTransientError(error: unknown): boolean {
  const code = classifyError(error);
  return code === "TIMEOUT" || code === "NETWORK";
}
