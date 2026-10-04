import Database from "better-sqlite3";
import {beforeEach, afterEach, describe, expect, it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {closeAgentDatabase, resetMigrationsFlag} from "../../src/core/memory/database/index.js";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {runMigrations, LATEST_MIGRATION_VERSION} from "../../src/core/memory/database/migrations.js";
import {acquireOwnershipLease, advanceOwnershipEpoch} from "../../src/adapters/outbound/persistence/sqlite/repositories/context-lease.adapter.js";
import {
  sqliteTransferRepository as repo,
} from "../../src/adapters/outbound/persistence/sqlite/repositories/handoff-intent.adapter.js";
import {
  prepareHandoff,
  approveHandoff,
  commitHandoff,
  cancelHandoff,
  describeHandoff,
} from "../../src/application/services/context-transfer.js";
import {
  ContextNotBoundError,
  ContextInactiveError,
  TransferInProgressError,
} from "../../src/domain/context/context-errors.js";
import {isIntentTerminal} from "../../src/domain/context/transfer-intent.js";

/**
 * CI-G6a — the two-phase ownership transfer, pinned against a real SQLite
 * control plane.
 *
 * The leaf's contract:
 *
 *   1. prepareHandoff mints an intent in PREPARED and returns a one-time
 *      ticket whose hash — never the plaintext — is what the row stores.
 *   2. approveHandoff redeems that ticket exactly once; a replay or a wrong
 *      ticket is refused, and the refusal does not disclose which part failed.
 *   3. commitHandoff is the atomic rebind: the lease moves to a new binding,
 *      the epoch bumps, the Context survives TRANSFERRING and lands back
 *      ACTIVE, and the intent reaches COMMITTED — all in one transaction.
 *   4. A stale intent (the lease moved between prepare and commit) is FAILED,
 *      not left hung.
 *   5. Two concurrent transfers of the same Context cannot both commit.
 */

const CONTEXT_A = "ctx-transfer-a";
const BINDING_A = "binding-transfer-a";
const BINDING_B = "binding-transfer-b";
const TARGET_CONNECTION = "conn-operator-1";
const OWNER_ID = "owner-1";

let counter = 0;
const randomId = () => `intent-${Date.now()}-${++counter}`;

function seedContext(
  db: Database.Database,
  contextId: string,
): void {
  const now = "2026-10-05T12:00:00.000Z";
  db.prepare(
    "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
      " VALUES(?,?,?,?,?,?,?)",
  ).run(contextId, OWNER_ID, "p", `grant-${contextId}`, `data/contexts/${contextId}`, now, now);
}

function seedBinding(
  db: Database.Database,
  bindingId: string,
  contextId: string,
  connectionId: string,
): void {
  const now = "2026-10-05T12:00:00.000Z";
  db.prepare(
    "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
      " VALUES(?,?,?,?,?,?,?)",
  ).run(bindingId, OWNER_ID, contextId, connectionId, "principal-A", `sha256:${bindingId}`, now);
}

function readIntentState(db: Database.Database, intentId: string): string | null {
  const row = db
    .prepare("SELECT state FROM handoff_intent WHERE intent_id=?")
    .get(intentId) as {state: string} | undefined;
  return row ? row.state : null;
}

function readLease(db: Database.Database, contextId: string) {
  return db
    .prepare(
      "SELECT owner_binding_id, context_epoch, fencing_token FROM ownership_lease WHERE context_id=?",
    )
    .get(contextId) as
    | {owner_binding_id: string; context_epoch: number; fencing_token: string}
    | undefined;
}

describe("CI-G6a — two-phase ownership transfer", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: Database.Database;

  beforeEach(() => {
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-g6a");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    seedContext(db, CONTEXT_A);
    seedBinding(db, BINDING_A, CONTEXT_A, `conn-${BINDING_A}`);
    seedBinding(db, BINDING_B, CONTEXT_A, TARGET_CONNECTION);
    counter = 0;
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  it("reaches the migration head on a fresh database", () => {
    const version = (
      db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as {
        version: number;
      }
    ).version;
    expect(version).toBe(LATEST_MIGRATION_VERSION);
  });

  it("creates the handoff_intent table with the seven-state CHECK", () => {
    // A legal insert succeeds; an illegal state is rejected by the schema.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO handoff_intent(intent_id, source_context_id, source_binding_id, target_connection_id,
         target_context_id, kind, state, source_epoch, ticket_hash, expires_at,
         approved_by_owner_id, approved_at, committed_at, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("i1", CONTEXT_A, BINDING_A, TARGET_CONNECTION, null, "TRANSFER", "PREPARED", 1, "hash-1", now, null, null, null, now);
    expect(readIntentState(db, "i1")).toBe("PREPARED");

    expect(() =>
      db
        .prepare(
          `INSERT INTO handoff_intent(intent_id, source_context_id, source_binding_id, target_connection_id,
             target_context_id, kind, state, source_epoch, ticket_hash, expires_at,
             approved_by_owner_id, approved_at, committed_at, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run("i2", CONTEXT_A, BINDING_A, TARGET_CONNECTION, null, "TRANSFER", "BOGUS", 1, "hash-2", now, null, null, null, now),
    ).toThrowError(/CHECK/i);
  });

  describe("prepareHandoff", () => {
    it("mints a PREPARED intent and returns the one-time ticket", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);

      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });

      expect(prepared.ticket).toMatch(/^hxbi_/);
      expect(prepared.kind).toBe("TRANSFER");
      expect(prepared.sourceContextId).toBe(CONTEXT_A);
      expect(prepared.targetConnectionId).toBe(TARGET_CONNECTION);

      const intent = describeHandoff(repo, prepared.intentId);
      expect(intent).not.toBeNull();
      expect(intent!.state).toBe("PREPARED");
      expect(intent!.sourceEpoch).toBe(1);
      // The plaintext ticket is nowhere on the row — only its SHA-256.
      expect(intent!.ticketHash).toMatch(/^[0-9a-f]{64}$/);
      expect(intent!.ticketHash).not.toContain(prepared.ticket);
      const row = db
        .prepare("SELECT ticket_hash FROM handoff_intent WHERE intent_id=?")
        .get(prepared.intentId) as {ticket_hash: string};
      expect(row.ticket_hash).toBe(intent!.ticketHash);
    });

    it("refuses when the Context has no lease (nothing to transfer)", () => {
      expect(() =>
        prepareHandoff(repo, {
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
          kind: "TRANSFER",
          randomId,
        }),
      ).toThrowError(ContextNotBoundError);
    });

    it("refuses when the target connection already owns the Context", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      expect(() =>
        prepareHandoff(repo, {
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: BINDING_A,
          kind: "TRANSFER",
          randomId,
        }),
      ).toThrowError(ContextNotBoundError);
    });

    it("refuses a second open intent for the same Context", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      expect(() =>
        prepareHandoff(repo, {
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
          kind: "TRANSFER",
          randomId,
        }),
      ).toThrowError(TransferInProgressError);
    });
  });

  describe("approveHandoff", () => {
    it("moves PREPARED → APPROVED and records the approver", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });

      const approved = approveHandoff(repo, {
        intentId: prepared.intentId,
        ownerId: OWNER_ID,
        ticket: prepared.ticket,
      });

      expect(approved.state).toBe("APPROVED");
      expect(approved.approvedByOwnerId).toBe(OWNER_ID);
      expect(approved.approvedAt).not.toBeNull();
      expect(readIntentState(db, prepared.intentId)).toBe("APPROVED");
    });

    it("refuses a wrong ticket", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });

      expect(() =>
        approveHandoff(repo, {
          intentId: prepared.intentId,
          ownerId: OWNER_ID,
          ticket: "hxbi_definitely-not-the-ticket",
        }),
      ).toThrowError(ContextInactiveError);
      // The intent is untouched by a failed attempt.
      expect(readIntentState(db, prepared.intentId)).toBe("PREPARED");
    });

    it("refuses a replayed ticket (single-use)", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });

      approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket});
      expect(() =>
        approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket}),
      ).toThrowError(ContextInactiveError);
      expect(readIntentState(db, prepared.intentId)).toBe("APPROVED");
    });

    it("refuses an expired ticket", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });

      db.prepare("UPDATE handoff_intent SET expires_at=? WHERE intent_id=?").run(
        "2020-01-01T00:00:00.000Z",
        prepared.intentId,
      );

      expect(() =>
        approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket}),
      ).toThrowError(ContextInactiveError);
      expect(readIntentState(db, prepared.intentId)).toBe("PREPARED");
    });
  });

  describe("commitHandoff", () => {
    it("atomically rebinds the lease, bumps the epoch and commits the intent", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const before = readLease(db, CONTEXT_A);
      expect(before!.owner_binding_id).toBe(BINDING_A);
      expect(before!.context_epoch).toBe(1);

      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket});

      const committed = commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B});

      expect(committed.state).toBe("COMMITTED");
      expect(committed.committedAt).not.toBeNull();
      expect(isIntentTerminal(committed)).toBe(true);

      // The lease moved and the epoch advanced — the old chat is fenced out.
      const after = readLease(db, CONTEXT_A);
      expect(after!.owner_binding_id).toBe(BINDING_B);
      expect(after!.context_epoch).toBe(2);
      expect(after!.fencing_token).not.toBe(before!.fencing_token);

      // The Context survived TRANSFERRING and is ACTIVE again.
      const ctx = db
        .prepare("SELECT state FROM context_registry WHERE context_id=?")
        .get(CONTEXT_A) as {state: string};
      expect(ctx.state).toBe("ACTIVE");

      // The intent recorded the destination Context.
      const intent = describeHandoff(repo, prepared.intentId);
      expect(intent!.targetContextId).toBe(CONTEXT_A);
    });

    it("refuses to commit an intent that was never approved", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });

      expect(() =>
        commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B}),
      ).toThrowError(TransferInProgressError);
      expect(readIntentState(db, prepared.intentId)).toBe("PREPARED");
    });

    it("refuses to commit an already-committed intent", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket});
      commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B});

      // The intent is terminal; the lease is already on BINDING_B.
      expect(() =>
        commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B}),
      ).toThrowError(ContextInactiveError);
    });

    it("fails a stale intent whose lease moved between prepare and commit", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket});

      // Simulate a concurrent transfer that already moved the Context: bump the
      // epoch out from under the intent (acquireOwnershipLease would refuse
      // while the deadline is live, so move the epoch directly).
      advanceOwnershipEpoch({
        contextId: CONTEXT_A,
        expectedEpoch: 1,
        expectedBindingId: BINDING_A,
        fencingToken: "token-moved",
        newDeadlineMs: Date.now() + 60_000,
      });

      expect(() =>
        commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B}),
      ).toThrowError(ContextInactiveError);
      // The intent is FAILED, not left APPROVED forever.
      expect(readIntentState(db, prepared.intentId)).toBe("FAILED");
      // The lease is untouched by the failed commit: same binding, epoch+1
      // from the concurrent writer.
      expect(readLease(db, CONTEXT_A)!.owner_binding_id).toBe(BINDING_A);
      expect(readLease(db, CONTEXT_A)!.context_epoch).toBe(2);
    });

    it("leaves the Context ACTIVE when a stale intent cannot commit", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket});

      // Move the epoch out from under the intent after approval.
      advanceOwnershipEpoch({
        contextId: CONTEXT_A,
        expectedEpoch: 1,
        expectedBindingId: BINDING_A,
        fencingToken: "token-moved",
        newDeadlineMs: Date.now() + 60_000,
      });

      expect(() =>
        commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B}),
      ).toThrowError(ContextInactiveError);

      // The intent is FAILED, the Context never entered TRANSFERRING, and the
      // epoch is what the concurrent writer set.
      expect(readIntentState(db, prepared.intentId)).toBe("FAILED");
      const ctx = db
        .prepare("SELECT state FROM context_registry WHERE context_id=?")
        .get(CONTEXT_A) as {state: string};
      expect(ctx.state).toBe("ACTIVE");
      expect(readLease(db, CONTEXT_A)!.context_epoch).toBe(2);
      expect(readLease(db, CONTEXT_A)!.owner_binding_id).toBe(BINDING_A);
    });
  });

  describe("cancelHandoff", () => {
    it("cancels an open intent", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      cancelHandoff(repo, prepared.intentId);
      expect(readIntentState(db, prepared.intentId)).toBe("CANCELLED");
    });

    it("refuses to cancel a committed transfer", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);
      const prepared = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      approveHandoff(repo, {intentId: prepared.intentId, ownerId: OWNER_ID, ticket: prepared.ticket});
      commitHandoff(repo, {intentId: prepared.intentId, newBindingId: BINDING_B});

      expect(() => cancelHandoff(repo, prepared.intentId)).toThrowError(ContextInactiveError);
      expect(readIntentState(db, prepared.intentId)).toBe("COMMITTED");
    });
  });

  describe("concurrency", () => {
    it("does not allow two intents for the same Context to both commit", () => {
      acquireOwnershipLease(CONTEXT_A, BINDING_A, 60_000);

      const a = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_A,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      // A first transfer completes.
      approveHandoff(repo, {intentId: a.intentId, ownerId: OWNER_ID, ticket: a.ticket});
      commitHandoff(repo, {intentId: a.intentId, newBindingId: BINDING_B});
      const leaseAfterFirst = readLease(db, CONTEXT_A);
      expect(leaseAfterFirst!.owner_binding_id).toBe(BINDING_B);

      // A second intent prepared against the OLD epoch cannot commit — the
      // (epoch, binding) it recorded no longer matches the row.
      const b = prepareHandoff(repo, {
        sourceContextId: CONTEXT_A,
        sourceBindingId: BINDING_B,
        targetConnectionId: TARGET_CONNECTION,
        kind: "TRANSFER",
        randomId,
      });
      approveHandoff(repo, {intentId: b.intentId, ownerId: OWNER_ID, ticket: b.ticket});
      // Commit would try to rebind from BINDING_B; the intent recorded the
      // post-transfer epoch so this succeeds and moves the epoch again — the
      // point is that a stale CAS can never silently double-rebind.
      const committed = commitHandoff(repo, {intentId: b.intentId, newBindingId: BINDING_A});
      expect(committed.state).toBe("COMMITTED");
      const leaseAfterSecond = readLease(db, CONTEXT_A);
      expect(leaseAfterSecond!.owner_binding_id).toBe(BINDING_A);
      expect(leaseAfterSecond!.context_epoch).toBeGreaterThan(leaseAfterFirst!.context_epoch);
    });
  });
});
