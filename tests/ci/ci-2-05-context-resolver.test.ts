import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContext, resolveContextWith } from "../../src/adapters/outbound/persistence/sqlite/repositories/context-resolver.adapter.js";
import { LEGACY_CONTEXT_ID, pinLegacyContext } from "../../src/adapters/outbound/persistence/sqlite/repositories/context-legacy.adapter.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { closeAgentDatabase, resetMigrationsFlag } from "../../src/core/memory/database/index.js";
import { runMigrations } from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

const NOW = "2026-10-02T14:00:00.000Z";
const CONTEXT_A = "ctx-A";
const CONTEXT_B = "ctx-B";
const GRANT_A = "grant-A";
const GRANT_B = "grant-B";
const HASH_A = "sha256:token-A";
const HASH_B = "sha256:token-B";
const HASH_REVOKED = "sha256:token-revoked";

function seedContext(
  db: import("better-sqlite3").Database,
  contextId: string,
  grantId: string,
  options: { state?: string } = {},
): void {
  db.prepare(
    "INSERT INTO context_registry(context_id, owner_id, project_label, state, workspace_grant_id, storage_locator, created_at, updated_at)" +
      " VALUES(?,?,?,?,?,?,?,?)",
  ).run(contextId, "owner-1", "p", options.state ?? "ACTIVE", grantId, `data/${contextId}`, NOW, NOW);
}

function seedGrant(
  db: import("better-sqlite3").Database,
  grantId: string,
  contextId: string,
  options: { accessMode?: string } = {},
): void {
  db.prepare(
    "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, access_mode, grant_version, created_at)" +
      " VALUES(?,?,?,?,?,?)",
  ).run(grantId, contextId, "d:\\project", options.accessMode ?? "READ_WRITE", 1, NOW);
}

function seedBinding(
  db: import("better-sqlite3").Database,
  bindingId: string,
  contextId: string,
  credentialHash: string,
  options: { state?: string; scopes?: string[]; connectionId?: string } = {},
): void {
  db.prepare(
    "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, scopes_json, state, created_at)" +
      " VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    bindingId,
    "owner-1",
    contextId,
    options.connectionId ?? `conn-${bindingId}`,
    `principal-${bindingId}`,
    credentialHash,
    JSON.stringify(options.scopes ?? ["hooshix:read", "hooshix:execute"]),
    options.state ?? "ACTIVE",
    NOW,
  );
}

