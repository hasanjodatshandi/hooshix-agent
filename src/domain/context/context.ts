import { DomainError } from "../shared/errors.js";
import type { ContextId, ContextEpoch, GrantId } from "../shared/ids.js";
import { requireNonblankId, requireContextEpoch } from "../shared/ids.js";

/**
 * CI-1.01 — Context: an independent execution environment.
 *
 * A Context owns a workspace grant, a data store, plans/tasks/approvals and
 * logs. Multiple host conversations (ChatGPT chats) that share one HooshiX MCP
 * endpoint MUST be bound to distinct Contexts; otherwise a workspace switch in
 * one chat diverts another (threat T02) and one chat can read another's tasks
 * by guessing IDs (threat T01).
 *
 * Invariants (design 02, non-negotiable):
 *   I-01: trustedContext(req) is derived from a verified server-side binding only.
 *   I-02: every persisted mutable record carries a context id or inherits it.
 *   I-06: an unbound or ambiguous request never falls back to the last active
 *         workspace — it is rejected.
 *   I-07: handoff does not silently make an old binding valid for a new context.
 */
export type ContextState = "ACTIVE" | "FROZEN" | "TRANSFERRING" | "ARCHIVED";

const VALID_STATES: ReadonlySet<ContextState> = new Set(["ACTIVE", "FROZEN", "TRANSFERRING", "ARCHIVED"]);

export function requireContextId(value: string): ContextId {
  return requireNonblankId<"ContextId">(value, "ContextId");
}

export interface Context {
  readonly id: ContextId;
  readonly ownerId: string;
  readonly projectLabel: string;
  readonly state: ContextState;
  readonly workspaceGrantId: GrantId;
  /** Immutable locator for this Context's data store/workspace tree. */
  readonly storageLocator: string;
  readonly epoch: ContextEpoch;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createContext(input: {
  id: string; ownerId: string; projectLabel: string;
  workspaceGrantId: string; storageLocator: string; epoch?: number; now: string;
}): Context {
  if (!input.ownerId.trim()) throw new DomainError("MISSING_DEPENDENCY", "Context requires an owner");
  if (!input.projectLabel.trim()) throw new DomainError("MISSING_DEPENDENCY", "Context requires a project label");
  if (!input.storageLocator.trim()) throw new DomainError("MISSING_DEPENDENCY", "Context requires a storage locator");
  return Object.freeze({
    id: requireContextId(input.id),
    ownerId: input.ownerId,
    projectLabel: input.projectLabel,
    state: "ACTIVE",
    workspaceGrantId: requireNonblankId<"GrantId">(input.workspaceGrantId, "GrantId"),
    storageLocator: input.storageLocator,
    epoch: requireContextEpoch(input.epoch ?? 1),
    createdAt: input.now,
    updatedAt: input.now,
  });
}

/** Legal state transitions (design 07). Any other move is a domain error. */
const ALLOWED_TRANSITIONS: Readonly<Record<ContextState, readonly ContextState[]>> = Object.freeze({
  ACTIVE: ["FROZEN", "TRANSFERRING", "ARCHIVED"],
  FROZEN: ["ACTIVE", "ARCHIVED"],
  // A transfer in progress must complete (commit/cancel) before anything else.
  TRANSFERRING: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
});

export function transitionContextState(context: Context, next: ContextState, now: string): Context {
  if (!VALID_STATES.has(next)) throw new DomainError("INVALID_TASK", `Unknown ContextState: ${next}`);
  if (context.state === next) return context;
  const allowed = ALLOWED_TRANSITIONS[context.state];
  if (!allowed.includes(next)) {
    throw new DomainError("TASK_TERMINAL", `Illegal Context transition ${context.state} -> ${next}`);
  }
  return Object.freeze({ ...context, state: next, updatedAt: now });
}

/**
 * I-06: only an ACTIVE Context may serve requests. FROZEN / TRANSFERRING /
 * ARCHIVED are execution-inactive and must surface CONTEXT_INACTIVE, never a
 * silent fallback to another Context.
 */
export function isContextExecutable(context: Context): boolean {
  return context.state === "ACTIVE";
}
