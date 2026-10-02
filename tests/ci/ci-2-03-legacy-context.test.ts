import { describe, expect, it } from "vitest";
import {
  LEGACY_CONTEXT_ID,
  isLegacyContextId,
  isLegacyPrincipal,
  pinLegacyContext,
} from "../../src/adapters/outbound/persistence/sqlite/repositories/context-legacy.adapter.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { runMigrations } from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

const NOW = "2026-10-02T14:00:00.000Z";

function seedGrant(
  db: import("better-sqlite3").Database,
  tokenHash: string,
  principalId: string,
  options: { revoked?: boolean; scopes?: string[] } = {},
): void {
  db.prepare(
    "INSERT INTO oauth_access_tokens(token_hash, principal_id, client_id, resource, scopes_json, family_id, issued_at, expires_at, revoked_at)" +
      " VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    tokenHash,
    principalId,
    "client-1",
    "https://mcp.hooshix.com",
    JSON.stringify(options.scopes ?? ["hooshix:read"]),
    "family-1",
    1,
    2,
    options.revoked ? 1 : null,
  );
}

describe("CI-2.03 / legacy Context pinning", () => {
  it("creates the legacy Context once and binds every active operator token", () => {
    const fixture = createDisposableFixture("ci-2-03-pin");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        seedGrant(db, "sha256:token-aaa", "operator");
        seedGrant(db, "sha256:token-bbb", "operator", { scopes: ["hooshix:read", "hooshix:execute"] });

        const result = pinLegacyContext(db, NOW);

        expect(result.contextId).toBe(LEGACY_CONTEXT_ID);
        expect(result.alreadyExisted).toBe(false);
        expect(result.pinnedTokenCount).toBe(2);
        expect(
          (db.prepare("SELECT COUNT(*) AS n FROM context_binding WHERE context_id=?").get(LEGACY_CONTEXT_ID) as { n: number }).n,
        ).toBe(2);
        // Every binding carries the legacy principal; each token is its own
        // synthetic connection, all resolving to the one legacy Context.
        for (const row of db
          .prepare("SELECT principal_id, context_id FROM context_binding WHERE context_id=?")
          .all(LEGACY_CONTEXT_ID) as Array<{ principal_id: string; context_id: string }>) {
          expect(row.principal_id).toBe("operator");
          expect(row.context_id).toBe(LEGACY_CONTEXT_ID);
        }
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("is idempotent: re-pinning creates no duplicate Context or bindings", () => {
    const fixture = createDisposableFixture("ci-2-03-idem");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        seedGrant(db, "sha256:token-aaa", "operator");

        pinLegacyContext(db, NOW);
        const second = pinLegacyContext(db, NOW);

        expect(second.alreadyExisted).toBe(true);
        expect(second.pinnedTokenCount).toBe(0);
        expect(
          (db.prepare("SELECT COUNT(*) AS n FROM context_registry WHERE context_id=?").get(LEGACY_CONTEXT_ID) as { n: number }).n,
        ).toBe(1);
        expect(
          (db.prepare("SELECT COUNT(*) AS n FROM context_binding WHERE credential_hash=?").get("sha256:token-aaa") as { n: number }).n,
        ).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("picks up tokens minted since the last pin without disturbing existing ones", () => {
    const fixture = createDisposableFixture("ci-2-03-incremental");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        seedGrant(db, "sha256:token-aaa", "operator");
        pinLegacyContext(db, NOW);

        seedGrant(db, "sha256:token-bbb", "operator");
        const result = pinLegacyContext(db, NOW);

        expect(result.pinnedTokenCount).toBe(1);
        expect(
          (db.prepare("SELECT COUNT(*) AS n FROM context_binding WHERE context_id=?").get(LEGACY_CONTEXT_ID) as { n: number }).n,
        ).toBe(2);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("does not bind revoked tokens or a different principal", () => {
    const fixture = createDisposableFixture("ci-2-03-scope");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        seedGrant(db, "sha256:revoked", "operator", { revoked: true });
        seedGrant(db, "sha256:other-principal", "principal-conn-9");

        const result = pinLegacyContext(db, NOW);

        expect(result.pinnedTokenCount).toBe(0);
        expect(
          (db.prepare("SELECT COUNT(*) AS n FROM context_binding WHERE context_id=?").get(LEGACY_CONTEXT_ID) as { n: number }).n,
        ).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("records the deployment's primary workspace root on the legacy grant", () => {
    const fixture = createDisposableFixture("ci-2-03-root");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        db.prepare(
          "INSERT INTO workspace_roots(id, path, normalized_path, created_at, updated_at) VALUES(?,?,?,?,?)",
        ).run("root-1", "D:\\project", "d:\\project", NOW, NOW);
        seedGrant(db, "sha256:token-aaa", "operator");

        const result = pinLegacyContext(db, NOW);

        expect(result.canonicalRoot).toBe("d:\\project");
        const grant = db
          .prepare("SELECT canonical_root FROM workspace_grant WHERE grant_id='grant-legacy-shared'")
          .get() as { canonical_root: string };
        expect(grant.canonical_root).toBe("d:\\project");
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("marks the legacy identity distinctly so it is never treated as a real connection", () => {
    expect(isLegacyPrincipal("operator")).toBe(true);
    expect(isLegacyPrincipal("principal_conn_abc")).toBe(false);
    expect(isLegacyContextId(LEGACY_CONTEXT_ID)).toBe(true);
    expect(isLegacyContextId("ctx_abc123")).toBe(false);
  });
});
