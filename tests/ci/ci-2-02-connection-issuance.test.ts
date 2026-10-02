import { describe, expect, it } from "vitest";
import {
  InMemoryContextProvisioningRepository,
  establishConnection,
} from "../../src/application/services/context-provisioning.js";
import {
  isCiEnforcementMode,
  isCiIsolationEnabled,
  isCiShadowMode,
  parseCiIsolationMode,
} from "../../src/infrastructure/config/ci-isolation-config.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { runMigrations } from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

const NOW = "2026-10-02T14:00:00.000Z";

/** Deterministic entropy for tests. */
function counter(start = 0): () => string {
  let n = start;
  return () => `id${++n}`;
}

describe("CI-2.02 / CTX_ISOLATION_MODE flag", () => {
  it("defaults to OFF", () => {
    expect(parseCiIsolationMode({})).toBe("OFF");
    expect(isCiIsolationEnabled("OFF")).toBe(false);
    expect(isCiShadowMode("OFF")).toBe(false);
    expect(isCiEnforcementMode("OFF")).toBe(false);
  });

  it("accepts every documented mode", () => {
    expect(parseCiIsolationMode({ CTX_ISOLATION_MODE: "SHADOW" })).toBe("SHADOW");
    expect(parseCiIsolationMode({ CTX_ISOLATION_MODE: "PER_CONNECTION" })).toBe("PER_CONNECTION");
    expect(parseCiIsolationMode({ CTX_ISOLATION_MODE: "HOST_ATTESTED" })).toBe("HOST_ATTESTED");
    expect(isCiShadowMode("SHADOW")).toBe(true);
    expect(isCiEnforcementMode("PER_CONNECTION")).toBe(true);
    expect(isCiEnforcementMode("HOST_ATTESTED")).toBe(true);
    // SHADOW observes only; it must never be treated as enforcement.
    expect(isCiEnforcementMode("SHADOW")).toBe(false);
  });

  it("rejects an unknown mode instead of silently degrading", () => {
    expect(() => parseCiIsolationMode({ CTX_ISOLATION_MODE: "ON" })).toThrow(/CTX_ISOLATION_MODE/);
    expect(() => parseCiIsolationMode({ CTX_ISOLATION_MODE: "per_connection" })).toThrow(/CTX_ISOLATION_MODE/);
  });
});

