import { DomainError } from "../shared/errors.js";
import type { ContextEpoch, ContextId, CorrelationId, GrantId, SessionId } from "../shared/ids.js";
import { requireContextEpoch, requireNonblankId } from "../shared/ids.js";

/**
 * CI-1.02 — ExecutionEnvelope: the immutable, unforgeable authorization a
 * handler receives instead of reading global state.
 *
 * Design 05 §1: trustedContext(req) returns a single immutable record binding
 * the request to a Context; every tool handler receives it as a parameter and
 * re-checks it before any side effect. There is no ambient source of "the
 * current workspace" — that is what removes the global switch (threat T02).
 *
 * This replaces today's ambient lookup chain (getActiveWorkspace() /
   workspaceGuard globals) with a passed-down value bound to a binding.
 */
export interface ExecutionEnvelope {
  readonly contextId: ContextId;
  readonly workspaceGrantId: GrantId;
  readonly contextEpoch: ContextEpoch;
  /** Grant version the envelope was minted under; a bumped grant invalidates it. */
  readonly grantVersion: number;
  readonly sessionId: SessionId;
  readonly correlationId: CorrelationId;
  /** Absolute deadline in epoch milliseconds for this request's lease. */
  readonly requestDeadlineMs: number;
}

export function createExecutionEnvelope(input: {
  contextId: string;
  workspaceGrantId: string;
  contextEpoch: number;
  grantVersion?: number;
  sessionId: string;
  correlationId: string;
  requestDeadlineMs: number;
}): ExecutionEnvelope {
  if (!Number.isSafeInteger(input.grantVersion ?? 1) || (input.grantVersion ?? 1) < 1) {
    throw new DomainError("INVALID_ID", "grantVersion must be a positive integer");
  }
  if (!Number.isSafeInteger(input.requestDeadlineMs) || input.requestDeadlineMs <= 0) {
    throw new DomainError("INVALID_ID", "requestDeadlineMs must be a positive integer");
  }
  return Object.freeze({
    contextId: requireNonblankId<"ContextId">(input.contextId, "ContextId"),
    workspaceGrantId: requireNonblankId<"GrantId">(input.workspaceGrantId, "GrantId"),
    contextEpoch: requireContextEpoch(input.contextEpoch),
    grantVersion: input.grantVersion ?? 1,
    sessionId: requireNonblankId<"SessionId">(input.sessionId, "SessionId"),
    correlationId: requireNonblankId<"CorrelationId">(input.correlationId, "CorrelationId"),
    requestDeadlineMs: input.requestDeadlineMs,
  });
}

/**
 * A stale envelope (another connection transferred ownership or bumped the
 * workspace grant) authorizes nothing. Handlers re-check before side effects.
 */
export function isEnvelopeCurrent(envelope: ExecutionEnvelope, current: {
  readonly contextEpoch: number;
  readonly grantVersion: number;
}): boolean {
  return envelope.contextEpoch === current.contextEpoch && envelope.grantVersion === current.grantVersion;
}

/** Two envelopes from different Contexts must never be interchangeable. */
export function envelopesShareContext(a: ExecutionEnvelope, b: ExecutionEnvelope): boolean {
  return a.contextId === b.contextId;
}
