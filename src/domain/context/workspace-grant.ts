import { DomainError } from "../shared/errors.js";
import type { GrantId, ContextId } from "../shared/ids.js";
import { requireNonblankId } from "../shared/ids.js";

/**
 * CI-1.01 — WorkspaceGrant: a Context's authorization over one canonical
 * workspace root.
 *
 * Design 06 §1: `set_workspace` becomes a LOCAL operation on the Context's
 * grant, not a global switch. A new grant version is created; existing tasks
 * keep the immutable snapshot of the grant they were created under, so a
 * workspace change never diverts a running task (threat T02).
 */
export type AccessMode = "READ_ONLY" | "READ_WRITE";

export interface WorkspaceGrant {
  readonly id: GrantId;
  readonly contextId: ContextId;
  /** Canonical (realpath-resolved, case-folded on win32) root path. */
  readonly canonicalRoot: string;
  readonly worktreeLocator: string | null;
  readonly accessMode: AccessMode;
  readonly leaseId: string | null;
  readonly grantVersion: number;
}

export function createWorkspaceGrant(input: {
  id: string; contextId: string; canonicalRoot: string;
  worktreeLocator?: string | null; accessMode?: AccessMode; leaseId?: string | null;
  grantVersion?: number;
}): WorkspaceGrant {
  if (!input.canonicalRoot.trim()) throw new DomainError("MISSING_DEPENDENCY", "Grant requires a canonical root");
  if (!Number.isSafeInteger(input.grantVersion ?? 1) || (input.grantVersion ?? 1) < 1) {
    throw new DomainError("INVALID_ID", "grantVersion must be a positive integer");
  }
  return Object.freeze({
    id: requireNonblankId<"GrantId">(input.id, "GrantId"),
    contextId: requireNonblankId<"ContextId">(input.contextId, "ContextId"),
    canonicalRoot: input.canonicalRoot,
    worktreeLocator: input.worktreeLocator ?? null,
    accessMode: input.accessMode ?? "READ_WRITE",
    leaseId: input.leaseId ?? null,
    grantVersion: input.grantVersion ?? 1,
  });
}

/**
 * `set_workspace` bumps the grant version rather than mutating in place; the
 * precondition is that no task bound to the previous version is still running
 * (checked in CI-5, design 06 §1).
 */
export function bumpWorkspaceGrant(grant: WorkspaceGrant, newCanonicalRoot: string, accessMode?: AccessMode): WorkspaceGrant {
  if (!newCanonicalRoot.trim()) throw new DomainError("MISSING_DEPENDENCY", "Grant bump requires a canonical root");
  return Object.freeze({
    ...grant,
    canonicalRoot: newCanonicalRoot,
    accessMode: accessMode ?? grant.accessMode,
    grantVersion: grant.grantVersion + 1,
  });
}

/** A READ_ONLY grant may never serve a mutating tool. */
export function grantAllowsWrites(grant: WorkspaceGrant): boolean {
  return grant.accessMode === "READ_WRITE";
}
