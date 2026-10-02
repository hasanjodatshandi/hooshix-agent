import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireOwnershipLease,
  advanceOwnershipEpoch,
  assertOwnershipWrite,
  getOwnershipLease,
  releaseOwnershipLease,
} from "../../src/adapters/outbound/persistence/sqlite/repositories/context-lease.adapter.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { closeAgentDatabase, resetMigrationsFlag } from "../../src/core/memory/database/index.js";
import { runMigrations } from "../../src/core/memory/database/migrations.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";

const CONTEXT = "ctx-A";
const BINDING_A = "bind-A";
const BINDING_B = "bind-B";

/**
 * The adapter resolves its connection through withAgentDatabase, which reads
 * HOOSHIX_DB_PATH. Repoint it at an isolated fixture database per test — the
 * same approach as tests/core/r8-migration-failure-aborts.test.ts — so these
 * tests never touch a shared or production database.
 */
describe("CI-2.04 / Context ownership lease fencing", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: import("better-sqlite3").Database;

  beforeEach(() => {
    // Drop any connection cached from a prior test file in this worker: it
    // points at a different database and would ignore HOOSHIX_DB_PATH.
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-2-04");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    // ownership_lease foreign-keys into context_registry and context_binding,
    // so the parents must exist before a lease can be acquired.
    const now = "2026-10-02T14:00:00.000Z";
    db.prepare(
      "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(CONTEXT, "owner-1", "p", "grant-A", "data/contexts/ctx-A", now, now);
    const insertBinding = db.prepare(
      "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    );
    insertBinding.run(BINDING_A, "owner-1", CONTEXT, "conn-A", "principal-A", "sha256:a", now);
    insertBinding.run(BINDING_B, "owner-1", CONTEXT, "conn-B", "principal-B", "sha256:b", now);
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  it("starts a Context at epoch 1 and exposes the fencing token", () => {
    const lease = acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    expect(lease.contextEpoch).toBe(1);
    expect(lease.ownerBindingId).toBe(BINDING_A);
    expect(lease.fencingToken).toBeTruthy();
    expect(getOwnershipLease(CONTEXT)).toEqual(lease);
  });

  it("refuses to take a Context another binding holds live", () => {
    acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    expect(() => acquireOwnershipLease(CONTEXT, BINDING_B, 60_000)).toThrow(/ownership_lease_conflict/);
    expect(getOwnershipLease(CONTEXT)?.ownerBindingId).toBe(BINDING_A);
  });

  it("hands over once the held lease has expired", () => {
    const first = acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    // While it is live, another binding cannot take it.
    expect(() => acquireOwnershipLease(CONTEXT, BINDING_B, 60_000)).toThrow(/ownership_lease_conflict/);
    // Expire it deterministically rather than sleeping.
    db.prepare("UPDATE ownership_lease SET lease_deadline_ms=? WHERE context_id=?").run(1, CONTEXT);
    // Now a different binding can take over.
    const second = acquireOwnershipLease(CONTEXT, BINDING_B, 60_000);
    // A new acquisition bumps the epoch: the previous fencing token is dead.
    expect(second.contextEpoch).toBe(first.contextEpoch + 1);
    expect(second.fencingToken).not.toBe(first.fencingToken);
    expect(second.ownerBindingId).toBe(BINDING_B);
  });

  it("advances the epoch only under the exact expected (epoch, binding)", () => {
    const lease = acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    const advanced = advanceOwnershipEpoch({
      contextId: CONTEXT,
      expectedEpoch: lease.contextEpoch,
      expectedBindingId: lease.ownerBindingId,
      fencingToken: "fence-2",
      newDeadlineMs: Date.now() + 120_000,
    });
    expect(advanced.contextEpoch).toBe(2);
    expect(advanced.fencingToken).toBe("fence-2");

    // A stale epoch is refused.
    expect(() =>
      advanceOwnershipEpoch({
        contextId: CONTEXT,
        expectedEpoch: lease.contextEpoch, // stale: now 2
        expectedBindingId: lease.ownerBindingId,
        fencingToken: "fence-3",
        newDeadlineMs: Date.now() + 120_000,
      }),
    ).toThrow(/ownership_lease_stale_epoch/);
    // A foreign binding is refused.
    expect(() =>
      advanceOwnershipEpoch({
        contextId: CONTEXT,
        expectedEpoch: 2,
        expectedBindingId: BINDING_B,
        fencingToken: "fence-4",
        newDeadlineMs: Date.now() + 120_000,
      }),
    ).toThrow(/ownership_lease_stale_epoch/);
  });

  it("blocks a side effect whose lease was superseded (threat T08)", () => {
    const worker = acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    // The worker is still current: its write is allowed.
    expect(() =>
      assertOwnershipWrite(db, CONTEXT, {
        ownerBindingId: worker.ownerBindingId,
        contextEpoch: worker.contextEpoch,
        fencingToken: worker.fencingToken,
      }),
    ).not.toThrow();

    // Ownership moves while the worker is mid-flight.
    db.prepare("UPDATE ownership_lease SET lease_deadline_ms=? WHERE context_id=?").run(1, CONTEXT);
    acquireOwnershipLease(CONTEXT, BINDING_B, 60_000);

    // The worker's late commit must be refused — even though its earlier
    // external effect may already have happened.
    expect(() =>
      assertOwnershipWrite(db, CONTEXT, {
        ownerBindingId: worker.ownerBindingId,
        contextEpoch: worker.contextEpoch,
        fencingToken: worker.fencingToken,
      }),
    ).toThrow(/ownership_lease_fenced/);
  });

  it("blocks a side effect past the lease deadline", () => {
    const lease = acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    db.prepare("UPDATE ownership_lease SET lease_deadline_ms=? WHERE context_id=?").run(1, CONTEXT);
    expect(() =>
      assertOwnershipWrite(db, CONTEXT, {
        ownerBindingId: lease.ownerBindingId,
        contextEpoch: lease.contextEpoch,
        fencingToken: lease.fencingToken,
      }),
    ).toThrow(/ownership_lease_fenced/);
  });

  it("releases a lease voluntarily", () => {
    const lease = acquireOwnershipLease(CONTEXT, BINDING_A, 60_000);
    expect(releaseOwnershipLease(CONTEXT, lease.ownerBindingId, lease.fencingToken)).toBe(true);
    // A released lease confers no authority.
    expect(() =>
      assertOwnershipWrite(db, CONTEXT, {
        ownerBindingId: lease.ownerBindingId,
        contextEpoch: lease.contextEpoch,
        fencingToken: lease.fencingToken,
      }),
    ).toThrow(/ownership_lease_fenced/);
    // Releasing with the wrong token changes nothing.
    expect(releaseOwnershipLease(CONTEXT, lease.ownerBindingId, "wrong")).toBe(false);
  });

  it("validates lease inputs", () => {
    expect(() => acquireOwnershipLease("", BINDING_A)).toThrow(/invalid_ownership_lease_identity/);
    expect(() => acquireOwnershipLease(CONTEXT, "")).toThrow(/invalid_ownership_lease_identity/);
    expect(() => acquireOwnershipLease(CONTEXT, BINDING_A, 50)).toThrow(/invalid_ownership_lease_ttl/);
    expect(() =>
      advanceOwnershipEpoch({
        contextId: CONTEXT, expectedEpoch: 0, expectedBindingId: BINDING_A,
        fencingToken: "f", newDeadlineMs: 1,
      }),
    ).toThrow(/invalid_ownership_epoch/);
    expect(() =>
      advanceOwnershipEpoch({
        contextId: CONTEXT, expectedEpoch: 1, expectedBindingId: BINDING_A,
        fencingToken: "f", newDeadlineMs: 0,
      }),
    ).toThrow(/invalid_ownership_deadline/);
    expect(getOwnershipLease("ctx-nonexistent")).toBe(null);
  });
});