describe("CI-2.02 / per-connection principal issuance", () => {
  it("persists the principal_id column on context_binding (migration 24)", () => {
    const fixture = createDisposableFixture("ci-2-02-schema");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        const columns = (db.prepare("PRAGMA table_info(context_binding)").all() as Array<{ name: string }>)
          .map((c) => c.name);
        expect(columns).toContain("principal_id");
        db.prepare(
          "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
            " VALUES(?,?,?,?,?,?,?)",
        ).run("ctx-z", "owner-1", "p", "grant-z", "data/contexts/ctx-z", NOW, NOW);
        // Inserting a binding with the principal round-trips the column.
        db.prepare(
          "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
            " VALUES(?,?,?,?,?,?,?)",
        ).run("bind-z", "owner-1", "ctx-z", "conn-z", "principal-z", "sha256:z", NOW);
        expect(
          (db.prepare("SELECT principal_id AS p FROM context_binding WHERE binding_id='bind-z'").get() as { p: string }).p,
        ).toBe("principal-z");
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("mints a distinct principal, connection, Context and binding per connection", () => {
    const repo = new InMemoryContextProvisioningRepository();
    const a = establishConnection(repo, {
      ownerId: "owner-1", clientId: "client-1", credentialHash: "sha256:aaa",
      scopes: ["hooshix:read"], now: NOW, randomId: counter(),
    });
    const b = establishConnection(repo, {
      ownerId: "owner-1", clientId: "client-2", credentialHash: "sha256:bbb",
      scopes: ["hooshix:read"], now: NOW, randomId: counter(100),
    });

    // The decisive property: nothing is shared between two connections.
    expect(a.principalId).not.toBe(b.principalId);
    expect(a.connectionId).not.toBe(b.connectionId);
    expect(a.contextId).not.toBe(b.contextId);
    expect(a.bindingId).not.toBe(b.bindingId);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
  });

  it("issues all four ids in distinct namespaces (no collapse to one identity)", () => {
    const repo = new InMemoryContextProvisioningRepository();
    const { principalId, connectionId, contextId, bindingId } = establishConnection(repo, {
      ownerId: "owner-1", clientId: "client-1", credentialHash: "sha256:aaa",
      scopes: [], now: NOW, randomId: counter(),
    });
    const ids = new Set([principalId, connectionId, contextId, bindingId]);
    expect(ids.size).toBe(4);
    // And none of them is the shared legacy identity.
    expect([...ids].every((id) => id !== "operator")).toBe(true);
  });

  it("records the credential hash and scopes on the binding", () => {
    const repo = new InMemoryContextProvisioningRepository();
    const { bindingId } = establishConnection(repo, {
      ownerId: "owner-1", clientId: "client-1", credentialHash: "sha256:real-token-hash",
      scopes: ["hooshix:read", "hooshix:execute"], now: NOW, randomId: counter(),
    });
    const binding = repo.bindings.get(bindingId);
    expect(binding?.credentialHash).toBe("sha256:real-token-hash");
    expect(binding?.scopes).toEqual(["hooshix:read", "hooshix:execute"]);
    expect(binding?.state).toBe("ACTIVE");
  });

  it("keeps an existing connection's Context across a re-authorization", () => {
    const repo = new InMemoryContextProvisioningRepository();
    const first = establishConnection(repo, {
      ownerId: "owner-1", connectionId: "conn-stable", clientId: "client-1",
      credentialHash: "sha256:v1", scopes: ["hooshix:read"], now: NOW, randomId: counter(),
    });
    // Same connection returns with a rotated credential: Context is preserved.
    const again = establishConnection(repo, {
      ownerId: "owner-1", connectionId: "conn-stable", clientId: "client-1",
      credentialHash: "sha256:v2", scopes: ["hooshix:read"], now: NOW, randomId: counter(50),
    });
    expect(again.created).toBe(false);
    expect(again.contextId).toBe(first.contextId);
    expect(again.principalId).toBe(first.principalId);
    expect(again.connectionId).toBe("conn-stable");
    // No second Context was provisioned for the same connection.
    expect(repo.contexts.size).toBe(1);
  });

  it("persists an ACTIVE Context pointing at its own workspace grant and locator", () => {
    const repo = new InMemoryContextProvisioningRepository();
    const { contextId, bindingId } = establishConnection(repo, {
      ownerId: "owner-1", clientId: "client-1", credentialHash: "sha256:aaa",
      scopes: [], now: NOW, randomId: counter(),
    });
    const context = repo.contexts.get(contextId);
    expect(context?.state).toBe("ACTIVE");
    expect(context?.ownerId).toBe("owner-1");
    expect(context?.storageLocator).toBe(`data/contexts/${contextId}`);
    const grant = repo.grants.get(context!.workspaceGrantId);
    expect(grant?.contextId).toBe(contextId);
    // The binding and the grant agree on the Context.
    expect(repo.bindings.get(bindingId)?.contextId).toBe(contextId);
  });

  it("requires an owner", () => {
    const repo = new InMemoryContextProvisioningRepository();
    expect(() =>
      establishConnection(repo, {
        ownerId: " ", clientId: "client-1", credentialHash: "sha256:aaa",
        scopes: [], now: NOW, randomId: counter(),
      }),
    ).toThrow(/provisioning_requires_owner/);
  });

  it("does not provision the same Context or binding twice", () => {
    const repo = new InMemoryContextProvisioningRepository();
    repo.provision({
      contextId: "ctx-1", ownerId: "owner-1", projectLabel: "p",
      workspaceGrantId: "grant-1", storageLocator: "data/contexts/ctx-1",
      canonicalRoot: "data/contexts/ctx-1", bindingId: "bind-1",
      connectionId: "conn-1", principalId: "principal-1",
      credentialHash: "sha256:aaa", scopes: [], now: NOW,
    });
    // Reusing the Context id with a fresh binding must be refused.
    expect(() =>
      repo.provision({
        contextId: "ctx-1", ownerId: "owner-1", projectLabel: "p",
        workspaceGrantId: "grant-2", storageLocator: "data/contexts/ctx-1b",
        canonicalRoot: "data/contexts/ctx-1b", bindingId: "bind-2",
        connectionId: "conn-2", principalId: "principal-2",
        credentialHash: "sha256:bbb", scopes: [], now: NOW,
      }),
    ).toThrow(/context_already_provisioned/);
    // Reusing the binding id with a fresh Context must be refused.
    expect(() =>
      repo.provision({
        contextId: "ctx-2", ownerId: "owner-1", projectLabel: "p",
        workspaceGrantId: "grant-3", storageLocator: "data/contexts/ctx-2",
        canonicalRoot: "data/contexts/ctx-2", bindingId: "bind-1",
        connectionId: "conn-3", principalId: "principal-3",
        credentialHash: "sha256:ccc", scopes: [], now: NOW,
      }),
    ).toThrow(/binding_already_provisioned/);
  });
});
