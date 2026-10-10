import type Database from "better-sqlite3";
import { createContext, type Context } from "../../../../../domain/context/context.js";
import {
  createContextBinding,
  type ContextBinding,
} from "../../../../../domain/context/context-binding.js";
import type { ContextProvisioningRepository } from "../../../../../application/ports/outbound/context.port.js";

/**
 * CI-2.05 — the SQLite provisioning repository.
 *
 * This is what was missing for CI-G7b: `establishConnection` minted a distinct
 * connection/principal/Context against an in-memory fake only, so the live OAuth
 * grant path never persisted a per-connection Context — every token fell through
 * to the pinned legacy Context and shared one identity. Here the same three rows
 * the legacy pin writes (registry → grant → binding, keyed on the credential
 * hash) are persisted inside one transaction, so a freshly authorized connector
 * resolves to its OWN Context instead of `ctx-legacy-shared-operator`.
 *
 * Insert order matters: `context_binding` and `workspace_grant` both FK to
 * `context_registry`, so the registry row goes first.
 */
export class SqliteContextProvisioningRepository implements ContextProvisioningRepository {
  constructor(private readonly db: Database.Database) {}

  provision(input: {
    contextId: string; ownerId: string; projectLabel: string;
    workspaceGrantId: string; storageLocator: string; canonicalRoot: string;
    bindingId: string; connectionId: string; principalId: string;
    credentialHash: string; scopes: readonly string[]; now: string;
  }): { context: Context; binding: ContextBinding } {
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

    this.db
      .transaction(() => {
        this.db
          .prepare(
            "INSERT INTO context_registry(context_id, owner_id, project_label, state, workspace_grant_id, storage_locator, context_epoch, created_at, updated_at)" +
              " VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            input.contextId,
            input.ownerId,
            input.projectLabel,
            "ACTIVE",
            input.workspaceGrantId,
            input.storageLocator,
            1,
            input.now,
            input.now,
          );
        this.db
          .prepare(
            "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, access_mode, created_at)" +
              " VALUES(?,?,?,?,?)",
          )
          .run(
            input.workspaceGrantId,
            input.contextId,
            input.canonicalRoot,
            "READ_WRITE",
            input.now,
          );
        this.db
          .prepare(
            "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, scopes_json, state, created_at)" +
              " VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            input.bindingId,
            input.ownerId,
            input.contextId,
            input.connectionId,
            input.principalId,
            input.credentialHash,
            JSON.stringify([...input.scopes]),
            "ACTIVE",
            input.now,
          );
      })
      .exclusive();

    return { context, binding };
  }

  findBindingByConnection(connectionId: string): ContextBinding | null {
    const row = this.db
      .prepare(
        "SELECT binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, credential_version, scopes_json, state, created_at" +
          " FROM context_binding WHERE connection_id=? AND state='ACTIVE' LIMIT 1",
      )
      .get(connectionId) as
      | {
          binding_id: string; owner_id: string; context_id: string; connection_id: string;
          principal_id: string; credential_hash: string; credential_version: number;
          scopes_json: string; created_at: string;
        }
      | undefined;
    if (!row) return null;
    let scopes: string[] = [];
    try {
      const parsed = JSON.parse(row.scopes_json);
      scopes = Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
    } catch {
      scopes = [];
    }
    return createContextBinding({
      id: row.binding_id,
      ownerId: row.owner_id,
      contextId: row.context_id,
      connectionId: row.connection_id,
      principalId: row.principal_id,
      credentialHash: row.credential_hash,
      credentialVersion: row.credential_version,
      scopes,
      now: row.created_at,
    });
  }
}
