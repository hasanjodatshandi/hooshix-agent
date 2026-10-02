import type { ContextBinding } from "../../../domain/context/context-binding.js";
import type { Context, ContextState } from "../../../domain/context/context.js";
import type { OwnershipLease } from "../../../domain/context/ownership-lease.js";
import type { VerifiedPrincipal } from "../../../domain/context/verified-principal.js";
import type { WorkspaceGrant } from "../../../domain/context/workspace-grant.js";
import type { BindingId, ContextEpoch, ContextId, GrantId } from "../../../domain/shared/ids.js";

/**
 * CI-1.02 — outbound ports for the Chat Isolation control plane.
 *
 * Hexagonal rule: application code depends on these interfaces only; the SQLite
 * adapter implementations land in CI-2 and are injected. Nothing here touches
 * the database, MCP transport, or process-global state.
 */

/**
 * Deny-by-default Context resolution. The discriminated union forces every
 * caller to handle the refused cases — there is no "resolved-or-null" shortcut
 * that could accidentally fall back to another Context (I-06).
 */
export type ContextResolution =
  | {
      readonly status: "RESOLVED";
      readonly context: Context;
      readonly binding: ContextBinding;
      readonly grant: WorkspaceGrant;
    }
  | { readonly status: "UNBOUND"; readonly reason: "CONTEXT_NOT_BOUND" }
  | { readonly status: "INACTIVE"; readonly contextState: ContextState; readonly reason: "CONTEXT_INACTIVE" }
  | { readonly status: "INSUFFICIENT_SCOPE"; readonly missing: readonly string[]; readonly reason: "SCOPE_INSUFFICIENT" };

export interface ContextResolver {
  /**
   * Resolve the Context for a verified principal. The credential hash is the
   * only input that selects the binding — a `contextId` found in tool arguments
   * is never used here (threat T04).
   */
  resolve(input: {
    readonly principal: VerifiedPrincipal;
    readonly requiredScopes?: readonly string[];
  }): Promise<ContextResolution>;
}

export interface AuthorizationPolicy {
  /** May this envelope's Context serve a mutating tool right now? */
  canMutate(envelope: { readonly contextId: ContextId; readonly grantVersion: number }): Promise<boolean>;
}

export interface OwnershipRepository {
  /** Load the ownership lease for a Context, or null if it has never been leased. */
  get(contextId: ContextId): Promise<OwnershipLease | null>;
  /**
   * Advance the epoch under compare-and-set. Resolves false when the expected
   * (epoch, binding) pair no longer matches — a stale worker must not commit.
   */
  advanceEpoch(input: {
    readonly contextId: ContextId;
    readonly expectedEpoch: ContextEpoch;
    readonly expectedBindingId: BindingId;
    readonly fencingToken: string;
    readonly newDeadlineMs: number;
  }): Promise<boolean>;
}

export interface WorkspaceGrantRepository {
  get(grantId: GrantId): Promise<WorkspaceGrant | null>;
  /** Persist a bumped grant version atomically. */
  save(grant: WorkspaceGrant): Promise<void>;
}

/** Security audit sink for the control plane (never containing secrets). */
export interface ControlPlaneAuditSink {
  record(input: {
    readonly ownerId: string;
    readonly contextId?: ContextId;
    readonly bindingId?: BindingId;
    readonly action: string;
    readonly decision: "ALLOW" | "DENY";
    readonly traceId: string;
  }): Promise<void>;
}