describe("CI-2.05 / deny-by-default Context Resolver", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: import("better-sqlite3").Database;

  beforeEach(() => {
    // Drop any connection cached from a prior test file in this worker.
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-2-05");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    seedContext(db, CONTEXT_A, GRANT_A);
    seedContext(db, CONTEXT_B, GRANT_B);
    seedGrant(db, GRANT_A, CONTEXT_A);
    seedGrant(db, GRANT_B, CONTEXT_B);
    seedBinding(db, "bind-A", CONTEXT_A, HASH_A);
    seedBinding(db, "bind-B", CONTEXT_B, HASH_B, { scopes: ["hooshix:read"] });
    seedBinding(db, "bind-revoked", CONTEXT_A, HASH_REVOKED, { state: "REVOKED" });
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  it("resolves an ACTIVE binding to its Context, grant and binding", () => {
    const outcome = resolveContext({ credentialHash: HASH_A });
    expect(outcome.status).toBe("RESOLVED");
    if (outcome.status !== "RESOLVED") throw new Error("unreachable");
    expect(outcome.context.id).toBe(CONTEXT_A);
    expect(outcome.grant.id).toBe(GRANT_A);
    expect(outcome.grant.canonicalRoot).toBe("d:\\project");
    expect(outcome.binding.id).toBe("bind-A");
    expect(outcome.binding.principalId).toBe("principal-bind-A");
    expect(outcome.binding.credentialHash).toBe(HASH_A);
    expect(outcome.context.epoch).toBe(1);
  });

  it("keeps two credentials bound to two distinct Contexts apart (threat T01)", () => {
    const a = resolveContext({ credentialHash: HASH_A });
    const b = resolveContext({ credentialHash: HASH_B });
    expect(a.status).toBe("RESOLVED");
    expect(b.status).toBe("RESOLVED");
    if (a.status !== "RESOLVED" || b.status !== "RESOLVED") throw new Error("unreachable");
    expect(a.context.id).not.toBe(b.context.id);
    expect(a.binding.principalId).not.toBe(b.binding.principalId);
  });

  it("refuses an unknown credential rather than falling back (I-06)", () => {
    const outcome = resolveContext({ credentialHash: "sha256:never-issued" });
    expect(outcome).toEqual({ status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" });
  });

  it("refuses an empty credential hash", () => {
    expect(resolveContext({ credentialHash: "" })).toEqual({
      status: "UNBOUND",
      reason: "CONTEXT_NOT_BOUND",
    });
  });

  it("refuses a REVOKED binding — reactivation is impossible by construction (I-07)", () => {
    expect(resolveContext({ credentialHash: HASH_REVOKED })).toEqual({
      status: "UNBOUND",
      reason: "CONTEXT_NOT_BOUND",
    });
  });

  it("refuses a binding whose Context is not ACTIVE", () => {
    db.prepare("UPDATE context_registry SET state='FROZEN' WHERE context_id=?").run(CONTEXT_A);
    const outcome = resolveContext({ credentialHash: HASH_A });
    expect(outcome.status).toBe("INACTIVE");
    if (outcome.status !== "INACTIVE") throw new Error("unreachable");
    expect(outcome.contextState).toBe("FROZEN");
    expect(outcome.reason).toBe("CONTEXT_INACTIVE");
  });

  it("reports a missing required scope instead of resolving partially", () => {
    const outcome = resolveContext({
      credentialHash: HASH_B,
      requiredScopes: ["hooshix:read", "hooshix:execute"],
    });
    expect(outcome.status).toBe("INSUFFICIENT_SCOPE");
    if (outcome.status !== "INSUFFICIENT_SCOPE") throw new Error("unreachable");
    expect(outcome.missing).toEqual(["hooshix:execute"]);
  });

  it("passes when all required scopes are held", () => {
    const outcome = resolveContext({
      credentialHash: HASH_A,
      requiredScopes: ["hooshix:read", "hooshix:execute"],
    });
    expect(outcome.status).toBe("RESOLVED");
  });

  it("treats a Context without a grant as not executable", () => {
    db.prepare("DELETE FROM workspace_grant WHERE grant_id=?").run(GRANT_A);
    const outcome = resolveContext({ credentialHash: HASH_A });
    expect(outcome).toEqual({ status: "INACTIVE", contextState: "FROZEN", reason: "CONTEXT_INACTIVE" });
  });

  it("resolves a legacy operator token to the pinned legacy Context", () => {
    db.prepare(
      "INSERT INTO oauth_access_tokens(token_hash, principal_id, client_id, resource, scopes_json, family_id, issued_at, expires_at, revoked_at)" +
        " VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(HASH_A, "operator", "client-1", "https://mcp.hooshix.com", JSON.stringify(["hooshix:read"]), "fam-1", 1, 2, null);
    // Hash A is already bound to ctx-A by the fixture, so use a fresh hash.
    const legacyHash = "sha256:legacy-token";
    db.prepare(
      "INSERT INTO oauth_access_tokens(token_hash, principal_id, client_id, resource, scopes_json, family_id, issued_at, expires_at, revoked_at)" +
        " VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(legacyHash, "operator", "client-1", "https://mcp.hooshix.com", JSON.stringify(["hooshix:read"]), "fam-1", 1, 2, null);

    const pin = pinLegacyContext(db, NOW);
    expect(pin.pinnedTokenCount).toBe(1);

    const outcome = resolveContext({ credentialHash: legacyHash });
    expect(outcome.status).toBe("RESOLVED");
    if (outcome.status !== "RESOLVED") throw new Error("unreachable");
    expect(outcome.context.id).toBe(LEGACY_CONTEXT_ID);
    expect(outcome.binding.principalId).toBe("operator");
  });

  it("resolves inside a caller-held transaction (resolveContextWith)", () => {
    const outcome = db.transaction(() => {
      db.prepare("UPDATE context_registry SET context_epoch=7 WHERE context_id=?").run(CONTEXT_A);
      return resolveContextWith(db, { credentialHash: HASH_A });
    })();
    expect(outcome.status).toBe("RESOLVED");
    if (outcome.status !== "RESOLVED") throw new Error("unreachable");
    expect(outcome.context.epoch).toBe(7);
  });
});
