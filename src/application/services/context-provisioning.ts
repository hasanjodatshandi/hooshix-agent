import { createContext, type Context } from "../../domain/context/context.js";
import { createContextBinding, type ContextBinding } from "../../domain/context/context-binding.js";
import { createWorkspaceGrant, type WorkspaceGrant } from "../../domain/context/workspace-grant.js";
import type { ContextProvisioningRepository } from "../ports/outbound/context.port.js";

/**
 * CI-2.02 — Connection provisioning.
 *
 * The decisive fix for the CI-G0 defect. Today every OAuth grant receives
 * principal_id "operator" (src/mcp/oauth.ts issueCode default), so every chat
 * shares one identity and one workspace. This service mints a DISTINCT
 * connection id, principal id, Context and binding for each connection, so two
 * connections can never resolve to the same execution environment.
 *
 * Called from the OAuth grant path only when CTX_ISOLATION_MODE is an
 * enforcement mode. With the flag OFF the shipped "operator" behavior is
 * untouched, so this code is additive and cannot change the live service.
 */

export interface ProvisionedConnection {
  readonly principalId: string;
  readonly connectionId: string;
  readonly contextId: string;
  readonly bindingId: string;
  readonly created: boolean;
}

export interface EstablishConnectionInput {
  readonly ownerId: string;
  /** Present when a known connection is re-authorizing (credential rotation). */
  readonly connectionId?: string;
  readonly clientId: string;
  /** SHA-256 of the access token being granted; stored on the binding. */
  readonly credentialHash: string;
  readonly scopes: readonly string[];
  readonly now: string;
  /** Entropy source, injected so tests are deterministic. */
  readonly randomId: () => string;
}

function suffix(random: () => string): string {
  return random().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
}

export function establishConnection(
  repo: ContextProvisioningRepository,
  input: EstablishConnectionInput,
): ProvisionedConnection {
  if (!input.ownerId.trim()) throw new Error("provisioning_requires_owner");

  // A known connection keeps its Context across a credential rotation; the
  // repository stores the rotated credential under a new credential version.
  if (input.connectionId) {
    const existing = repo.findBindingByConnection(input.connectionId);
    if (existing) {
      return {
        principalId: existing.principalId,
        connectionId: existing.connectionId,
        contextId: existing.contextId,
        bindingId: existing.id,
        created: false,
      };
    }
  }

  const connectionId = input.connectionId ?? `conn_${suffix(input.randomId)}`;
  const contextId = `ctx_${suffix(input.randomId)}`;
  const principalId = `principal_${suffix(input.randomId)}`;
  const bindingId = `bind_${suffix(input.randomId)}`;
  const grantId = `grant_${suffix(input.randomId)}`;

  const { context, binding } = repo.provision({
    contextId,
    ownerId: input.ownerId,
    projectLabel: `connection-${connectionId}`,
    workspaceGrantId: grantId,
    storageLocator: `data/contexts/${contextId}`,
    canonicalRoot: `data/contexts/${contextId}`,
    bindingId,
    connectionId,
    principalId,
    credentialHash: input.credentialHash,
    scopes: input.scopes,
    now: input.now,
  });

  return {
    principalId,
    connectionId: binding.connectionId,
    contextId: context.id,
    bindingId: binding.id,
    created: true,
  };
}

/**
 * In-memory provisioning repository for unit tests. The SQLite adapter lands in
 * CI-2.05; until then this lets the issuance contract be proven without a
 * database.
 */
export class InMemoryContextProvisioningRepository implements ContextProvisioningRepository {
  readonly contexts = new Map<string, Context>();
  readonly bindings = new Map<string, ContextBinding>();
  readonly grants = new Map<string, WorkspaceGrant>();

  provision(input: {
    contextId: string; ownerId: string; projectLabel: string;
    workspaceGrantId: string; storageLocator: string; canonicalRoot: string;
    bindingId: string; connectionId: string; principalId: string;
    credentialHash: string; scopes: readonly string[]; now: string;
  }): { context: Context; binding: ContextBinding } {
    if (this.contexts.has(input.contextId)) throw new Error(`context_already_provisioned:${input.contextId}`);
    if (this.bindings.has(input.bindingId)) throw new Error(`binding_already_provisioned:${input.bindingId}`);
    const grant = createWorkspaceGrant({
      id: input.workspaceGrantId,
      contextId: input.contextId,
      canonicalRoot: input.canonicalRoot,
    });
    this.grants.set(grant.id, grant);
    const context = createContext({
      id: input.contextId,
      ownerId: input.ownerId,
      projectLabel: input.projectLabel,
      workspaceGrantId: input.workspaceGrantId,
      storageLocator: input.storageLocator,
      now: input.now,
    });
    const binding = createContextBinding({
      id: input.bindingId,
      ownerId: input.ownerId,
      contextId: input.contextId,
      connectionId: input.connectionId,
      principalId: input.principalId,
      credentialHash: input.credentialHash,
      scopes: input.scopes,
      now: input.now,
    });
    this.contexts.set(context.id, context);
    this.bindings.set(binding.id, binding);
    return { context, binding };
  }

  findBindingByConnection(connectionId: string): ContextBinding | null {
    for (const binding of this.bindings.values()) {
      if (binding.connectionId === connectionId) return binding;
    }
    return null;
  }
}
