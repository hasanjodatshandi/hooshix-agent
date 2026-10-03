import type Database from "better-sqlite3";
import { withAgentDatabase } from "../../../../../core/memory/database/index.js";
import { pinLegacyContext } from "./context-legacy.adapter.js";
import { createContextBinding, type ContextBinding } from "../../../../../domain/context/context-binding.js";
import { createContext, type Context, type ContextState } from "../../../../../domain/context/context.js";
import {
  createWorkspaceGrant,
  type AccessMode,
  type WorkspaceGrant,
} from "../../../../../domain/context/workspace-grant.js";
import type { ContextResolution } from "../../../../../application/ports/outbound/context.port.js";

/**
 * CI-2.05 — the deny-by-default Context Resolver.
 *
 * Given a verified credential hash — and ONLY the credential hash; a contextId
 * supplied in tool arguments is never an input here (threat T04) — resolve the
 * Context the credential is bound to. This is the object that replaces the
 * ambient `getActiveWorkspace()` global lookup with a value derived from a
 * server-side binding.
 *
 * Resolution is pure: it computes and returns the outcome, including the
 * refused cases. Whether a refused outcome becomes an error is the caller's
 * decision, governed by CTX_ISOLATION_MODE (SHADOW observes, enforcement modes
 * reject). Nothing in this module reads the flag, so the same resolution feeds
 * audit logging and enforcement identically.
 */

interface BindingRow {
  binding_id: string;
  owner_id: string;
  context_id: string;
  connection_id: string;
  principal_id: string;
  credential_hash: string;
  credential_version: number;
  scopes_json: string;
  state: string;
  created_at: string;
}
interface ContextRow {
  context_id: string;
  owner_id: string;
  project_label: string;
  state: string;
  workspace_grant_id: string;
  storage_locator: string;
  context_epoch: number;
  created_at: string;
  updated_at: string;
}
interface GrantRow {
  grant_id: string;
  context_id: string;
  canonical_root: string;
  worktree_locator: string | null;
  access_mode: string;
  lease_id: string | null;
  grant_version: number;
}

function parseScopes(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function toContext(row: ContextRow): Context {
  // The domain constructor sets state ACTIVE and validates every invariant;
  // this row is only ever reached for an ACTIVE Context (checked by the caller).
  return createContext({
    id: row.context_id,
    ownerId: row.owner_id,
    projectLabel: row.project_label,
    workspaceGrantId: row.workspace_grant_id,
    storageLocator: row.storage_locator,
    epoch: row.context_epoch,
    now: row.updated_at,
  });
}

function toBinding(row: BindingRow): ContextBinding {
  return createContextBinding({
    id: row.binding_id,
    ownerId: row.owner_id,
    contextId: row.context_id,
    connectionId: row.connection_id,
    principalId: row.principal_id,
    credentialHash: row.credential_hash,
    credentialVersion: row.credential_version,
    scopes: parseScopes(row.scopes_json),
    now: row.created_at,
  });
}

function toGrant(row: GrantRow): WorkspaceGrant {
  return createWorkspaceGrant({
    id: row.grant_id,
    contextId: row.context_id,
    canonicalRoot: row.canonical_root,
    worktreeLocator: row.worktree_locator,
    accessMode: row.access_mode as AccessMode,
    leaseId: row.lease_id,
    grantVersion: row.grant_version,
  });
}

const UNBOUND: ContextResolution = { status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" };

/**
 * Resolve synchronously against a given connection. Exposed so a caller that
 * already holds a write transaction can resolve inside it.
 */
export function resolveContextWith(
  db: Database.Database,
  input: { readonly credentialHash: string; readonly requiredScopes?: readonly string[] },
): ContextResolution {
  if (!input.credentialHash) return UNBOUND;

  const binding = db
    .prepare(
      "SELECT binding_id, owner_id, context_id, connection_id, credential_hash, credential_version, principal_id, scopes_json, state, created_at" +
        " FROM context_binding WHERE credential_hash=?",
    )
    .get(input.credentialHash) as BindingRow | undefined;

  // Deny by default (I-06): no binding, or a revoked/expired one, is refused —
  // never silently attached to the most recently used Context.
  if (!binding || binding.state !== "ACTIVE") return UNBOUND;

  const context = db
    .prepare(
      "SELECT context_id, owner_id, project_label, state, workspace_grant_id, storage_locator, context_epoch, created_at, updated_at" +
        " FROM context_registry WHERE context_id=?",
    )
    .get(binding.context_id) as ContextRow | undefined;
  if (!context) return UNBOUND;

  if (context.state !== "ACTIVE") {
    return { status: "INACTIVE", contextState: context.state as ContextState, reason: "CONTEXT_INACTIVE" };
  }

  if (input.requiredScopes && input.requiredScopes.length > 0) {
    const held = new Set(parseScopes(binding.scopes_json));
    const missing = input.requiredScopes.filter((scope) => !held.has(scope));
    if (missing.length > 0) {
      return { status: "INSUFFICIENT_SCOPE", missing, reason: "SCOPE_INSUFFICIENT" };
    }
  }

  const grant = db
    .prepare(
      "SELECT grant_id, context_id, canonical_root, worktree_locator, access_mode, lease_id, grant_version" +
        " FROM workspace_grant WHERE grant_id=?",
    )
    .get(context.workspace_grant_id) as GrantRow | undefined;

  // A Context whose grant is missing is not executable; report it as inactive
  // rather than partially resolving.
  if (!grant) {
    return { status: "INACTIVE", contextState: "FROZEN", reason: "CONTEXT_INACTIVE" };
  }

  return {
    status: "RESOLVED",
    context: toContext(context),
    binding: toBinding(binding),
    grant: toGrant(grant),
  };
}

/** Resolve through the shared connection. */
export function resolveContext(
  input: { readonly credentialHash: string; readonly requiredScopes?: readonly string[] },
): ContextResolution {
  return withAgentDatabase((db) => resolveContextWith(db, input));
}

/**
 * Refresh the legacy pin, then resolve, in one shared connection. A grant
 * minted since the last pin (or since startup) has no binding yet; every pre-CI
 * grant carries principal "operator", so it belongs on the legacy Context.
 * Incremental and idempotent — it only binds legacy tokens still unbound.
 *
 * This is the ContextResolver port implementation; async per the port contract.
 */
export async function resolveContextFromPort(input: {
  readonly credentialHash?: string;
  readonly principal?: { readonly credentialBindingId: string | null };
  readonly requiredScopes?: readonly string[];
}): Promise<ContextResolution> {
  return withAgentDatabase((db) => {
    if (!input.credentialHash) return { status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" };
    pinLegacyContext(db, new Date().toISOString());
    return resolveContextWith(db, {
      credentialHash: input.credentialHash,
      requiredScopes: input.requiredScopes,
    });
  });
}

export function resolveContextAsync(input: {
  readonly credentialHash: string;
  readonly requiredScopes?: readonly string[];
}): Promise<ContextResolution> {
  return Promise.resolve(resolveContext(input));
}
