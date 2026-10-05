import crypto from "node:crypto";
import {beforeEach, afterEach, describe, expect, it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import Database from "better-sqlite3";
import {runMigrations} from "../../src/core/memory/database/migrations.js";
import {applyBaseSchemaMigration} from "../../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {closeAgentDatabase} from "../../src/adapters/outbound/persistence/sqlite/connection.adapter.js";
import {createRequestObserver} from "../../src/application/services/context-isolation-observer.js";
import {decideEnforcement} from "../../src/application/services/context-isolation-enforcer.js";
import {resolveContextAsync} from "../../src/adapters/outbound/persistence/sqlite/repositories/context-resolver.adapter.js";
import {recordControlPlaneAuditFromPort} from "../../src/adapters/outbound/persistence/sqlite/repositories/context-audit.adapter.js";

/**
 * CI-G9 — before/after benchmark of the isolation request path.
 *
 * The gate asks for a benchmark before and after Chat Isolation. The cost that
 * matters is the one added to EVERY authorised request, so this measures the
 * resolution + enforcement path directly — the same two calls the HTTP handler
 * makes after the credential verifies — rather than end-to-end HTTP latency,
 * which is dominated by the transport and would bury the signal in noise.
 *
 * Three regimes are compared on one database:
 *
 *   OFF            — the observer short-circuits: no resolution, no audit row.
 *                    This is the "before" curve; its cost is effectively zero.
 *   SHADOW         — resolve + audit, but never refuse. The "observe" curve.
 *   PER_CONNECTION — resolve + audit + decide. The "after" curve in production.
 *
 * The acceptance question is not "is isolation free" — it is not — but "is the
 * added cost a bounded, single-digit operation per request". It is: one indexed
 * lookup on `context_binding.credential_hash` and one insert into
 * `security_audit`. No scans, no joins, no network. This suite pins that the
 * per-request overhead stays inside a generous budget so a regression that
 * turns a lookup into a scan is caught here rather than in production.
 */

let fixture: ReturnType<typeof createDisposableFixture>;
let previousDbPath: string | undefined;
let boundHash: string;
const unboundHash = crypto.createHash("sha256").update("hx_rehearsal_unbound").digest("hex");

beforeEach(() => {
  closeAgentDatabase();
  fixture = createDisposableFixture("ci-g9-bench");
  previousDbPath = process.env.HOOSHIX_DB_PATH;
  process.env.HOOSHIX_DB_PATH = fixture.sqlitePath;
  const db = fixture.openDatabase();
  applyBaseSchemaMigration(db);
  runMigrations(db);
  // A bound credential: Context + grant + binding, all ACTIVE.
  const now = new Date().toISOString();
  const raw = "hx_" + crypto.randomBytes(32).toString("base64url");
    boundHash = crypto.createHash("sha256").update(raw).digest("hex");
    db.prepare(
      "INSERT INTO context_registry(context_id, owner_id, project_label, state, workspace_grant_id, storage_locator, created_at, updated_at)" +
        " VALUES(?,?,?,?,?,?,?,?)",
    ).run("ctx-bench", "owner-bench", "bench", "ACTIVE", "grant-bench", "data/bench", now, now);
    db.prepare(
      "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, worktree_locator, access_mode, grant_version, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run("grant-bench", "ctx-bench", "data/bench", null, "READ_WRITE", 1, now);
    db.prepare(
      "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run("bind-bench", "owner-bench", "ctx-bench", "conn-bench", "principal-bench", boundHash, now);
  db.close();
});

afterEach(() => {
  if (previousDbPath === undefined) delete process.env.HOOSHIX_DB_PATH;
  else process.env.HOOSHIX_DB_PATH = previousDbPath;
  closeAgentDatabase();
  fixture.cleanup();
});

const observe = createRequestObserver({
  resolver: {resolve: resolveContextAsync},
  auditSink: {record: recordControlPlaneAuditFromPort},
});

interface RegimeResult {
  readonly regime: string;
  readonly microsPerRequest: number;
  readonly allowed: boolean;
}

async function timeRegime(mode: "OFF" | "SHADOW" | "PER_CONNECTION", credentialHash: string, iterations: number): Promise<RegimeResult> {
  // Warm the singleton connection and the prepared-statement cache so the
  // measurement is steady-state, not first-touch.
  for (let i = 0; i < 200; i++) {
    const observation = await observe({credentialHash, action: "MCP_REQUEST", traceId: "warm", mode});
    decideEnforcement({mode, resolution: observation.resolution});
  }
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const observation = await observe({credentialHash, action: "MCP_REQUEST", traceId: `bench-${i}`, mode});
    decideEnforcement({mode, resolution: observation.resolution});
  }
  const elapsed = Number(process.hrtime.bigint() - start);
  // One decision per iteration, for the assertion below.
  const final = await observe({credentialHash, action: "MCP_REQUEST", traceId: "final", mode});
  const decision = decideEnforcement({mode, resolution: final.resolution});
  return {
    regime: `${mode}/${credentialHash === boundHash ? "bound" : "unbound"}`,
    microsPerRequest: elapsed / 1000 / iterations,
    allowed: decision.allowed,
  };
}

describe("CI-G9 / before-after benchmark of the isolation request path", () => {
  it("adds a bounded single-digit cost per request and never mis-decides", async () => {
    // Generous on purpose: this is a developer machine under the test runner,
    // so wall-clock varies run to run by a wide margin. The ceiling is here to
    // catch an algorithmic regression — a lookup that degenerates into a scan
    // would blow past it by orders of magnitude — not to chase microseconds.
    // Sub-millisecond overhead per authorised request is imperceptible next to
    // the filesystem, shell and Git work a tool call actually performs.
    const BUDGET_MICROS = 1000;
    const results: RegimeResult[] = [
      await timeRegime("OFF", boundHash, 2000),
      await timeRegime("SHADOW", boundHash, 2000),
      await timeRegime("PER_CONNECTION", boundHash, 2000),
      await timeRegime("PER_CONNECTION", unboundHash, 2000),
    ];

    const report = results
      .map((r) => `${r.regime}: ${r.microsPerRequest.toFixed(1)}µs (allowed=${r.allowed})`)
      .join("\n  ");

    // Correctness first, in every regime:
    //   OFF never resolves, so it allows everything and costs ~nothing.
    //   SHADOW observes only, so it allows even an unbound credential.
    //   PER_CONNECTION allows the bound credential and refuses the unbound one.
    expect(results[0].allowed, report).toBe(true); // OFF/bound
    expect(results[1].allowed, report).toBe(true); // SHADOW/bound
    expect(results[2].allowed, report).toBe(true); // PER_CONNECTION/bound
    expect(results[3].allowed, report).toBe(false); // PER_CONNECTION/unbound

    for (const result of results) {
      expect(result.microsPerRequest, report).toBeLessThan(BUDGET_MICROS);
    }

    // Record the numbers for the delivery document.
    console.log(`\n  CI-G9 isolation-path benchmark (µs/request):\n  ${report}`);
  }, 120_000);
});
