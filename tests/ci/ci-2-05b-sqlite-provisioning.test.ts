import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { establishConnection } from "../../src/application/services/context-provisioning.js";
import { SqliteContextProvisioningRepository } from "../../src/adapters/outbound/persistence/sqlite/repositories/context-provisioning.adapter.js";
import { resolveContext } from "../../src/adapters/outbound/persistence/sqlite/repositories/context-resolver.adapter.js";
import { LEGACY_CONTEXT_ID, pinLegacyContext } from "../../src/adapters/outbound/persistence/sqlite/repositories/context-legacy.adapter.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { closeAgentDatabase, resetMigrationsFlag } from "../../src/core/memory/database/index.js";
import { runMigrations } from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

/**
 * CI-2.05 / CI-G7b — the SQLite provisioning repository.
 *
 * The CI-G7b host test failed because per-connection issuance was only ever
 * wired to the in-memory fake: the live OAuth path minted no Context, so every
 * connector collapsed onto the pinned legacy Context and `chat_isolation_probe`
 * returned identical pseudonyms. These tests prove the real adapter mints two
 * distinct Contexts that the deny-by-default resolver reads back separately, and
 * that the legacy pin leaves the freshly issued connections untouched.
 */

const NOW = "2026-10-02T14:00:00.000Z";
const OWNER = "operator";
let seq = 0;
const randomId = () => `rand${++seq}_${Date.now()}`;

describe("CI-2.05 / SQLite per-connection provisioning", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: Database.Database;
  let repo: SqliteContextProvisioningRepository;

  beforeEach(() => {
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-provisioning");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    repo = new SqliteContextProvisioningRepository(db);
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  it("mints a distinct Context and binding that the resolver reads back", () => {
    const hashA = "sha256:" + "a".repeat(64);
    const conn = establishConnection(repo, {
      ownerId: OWNER, clientId: "client-A", credentialHash: hashA,
      scopes: ["hooshix:read", "hooshix:execute"], now: NOW, randomId,
    });

    expect(conn.created).toBe(true);
    expect(conn.principalId).toMatch(/^principal_/);
    expect(conn.contextId).toMatch(/^ctx_/);

    const outcome = resolveContext({ credentialHash: hashA });
    expect(outcome.status).toBe("RESOLVED");
    if (outcome.status !== "RESOLVED") throw new Error("unreachable");
    expect(outcome.context.id).toBe(conn.contextId);
    expect(outcome.binding.principalId).toBe(conn.principalId);
    expect(outcome.context.epoch).toBe(1);
    expect(outcome.grant.accessMode).toBe("READ_WRITE");
  });

  it("two connectors get two distinct Contexts and principals (CI-G7b goal)", () => {
    const hashA = "sha256:" + "b".repeat(64);
    const hashB = "sha256:" + "c".repeat(64);
    const a = establishConnection(repo, {
      ownerId: OWNER, clientId: "client-A", credentialHash: hashA,
      scopes: ["hooshix:read"], now: NOW, randomId,
    });
    const b = establishConnection(repo, {
      ownerId: OWNER, clientId: "client-B", credentialHash: hashB,
      scopes: ["hooshix:read"], now: NOW, randomId,
    });

    expect(a.principalId).not.toBe(b.principalId);
    expect(a.contextId).not.toBe(b.contextId);

    const ra = resolveContext({ credentialHash: hashA });
    const rb = resolveContext({ credentialHash: hashB });
    expect(ra.status).toBe("RESOLVED");
    expect(rb.status).toBe("RESOLVED");
    if (ra.status !== "RESOLVED" || rb.status !== "RESOLVED") throw new Error("unreachable");
    expect(ra.context.id).not.toBe(rb.context.id);
    expect(ra.binding.principalId).not.toBe(rb.binding.principalId);
  });

  it("the legacy pin does not pull a freshly provisioned connection onto the shared Context", () => {
    const hashFresh = "sha256:" + "d".repeat(64);
    const fresh = establishConnection(repo, {
      ownerId: OWNER, clientId: "client-A", credentialHash: hashFresh,
      scopes: ["hooshix:read"], now: NOW, randomId,
    });
    // An actual legacy token: principal "operator", no binding yet.
    const hashLegacy = "sha256:" + "e".repeat(64);
    db.prepare(
      "INSERT INTO oauth_access_tokens(token_hash, principal_id, client_id, resource, scopes_json, family_id, issued_at, expires_at, revoked_at)" +
        " VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(hashLegacy, "operator", "client-legacy", "https://mcp.hooshix.com", JSON.stringify(["hooshix:read"]), "fam-legacy", 1, 2, null);

    pinLegacyContext(db, NOW);

    const rf = resolveContext({ credentialHash: hashFresh });
    const rl = resolveContext({ credentialHash: hashLegacy });
    if (rf.status !== "RESOLVED" || rl.status !== "RESOLVED") throw new Error("unreachable");
    // Fresh connection keeps its own Context; only the operator token lands on legacy.
    expect(rf.context.id).toBe(fresh.contextId);
    expect(rf.context.id).not.toBe(LEGACY_CONTEXT_ID);
    expect(rl.context.id).toBe(LEGACY_CONTEXT_ID);
  });

  it("re-authorizing a known connection reuses its Context (rotation path)", () => {
    const hash = "sha256:" + "f".repeat(64);
    const first = establishConnection(repo, {
      ownerId: OWNER, clientId: "client-A", credentialHash: hash,
      scopes: ["hooshix:read"], now: NOW, randomId,
    });
    const reused = establishConnection(repo, {
      ownerId: OWNER, connectionId: first.connectionId, clientId: "client-A",
      credentialHash: "sha256:" + "0".repeat(64), scopes: ["hooshix:read"], now: NOW, randomId,
    });
    expect(reused.created).toBe(false);
    expect(reused.contextId).toBe(first.contextId);
    expect(reused.principalId).toBe(first.principalId);
  });
});
