import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { closeAgentDatabase, resetMigrationsFlag } from "../../src/core/memory/database/index.js";
import { applyBaseSchemaMigration } from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import { runMigrations, LATEST_MIGRATION_VERSION } from "../../src/core/memory/database/migrations.js";
import { acquireTaskLease } from "../../src/adapters/outbound/persistence/sqlite/repositories/task-lease.adapter.js";
import {
  saveTaskPlan,
  beginStepExecutionReceipt,
} from "../../src/adapters/outbound/persistence/sqlite/repositories/task-repository.adapter.js";
import { runWithTaskLeaseContext } from "../../src/core/runtime/r3-task-lease-context.js";
import { createTaskPlan } from "../../src/core/planner/legacy-task-plan-factory.js";
import type { TaskPlan, TaskStep } from "../../src/application/dto/legacy-task-plan.js";
import {
  acquireOwnershipLease,
} from "../../src/adapters/outbound/persistence/sqlite/repositories/context-lease.adapter.js";
import {
  checkOwnershipFence,
} from "../../src/domain/context/ownership-fence.js";
import {
  heldOwnershipFromPlan,
} from "../../src/application/services/context-ownership-extract.js";

/**
 * CI-G5 — Task/Plan fencing against the Context ownership epoch.
 *
 * The leaf's contract, pinned here against a real SQLite control plane:
 *
 *   1. A Task created while a Context is resolved records (contextId, epoch,
 *      bindingId) on the tasks row, and acquiring its task_lease links that
 *      lease to the same Context via task_leases.context_id.
 *   2. While ownership is unchanged, side effects proceed — the fence is
 *      invisible to a live worker.
 *   3. The moment ownership moves (another binding takes the Context, or the
 *      epoch advances), the very next side effect is refused: the receipt
 *      never starts, the step dies with outcome_unknown, and there is no
 *      retry. That is "zero double execution": a stale worker cannot re-run.
 *   4. Tasks with no recorded Context (every pre-CI task, and every task
 *      created while the flag is OFF) pass through untouched — the fence is
 *      opt-in and cannot break existing deployments.
 */

const CONTEXT_A = "ctx-stress-a";
const CONTEXT_B = "ctx-stress-b";
const NOW = 2_000_000_000_000;

function seedContext(
  db: Database.Database,
  contextId: string,
  bindingId: string,
  grantId = `grant-${contextId}`,
): void {
  const now = "2026-10-02T14:00:00.000Z";
  db.prepare(
    "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
      " VALUES(?,?,?,?,?,?,?)",
  ).run(contextId, "owner-1", "p", grantId, `data/contexts/${contextId}`, now, now);
  db.prepare(
    "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
      " VALUES(?,?,?,?,?,?,?)",
  ).run(bindingId, "owner-1", contextId, `conn-${bindingId}`, "principal-A", `sha256:${bindingId}`, now);
}

/** Read a lease row and map its snake_case columns onto LiveOwnership. */
function readLiveOwnership(
  db: Database.Database,
  contextId: string,
): { contextEpoch: number; ownerBindingId: string; leaseDeadlineMs: number } | null {
  const row = db
    .prepare(
      "SELECT context_epoch, owner_binding_id, lease_deadline_ms FROM ownership_lease WHERE context_id=?",
    )
    .get(contextId) as
    | { context_epoch: number; owner_binding_id: string; lease_deadline_ms: number }
    | undefined;
  if (!row) return null;
  return {
    contextEpoch: row.context_epoch,
    ownerBindingId: row.owner_binding_id,
    leaseDeadlineMs: row.lease_deadline_ms,
  };
}

/** A one-step plan, the minimal shape the fence and the receipt path need. */
function oneStepPlan(taskId?: string): TaskPlan {
  const plan = createTaskPlan("fence-probe", [
    { action: "probe", tool: "exec", arguments: { command: "echo hi" } },
  ]);
  if (taskId) plan.id = taskId;
  return plan;
}

/** A Task bound to a Context, in the state a running loop would see. */
function createBoundTask(input: {
  taskId: string;
  contextId: string;
  epoch: number;
  bindingId: string;
}): void {
  const plan = oneStepPlan(input.taskId);
  plan.state = "running";
  plan.executionContext = {
    principalId: "principal-A",
    sessionId: "sess-1",
    origin: "http_oauth",
    scopes: [],
    workspace: null,
    roots: [],
    unrestricted: false,
    contextId: input.contextId,
    workspaceGrantId: `grant-${input.contextId}`,
    ownershipEpoch: input.epoch,
    createdByBindingId: input.bindingId,
  };
  saveTaskPlan(plan, "running");
}

