import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { runMigrations, LATEST_MIGRATION_VERSION } from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

/**
 * The 2026-10-02 retest found file idempotency still broken on the LIVE
 * database while every fresh-database test passed: `idempotency_responses`
 * existed only in the base schema for newly created databases, so an upgraded
 * database (head 21) never received it and write_file/delete_file with an
 * idempotencyKey died with "no such table" -> tool_handler_failure. Fresh-DB
 * tests cannot see this class of bug by construction; this file simulates the
 * upgrade path explicitly.
 */
describe("R6 file-idempotency table upgrade for pre-existing databases", () => {
  it("creates idempotency_responses when upgrading a database that predates it", () => {
    const fixture = createDisposableFixture("r6-idemp-upgrade");
    try {
      const db = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(db);
        runMigrations(db);
        // Simulate a database that predates the table: it sits at the pre-22
        // migration head and never received idempotency_responses. Newer
        // migrations (23, ci-control-schema) must be rolled back too, so the
        // simulated head is 21 and re-running repairs everything in order.
        db.exec("DROP TABLE idempotency_responses");
        for (const table of [
          "security_audit", "handoff_intent", "ownership_lease",
          "workspace_grant", "context_binding", "context_registry",
        ]) db.exec(`DROP TABLE IF EXISTS ${table}`);
        db.prepare("DELETE FROM schema_migrations WHERE version IN (22, 23)").run();
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_responses'").get(),
        ).toBeUndefined();
        expect(
          (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v,
        ).toBe(21);

        // The upgrade path repairs it.
        runMigrations(db);
        expect(
          (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v,
        ).toBe(LATEST_MIGRATION_VERSION);
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_responses'").get(),
        ).toBeTruthy();
        // The composite primary key contract the repository depends on
        // (same key+operation+hash dedupes; a different hash is a new request).
        const info = db.prepare("PRAGMA table_info(idempotency_responses)").all() as Array<{ name: string; pk: number }>;
        const pkColumns = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
        expect(pkColumns).toEqual(["id", "operation", "request_hash"]);
        expect(db.pragma("quick_check", { simple: true })).toBe("ok");
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("repairs a legacy database through the normal open-and-migrate entrypoint", () => {
    const fixture = createDisposableFixture("r6-idemp-legacy");
    const repo = process.cwd();
    try {
      // Seed a legacy database: fully migrated to the pre-22 head, but without
      // the idempotency table (as every live deployment predating it is).
      // Migration 23's tables are dropped as well so the seed truly predates 22.
      const seed = fixture.openDatabase();
      try {
        applyBaseSchemaMigration(seed);
        runMigrations(seed);
        seed.exec("DROP TABLE idempotency_responses");
        for (const table of [
          "security_audit", "handoff_intent", "ownership_lease",
          "workspace_grant", "context_binding", "context_registry",
        ]) seed.exec(`DROP TABLE IF EXISTS ${table}`);
        seed.prepare("DELETE FROM schema_migrations WHERE version IN (22, 23)").run();
      } finally {
        seed.close();
      }

      // Open it exactly the way the server does: withAgentDatabase runs
      // runMigrations on first access, which must backfill the missing table.
      const entry = pathToFileURL(path.join(repo, "src", "core", "memory", "database", "index.ts")).href;
      const script = `import assert from "node:assert/strict";
        import { withAgentDatabase, closeAgentDatabase } from ${JSON.stringify(entry)};
        const insert = "INSERT OR IGNORE INTO idempotency_responses(id,operation,request_hash,response,created_at) VALUES(?,?,?,?,?)";
        const result = withAgentDatabase(db => ({
          head: db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v,
          table: db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_responses'").get(),
          first: db.prepare(insert).run("k","write","h1","{}","2026-10-02T00:00:00Z").changes,
          replay: db.prepare(insert).run("k","write","h1","{}","2026-10-02T00:00:00Z").changes,
          otherHash: db.prepare(insert).run("k","write","h2","{}","2026-10-02T00:00:00Z").changes,
          rows: db.prepare("SELECT COUNT(*) AS n FROM idempotency_responses").get().n,
        }));
        assert.equal(result.head, ${LATEST_MIGRATION_VERSION});
        assert.ok(result.table, "idempotency_responses must be repaired on upgrade");
        assert.equal(result.first, 1);
        assert.equal(result.replay, 0, "identical key+operation+hash must dedupe");
        assert.equal(result.otherHash, 1, "a different request hash is a distinct request");
        assert.equal(result.rows, 2);
        closeAgentDatabase();
        console.log("R6_IDEMP_UPGRADE_OK");`;
      const loader = pathToFileURL(path.join(repo, "node_modules", "tsx", "dist", "loader.mjs")).href;
      const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", script], {
        cwd: fixture.root, windowsHide: true, encoding: "utf8", maxBuffer: 65536, timeout: 12000,
        env: {
          ...process.env,
          HOOSHIX_DB_PATH: fixture.sqlitePath,
          HOOSHIX_LOG_DIR: path.join(fixture.root, "logs"),
          HOOSHIX_WORKSPACE: fixture.root,
        },
      });
      expect(child.status, child.stderr || child.error?.message).toBe(0);
      expect(child.stdout.trim()).toBe("R6_IDEMP_UPGRADE_OK");
    } finally {
      fixture.cleanup();
    }
  }, 20000);
});
