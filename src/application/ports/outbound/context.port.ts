import type { ContextBinding } from "../../../domain/context/context-binding.js";
import type { Context, ContextState } from "../../../domain/context/context.js";
import type { OwnershipLease } from "../../../domain/context/ownership-lease.js";
import type { TransferIntent } from "../../../domain/context/transfer-intent.js";
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
   * Resolve the Context for a verified credential. The credential hash is the
   * only input that selects the binding — a `contextId` found in tool arguments
   * is never used here (threat T04).
   *
   * The hash is passed directly because the binding table keys on it; the
   * optional principal is the richer identity once a binding exists.
   */
  resolve(input: {
    readonly credentialHash?: string;
    readonly principal?: VerifiedPrincipal;
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
    /** Owner of the binding; absent when the credential refused to resolve. */
    readonly ownerId?: string;
    readonly contextId?: ContextId;
    readonly bindingId?: BindingId;
    readonly action: string;
    readonly decision: "ALLOW" | "DENY";
    readonly traceId: string;
  }): Promise<void>;
}

/**
 * CI-2.02 — provisioning port: creates a Context and its first binding, or
 * rebinds a connection whose credential rotated. Implemented by an in-memory
 * fake for unit tests now and the SQLite adapter in CI-2.05.
 */
export interface ContextProvisioningRepository {
  /** Persist a freshly minted Context plus its ACTIVE binding, atomically. */
  provision(input: {
    readonly contextId: string;
    readonly ownerId: string;
    readonly projectLabel: string;
    readonly workspaceGrantId: string;
    readonly storageLocator: string;
    readonly canonicalRoot: string;
    readonly bindingId: string;
    readonly connectionId: string;
    readonly principalId: string;
    readonly credentialHash: string;
    readonly scopes: readonly string[];
    readonly now: string;
  }): { readonly context: Context; readonly binding: ContextBinding };

  /** Locate the binding a credential currently holds, if any (rotate path). */
  findBindingByConnection(connectionId: string): ContextBinding | null;
}

/**
 * CI-G6 — the two-phase ownership transfer port.
 *
 * The whole protocol needs four persisted moves — prepare the intent, approve
 * it with the one-time ticket, rebind the lease while bumping the epoch, mark
 * the intent committed — and the middle two must be atomic against concurrent
 * transfers. The port is therefore deliberately coarser than the underlying
 * lease/intent tables: `commitTransfer` is the atomic rebind, and the SQLite
 * adapter runs it in one transaction so a Context is never left TRANSFERRING.
 *
 * Nothing here takes a raw ticket. `prepare` mints the ticket internally and
 * returns it once; `approve` takes only the hash. The plaintext therefore
 * never crosses this boundary (design 03 §4).
 */
export interface TransferRepository {
  /** Mint a one-time ticket and its SHA-256. The plaintext leaves exactly once. */
  mintTicket(): { readonly ticket: string; readonly ticketHash: string };
  /** Hash a presented ticket for comparison against a stored hash. */
  hashTicket(ticket: string): string;
  /** Is this exact hash already recorded? Used to refuse double-issuance. */
  isTicketHashTaken(ticketHash: string): boolean;
  /** Persist a freshly prepared intent (state PREPARED, stamps null). */
  insertIntent(intent: TransferIntent): void;
  /** Read an intent by id, or null. */
  getIntent(intentId: string): TransferIntent | null;
  /** Read the live ownership lease for a Context, or null when never leased. */
  getLease(contextId: ContextId): OwnershipLease | null;
  /** Is there already an open (PREPARED/APPROVED/DRAINING) intent for a Context? */
  hasOpenIntent(contextId: ContextId): boolean;
  /**
   * Redeem the ticket: move the intent to APPROVED and record the approver, in
   * one CAS on (id, PREPARED, ticketHash). Returns the updated intent, or null
   * when the guard fails (unknown id, wrong state, ticket mismatch, expired).
   */
  approveIntent(input: {
    readonly intentId: string;
    readonly ownerId: string;
    readonly ticketHash: string;
    readonly now: string;
  }): TransferIntent | null;
  /**
   * The atomic rebind. Runs in one transaction: Context ACTIVE → TRANSFERRING,
   * lease moves to the new binding with a bumped epoch and a fresh fencing
   * token, Context TRANSFERRING → ACTIVE, intent APPROVED → COMMITTED. Every
   * step is a CAS, so a concurrent transfer rolls the whole thing back instead
   * of double-rebinding.
   *
   * Returns the COMMITTED intent, or throws when the prerequisites no longer
   * hold (missing intent/lease, intent not APPROVED, lease epoch moved since
   * prepare).
   */
  commitTransfer(input: {
    readonly intentId: string;
    readonly newBindingId: BindingId;
    readonly now: string;
  }): TransferIntent;
  /** Move a non-terminal intent to CANCELLED / EXPIRED / FAILED. */
  terminateIntent(intentId: string, next: "CANCELLED" | "EXPIRED" | "FAILED"): void;
  /** Every intent still in flight for a Context, oldest first. */
  listOpenIntents(contextId: ContextId): readonly TransferIntent[];
}