describe("CI-G5 / migration 25 — tasks and task_leases carry the Context binding", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: Database.Database;

  beforeEach(() => {
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-g5");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    seedContext(db, CONTEXT_A, "binding-a");
    seedContext(db, CONTEXT_B, "binding-b");
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  it("reaches migration head 25 on a fresh database", () => {
    const version = (
      db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as {
        version: number;
      }
    ).version;
    expect(version).toBe(LATEST_MIGRATION_VERSION);
    expect(LATEST_MIGRATION_VERSION).toBeGreaterThanOrEqual(25);
  });

  it("persists the four Context columns and reads them back through the plan", () => {
    acquireOwnershipLease(CONTEXT_A, "binding-a", 60_000);
    createBoundTask({ taskId: "task-1", contextId: CONTEXT_A, epoch: 1, bindingId: "binding-a" });

    const row = db.prepare(
      "SELECT context_id, workspace_grant_id, ownership_epoch, created_by_binding_id FROM tasks WHERE id=?",
    ).get("task-1") as {
      context_id: string | null;
      workspace_grant_id: string | null;
      ownership_epoch: number | null;
      created_by_binding_id: string | null;
    };
    expect(row).toEqual({
      context_id: CONTEXT_A,
      workspace_grant_id: "grant-ctx-stress-a",
      ownership_epoch: 1,
      created_by_binding_id: "binding-a",
    });
  });

  it("links task_leases to the task's Context via context_id", () => {
    acquireOwnershipLease(CONTEXT_A, "binding-a", 60_000);
    createBoundTask({ taskId: "task-2", contextId: CONTEXT_A, epoch: 1, bindingId: "binding-a" });

    const lease = acquireTaskLease("task-2", "runner-1", 30_000);
    expect(lease.taskId).toBe("task-2");

    const row = db.prepare("SELECT context_id FROM task_leases WHERE task_id=?").get("task-2") as {
      context_id: string | null;
    };
    expect(row.context_id).toBe(CONTEXT_A);
  });

  it("leaves task_leases.context_id null for an unbound (pre-CI) task", () => {
    const plan = oneStepPlan("task-legacy");
    plan.state = "running";
    plan.executionContext = {
      principalId: "local-stdio",
      sessionId: "local-stdio-session",
      origin: "local_stdio",
      scopes: [],
      workspace: null,
      roots: [],
      unrestricted: false,
    };
    saveTaskPlan(plan, "running");
    acquireTaskLease("task-legacy", "runner-1", 30_000);
    const row = db.prepare("SELECT context_id FROM task_leases WHERE task_id=?").get("task-legacy") as {
      context_id: string | null;
    };
    expect(row.context_id).toBeNull();
  });
});

describe("CI-G5 / ownership fence — pure decision", () => {
  const held = {
    contextId: CONTEXT_A,
    ownershipEpoch: 3,
    createdByBindingId: "binding-a",
  };

  it("allows an unbound task (flag OFF / pre-CI) without any lease read", () => {
    expect(checkOwnershipFence({ held: undefined, live: null, nowMs: NOW })).toEqual({ kind: "ok" });
  });

  it("allows a side effect while the epoch, binding and deadline all hold", () => {
    expect(
      checkOwnershipFence({
        held,
        live: { contextEpoch: 3, ownerBindingId: "binding-a", leaseDeadlineMs: NOW + 1000 },
        nowMs: NOW,
      }),
    ).toEqual({ kind: "ok" });
  });

  it("is fenced when the epoch advanced (another worker moved the Context)", () => {
    expect(
      checkOwnershipFence({
        held,
        live: { contextEpoch: 4, ownerBindingId: "binding-a", leaseDeadlineMs: NOW + 1000 },
        nowMs: NOW,
      }),
    ).toEqual({ kind: "fenced", reason: "context_epoch_stale" });
  });

  it("is fenced when the binding changed (ownership transferred)", () => {
    expect(
      checkOwnershipFence({
        held,
        live: { contextEpoch: 3, ownerBindingId: "binding-b", leaseDeadlineMs: NOW + 1000 },
        nowMs: NOW,
      }),
    ).toEqual({ kind: "fenced", reason: "context_epoch_stale" });
  });

  it("is fenced when the lease expired, even at the same epoch", () => {
    expect(
      checkOwnershipFence({
        held,
        live: { contextEpoch: 3, ownerBindingId: "binding-a", leaseDeadlineMs: NOW },
        nowMs: NOW,
      }),
    ).toEqual({ kind: "fenced", reason: "context_epoch_stale" });
  });

  it("is fenced (fail-closed) when the lease row is gone", () => {
    expect(checkOwnershipFence({ held, live: null, nowMs: NOW })).toEqual({
      kind: "fenced",
      reason: "ownership_lease_missing",
    });
  });

  it("a stale epoch produces the typed outcome the caller turns into the CI error", () => {
    expect(
      checkOwnershipFence({
        held,
        live: { contextEpoch: 4, ownerBindingId: "binding-a", leaseDeadlineMs: NOW + 1000 },
        nowMs: NOW,
      }),
    ).toEqual({ kind: "fenced", reason: "context_epoch_stale" });
  });

  it("a missing lease row is distinguished from a stale epoch", () => {
    expect(checkOwnershipFence({ held, live: null, nowMs: NOW })).toEqual({
      kind: "fenced",
      reason: "ownership_lease_missing",
    });
  });

  it("heldOwnershipFromPlan returns undefined for an unbound plan", () => {
    const plan = oneStepPlan();
    plan.executionContext = {
      workspace: null,
      roots: [],
      unrestricted: false,
    };
    expect(heldOwnershipFromPlan(plan)).toBeUndefined();
  });

  it("heldOwnershipFromPlan ignores a contextId recorded without an epoch", () => {
    const plan = oneStepPlan();
    plan.executionContext = {
      workspace: null,
      roots: [],
      unrestricted: false,
      contextId: CONTEXT_A,
      createdByBindingId: "binding-a",
    };
    expect(heldOwnershipFromPlan(plan)).toBeUndefined();
  });
});

describe("CI-G5 / fence at the receipt — zero double execution", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: Database.Database;

  beforeEach(() => {
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-g5-fence");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    seedContext(db, CONTEXT_A, "binding-a");
    seedContext(db, CONTEXT_B, "binding-b");
    // Both Contexts start owned by binding-a at epoch 1.
    acquireOwnershipLease(CONTEXT_A, "binding-a", 60_000);
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  /** Start the receipt the way the loop does, inside a live task lease. */
  function beginReceiptFor(taskId: string, step: TaskStep): void {
    runWithTaskLeaseContext(acquireTaskLease(taskId, "runner-1", 30_000), () => {
      beginStepExecutionReceipt(taskId, step, 0, {
        executionId: "exec-" + taskId,
        stepId: step.id,
        attempt: 1,
        toolId: "exec",
        effect: "non_idempotent_mutation",
        status: "started",
        startedAt: new Date().toISOString(),
        reconciliation: "unresolved",
      });
    });
  }

  /** A step of a running Task, in the state the loop dispatches from. */
  function runningStepOf(taskId: string): TaskStep {
    const plan = oneStepPlan(taskId);
    plan.state = "running";
    const step = plan.steps[0];
    step.status = "running";
    step.attempts = 1;
    return step;
  }

  it("allows the receipt while ownership holds", () => {
    createBoundTask({ taskId: "task-ok", contextId: CONTEXT_A, epoch: 1, bindingId: "binding-a" });
    expect(() => beginReceiptFor("task-ok", runningStepOf("task-ok"))).not.toThrow();
  });

  it("refuses the receipt after the epoch advanced, with no retry available", () => {
    createBoundTask({ taskId: "task-stale", contextId: CONTEXT_A, epoch: 1, bindingId: "binding-a" });
    // Ownership moves: another binding takes the Context after the lease lapsed.
    db.prepare("UPDATE ownership_lease SET lease_deadline_ms=? WHERE context_id=?").run(1, CONTEXT_A);
    const takeover = acquireOwnershipLease(CONTEXT_A, "binding-b", 60_000);
    expect(takeover.contextEpoch).toBe(2);

    expect(() => beginReceiptFor("task-stale", runningStepOf("task-stale"))).toThrow(
      /context_epoch_stale|ownership_lease/,
    );
    // No receipt row was ever written — the intent rolled back atomically.
    const rows = db
      .prepare("SELECT execution_id FROM execution_receipts WHERE task_id=?")
      .all("task-stale") as Array<{ execution_id: string }>;
    expect(rows).toHaveLength(0);
  });

  it("refuses the receipt when the lease row was released", () => {
    createBoundTask({ taskId: "task-released", contextId: CONTEXT_A, epoch: 1, bindingId: "binding-a" });
    db.prepare("DELETE FROM ownership_lease WHERE context_id=?").run(CONTEXT_A);
    expect(() => beginReceiptFor("task-released", runningStepOf("task-released"))).toThrow(
      /ownership_lease_missing/,
    );
  });

  it("never fences an unbound task even when no lease exists anywhere", () => {
    db.prepare("DELETE FROM ownership_lease").run();
    const plan = oneStepPlan("task-unbound");
    plan.state = "running";
    plan.executionContext = {
      principalId: "local-stdio",
      sessionId: "local-stdio-session",
      origin: "local_stdio",
      scopes: [],
      workspace: null,
      roots: [],
      unrestricted: false,
    };
    saveTaskPlan(plan, "running");
    expect(() => beginReceiptFor("task-unbound", runningStepOf("task-unbound"))).not.toThrow();
  });
});

describe("CI-G5 / stress — 100 tasks across 10 contexts", () => {
  let fixture: ReturnType<typeof createDisposableFixture>;
  let previousDbPath: string | undefined;
  let db: Database.Database;
  const CONTEXTS = Array.from({ length: 10 }, (_, i) => `ctx-stress-${i}`);

  beforeEach(() => {
    closeAgentDatabase();
    fixture = createDisposableFixture("ci-g5-stress");
    previousDbPath = process.env.HOOSHIX_DB_PATH;
    process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
    resetMigrationsFlag();
    db = fixture.openDatabase();
    applyBaseSchemaMigration(db);
    runMigrations(db);
    for (const [i, contextId] of CONTEXTS.entries()) {
      seedContext(db, contextId, `binding-${i}`, `grant-${i}`);
      // The takeover binding exists too, so a later acquireOwnershipLease by a
      // different binding satisfies the ownership_lease foreign key.
      const now = "2026-10-02T14:00:00.000Z";
      db.prepare(
        "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
          " VALUES(?,?,?,?,?,?,?)",
      ).run(`binding-other-${i}`, "owner-1", contextId, `conn-other-${i}`, "principal-A", `sha256:other-${i}`, now);
      acquireOwnershipLease(contextId, `binding-${i}`, 600_000);
    }
  });

  afterEach(() => {
    db.close();
    closeAgentDatabase();
    resetMigrationsFlag();
    if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
    else process.env.HOOSHIX_DB_PATH = previousDbPath;
    fixture.cleanup();
  });

  it("isolates every context: half the contexts get transferred, only theirs fence", () => {
    const tasks = Array.from({ length: 100 }, (_, n) => {
      const contextIndex = n % 10;
      return {
        taskId: `stress-task-${n}`,
        contextId: CONTEXTS[contextIndex],
        contextIndex,
        epoch: 1,
        bindingId: `binding-${contextIndex}`,
      };
    });

    // Persist all 100 tasks first, so they all observe epoch 1.
    for (const task of tasks) createBoundTask(task);

    // Now half the contexts are taken over by a different binding: their epoch
    // bumps to 2. The other half stay at epoch 1.
    for (let i = 0; i < 10; i += 2) {
      db.prepare("UPDATE ownership_lease SET lease_deadline_ms=? WHERE context_id=?").run(
        1,
        CONTEXTS[i],
      );
      const takeover = acquireOwnershipLease(CONTEXTS[i], `binding-other-${i}`, 600_000);
      expect(takeover.contextEpoch).toBe(2);
    }

    let allowed = 0;
    let fenced = 0;
    for (const task of tasks) {
      const outcome = checkOwnershipFence({
        held: {
          contextId: task.contextId,
          ownershipEpoch: task.epoch,
          createdByBindingId: task.bindingId,
        },
        live: readLiveOwnership(db, task.contextId),
        nowMs: Date.now(),
      });
      if (outcome.kind === "ok") allowed++;
      else fenced++;
    }

    // Exactly the tasks on the 5 transferred contexts (even indices) fence.
    expect(fenced).toBe(50);
    expect(allowed).toBe(50);
    // And the fence verdicts are perfectly partitioned by context.
    for (const [i, contextId] of CONTEXTS.entries()) {
      const contextTasks = tasks.filter((task) => task.contextId === contextId);
      const contextFenced = contextTasks.filter((task) =>
        checkOwnershipFence({
          held: {
            contextId: task.contextId,
            ownershipEpoch: task.epoch,
            createdByBindingId: task.bindingId,
          },
          live: readLiveOwnership(db, task.contextId),
          nowMs: Date.now(),
        }).kind === "fenced",
      ).length;
      expect(contextTasks).toHaveLength(10);
      expect(contextFenced).toBe(i % 2 === 0 ? 10 : 0);
    }
  });
});
