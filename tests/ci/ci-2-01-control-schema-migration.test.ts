import { describe, expect, it } from "vitest";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {
  LATEST_MIGRATION_VERSION,
  runMigrations,
} from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

/**
 * CI-2.01 — control-plane schema. The tables are created by migration 23 only
 * (never in base-schema), so runMigrations must produce them on BOTH fresh and
 * pre-existing databases. A fresh-DB test suite cannot see a gap of this kind
 * by construction — that was the migration-22 lesson — so the upgrade path is
 * simulated explicitly, exactly like r6-idempotency-responses-upgrade.
 */
const CONTROL_TABLES = [
  "context_registry",
  "context_binding",
  "workspace_grant",
  "ownership_lease",
  "handoff_intent",
  "security_audit",
] as const;

function tableInfo(db: import("better-sqlite3").Database, table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>)
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

describe("CI-2.01 / control-plane schema migration 23", () => {
  it("records migration 23 in the migration ledger", () => {
    expect(LATEST_MIGRATION_VERSION).toBeGreaterThanOrEqual(23);
    const fixture = createDisposableFixture("ci-2-01-head");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        expect(
          (db.prepare("SELECT version FROM schema_migrations WHERE version = 23").get() as { version: number }).version,
        ).toBe(23);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("creates all six control tables on a fresh database", () => {
    const fixture = createDisposableFixture("ci-2-01-fresh");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        for (const table of CONTROL_TABLES) {
          expect(
            db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
          ).toBeTruthy();
        }
        expect(
          (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v,
        ).toBe(LATEST_MIGRATION_VERSION);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("creates the control tables when upgrading a database that predates them", () => {
    const fixture = createDisposableFixture("ci-2-01-upgrade");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        // Simulate a live deployment at head 22 that never had the CI tables.
        for (const table of CONTROL_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
        db.prepare("DELETE FROM schema_migrations WHERE version IN (23, 24)").run();
        expect(
          (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v,
        ).toBe(22);
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_registry'").get(),
        ).toBeUndefined();

        // The upgrade path repairs it.
        runMigrations(db);
        expect(
          (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v,
        ).toBe(LATEST_MIGRATION_VERSION);
        for (const table of CONTROL_TABLES) {
          expect(
            db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
          ).toBeTruthy();
        }
        expect(db.pragma("quick_check", { simple: true })).toBe("ok");
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("is idempotent: re-running runMigrations leaves the schema untouched", () => {
    const fixture = createDisposableFixture("ci-2-01-idempotent");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        const snapshot = db.prepare(
          "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'context%' OR name LIKE 'workspace_grant%' OR name LIKE 'ownership_lease%' OR name LIKE 'handoff_intent%' OR name LIKE 'security_audit%' OR name LIKE 'idx_%' ORDER BY name",
        ).all() as Array<{ name: string }>;
        runMigrations(db);
        runMigrations(db);
        const after = db.prepare(
          "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'context%' OR name LIKE 'workspace_grant%' OR name LIKE 'ownership_lease%' OR name LIKE 'handoff_intent%' OR name LIKE 'security_audit%' OR name LIKE 'idx_%' ORDER BY name",
        ).all() as Array<{ name: string }>;
        expect(after.map((r) => r.name)).toEqual(snapshot.map((r) => r.name));
        expect(
          (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 23").get() as { n: number }).n,
        ).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("declares the primary keys the repositories depend on", () => {
    const fixture = createDisposableFixture("ci-2-01-pk");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        expect(tableInfo(db, "context_registry")).toEqual(["context_id"]);
        expect(tableInfo(db, "context_binding")).toEqual(["binding_id"]);
        expect(tableInfo(db, "workspace_grant")).toEqual(["grant_id"]);
        expect(tableInfo(db, "ownership_lease")).toEqual(["context_id"]);
        expect(tableInfo(db, "handoff_intent")).toEqual(["intent_id"]);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("accepts a well-formed control-plane row set and keeps foreign keys consistent", () => {
    const fixture = createDisposableFixture("ci-2-01-fk");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        const now = "2026-10-02T14:00:00.000Z";
        db.prepare(
          "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
            " VALUES(?,?,?,?,?,?,?)",
        ).run("ctx-A", "owner-1", "project-x", "grant-1", "data/contexts/ctx-A", now, now);
        db.prepare(
          "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, created_at) VALUES(?,?,?,?)",
        ).run("grant-1", "ctx-A", "D:\\project-x", now);
        db.prepare(
          "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, credential_hash, created_at)" +
            " VALUES(?,?,?,?,?,?)",
        ).run("bind-1", "owner-1", "ctx-A", "conn-1", "sha256:" + "a".repeat(64), now);
        db.prepare(
          "INSERT INTO ownership_lease(context_id, owner_binding_id, context_epoch, lease_deadline_ms, fencing_token, updated_at)" +
            " VALUES(?,?,?,?,?,?)",
        ).run("ctx-A", "bind-1", 1, 1_762_000_000_000, "fence-1", now);
        db.prepare(
          "INSERT INTO handoff_intent(intent_id, source_context_id, source_binding_id, target_connection_id, kind, source_epoch, ticket_hash, expires_at, created_at)" +
            " VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          "intent-1", "ctx-A", "bind-1", "conn-2", "TRANSFER", 1,
          "sha256:" + "b".repeat(64), now, now,
        );
        db.prepare(
          "INSERT INTO security_audit(owner_id, context_id, binding_id, action, decision, trace_id, occurred_at)" +
            " VALUES(?,?,?,?,?,?,?)",
        ).run("owner-1", "ctx-A", "bind-1", "context.resolve", "ALLOW", "trace-1", now);

        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects out-of-domain state values via CHECK constraints", () => {
    const fixture = createDisposableFixture("ci-2-01-check");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        const now = "2026-10-02T14:00:00.000Z";
        const insertRegistry = db.prepare(
          "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, state, created_at, updated_at)" +
            " VALUES(?,?,?,?,?,?,?,?)",
        );
        expect(() =>
          insertRegistry.run("ctx-B", "owner-1", "p", "g", "data/contexts/ctx-B", "BOGUS", now, now),
        ).toThrow(/CHECK constraint failed/);
        expect(() =>
          insertRegistry.run("ctx-B", "owner-1", "p", "g", "data/contexts/ctx-B", "ACTIVE", now, now),
        ).not.toThrow();
        // Binding state CHECK.
        expect(() =>
          db.prepare(
            "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, credential_hash, state, created_at)" +
              " VALUES(?,?,?,?,?,?,?)",
          ).run("bind-2", "owner-1", "ctx-B", "conn-9", "sha256:x", "LIMBO", now),
        ).toThrow(/CHECK constraint failed/);
        // Access-mode CHECK.
        expect(() =>
          db.prepare(
            "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, access_mode, created_at) VALUES(?,?,?,?,?)",
          ).run("g", "ctx-B", "D:\\p", "READ_SOMETIMES", now),
        ).toThrow(/CHECK constraint failed/);
        // Handoff kind CHECK.
        expect(() =>
          db.prepare(
            "INSERT INTO handoff_intent(intent_id, source_context_id, source_binding_id, target_connection_id, kind, source_epoch, ticket_hash, expires_at, created_at)" +
              " VALUES(?,?,?,?,?,?,?,?,?)",
          ).run("i", "ctx-B", "bind-2", "conn-9", "CLONE", 1, "sha256:y", now, now),
        ).toThrow(/CHECK constraint failed/);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("enforces one active binding per credential and per connection", () => {
    const fixture = createDisposableFixture("ci-2-01-uniq");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        const now = "2026-10-02T14:00:00.000Z";
        db.prepare(
          "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
            " VALUES(?,?,?,?,?,?,?)",
        ).run("ctx-C", "owner-1", "p", "grant-C", "data/contexts/ctx-C", now, now);
        const insert = db.prepare(
          "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, credential_hash, created_at)" +
            " VALUES(?,?,?,?,?,?)",
        );
        insert.run("bind-C1", "owner-1", "ctx-C", "conn-C", "sha256:hash-C", now);
        // Same connection at the same credential version is a duplicate.
        expect(() =>
          insert.run("bind-C2", "owner-1", "ctx-C", "conn-C", "sha256:other", now),
        ).toThrow(/UNIQUE constraint failed/);
        // Same credential hash at the same version is a duplicate.
        expect(() =>
          insert.run("bind-C3", "owner-1", "ctx-C", "conn-D", "sha256:hash-C", now),
        ).toThrow(/UNIQUE constraint failed/);
        // A rotated credential version lets the same connection rebind.
        expect(() =>
          insert.run("bind-C4", "owner-1", "ctx-C", "conn-C", "sha256:hash-C2", now),
        ).toThrow(/UNIQUE constraint failed/);
        // ...but bumping the credential version frees the connection slot.
        db.prepare(
          "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, credential_hash, credential_version, created_at)" +
            " VALUES(?,?,?,?,?,?,?)",
        ).run("bind-C5", "owner-1", "ctx-C", "conn-C", "sha256:hash-C2", 2, now);
        expect(
          (db.prepare("SELECT credential_version AS v FROM context_binding WHERE binding_id='bind-C5'").get() as { v: number }).v,
        ).toBe(2);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });
});
