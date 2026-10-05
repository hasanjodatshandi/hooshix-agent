import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {describe, expect, it} from "vitest";
import {createDisposableFixture, reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";
import Database from "better-sqlite3";

/**
 * CI-G8 — rollback rehearsal (gate: "rollback اجرا و تأییدشده").
 *
 * CI-G8 is an operational gate, not a code gate: the SHADOW mode wiring has
 * existed since CI-G3 and the flag has four states. What the gate demands is
 * PROOF that a staged rollout can be walked back. This suite is that proof,
 * run against a real server with a real control plane.
 *
 * The rehearsal is a single non-sensitive project carried through the whole
 * cycle on one database:
 *
 *   OFF  → SHADOW        (observe only: traffic still flows, audit history starts)
 *   SHADOW → PER_CONNECTION (enforce: unbound traffic now dies at the edge)
 *   PER_CONNECTION → OFF  (ROLLBACK: bound and unbound both flow again)
 *   OFF → SHADOW again    (re-enroll: the audit history from the first pass is
 *                          still intact and continuous)
 *
 * What must NOT happen anywhere in the cycle:
 *   - a live credential ever stops working (ADR-CI-007)
 *   - a row written in one state becomes unreadable in another
 *   - the audit history loses continuity
 *   - the mode change touches any application data
 *
 * The mode is a process env var, not a persisted setting, so a rollback is a
 * restart — nothing is written that has to be undone. That is the property
 * this rehearsal pins.
 */

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return {verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url")};
};

async function obtainToken(base: string, resource: string, bootstrap: string): Promise<string> {
  const {verifier, challenge} = pkce();
  const redirect = "http://127.0.0.1:49996/callback";
  const registration = await fetch(base + "/oauth/register", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({redirect_uris: [redirect]}),
  });
  expect(registration.status).toBe(201);
  const clientId = (await registration.json() as {client_id: string}).client_id;
  const auth = await fetch(base + "/oauth/authorize", {
    method: "POST",
    body: new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirect,
      resource, scope: "offline_access hooshix:read",
      code_challenge: challenge, code_challenge_method: "S256", pin: bootstrap,
    }),
    redirect: "manual",
  });
  expect(auth.status).toBe(302);
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const exchange = await fetch(base + "/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier,
      redirect_uri: redirect, client_id: clientId, resource,
    }),
  });
  expect(exchange.status).toBe(200);
  return (await exchange.json() as {access_token: string}).access_token;
}

/**
 * Mint a real, verifying OAuth token whose principal is NOT the legacy
 * "operator" — the post-CI credential shape. Under PER_CONNECTION it has no
 * Context binding and is refused at the edge; under SHADOW/OFF it flows.
 */
function issueUnboundToken(sqlitePath: string, resource: string): string {
  const raw = "hx_" + crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const db = new Database(sqlitePath);
  try {
    db.prepare(
      "INSERT INTO oauth_access_tokens" +
        " (token_hash,principal_id,client_id,resource,scopes_json,family_id,issued_at,expires_at)" +
        " VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      tokenHash, "principal-rehearsal", "client-rehearsal", resource,
      JSON.stringify(["hooshix:read"]),
      "family-rehearsal-" + crypto.randomBytes(8).toString("hex"),
      Date.now(), Date.now() + 3_600_000,
    );
  } finally {
    db.close();
  }
  return raw;
}

async function mcpInitialize(base: string, resource: string, accessToken: string): Promise<void> {
  const client = new Client({name: "ci-g8-rehearsal", version: "1"}, {versionNegotiation: {mode: {pin: "2026-07-28"}}});
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: {headers: {Authorization: "Bearer " + accessToken}},
  });
  try {
    await client.connect(transport);
  } finally {
    await client.close();
  }
}

async function expectRefused(resource: string, accessToken: string): Promise<void> {
  const response = await fetch(resource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "initialize", params: {}}),
  });
  expect(response.status).toBe(403);
  const body = (await response.json()) as {error: string; reason: string};
  expect(body.error).toBe("context_denied");
  expect(body.reason).toBe("context_not_bound");
}

function readAudits(sqlitePath: string): Array<{action: string; decision: string}> {
  const db = new Database(sqlitePath, {readonly: true});
  try {
    return db
      .prepare("SELECT action, decision FROM security_audit ORDER BY id")
      .all() as Array<{action: string; decision: string}>;
  } finally {
    db.close();
  }
}

/**
 * One process in one mode. The fixture is shared across the whole rehearsal so
 * the database, and everything written to it, survives every restart.
 */
async function runPhase(
  fixture: {root: string; sqlitePath: string},
  port: number,
  mode: string,
  bootstrap: string,
  phase: (base: string, sqlitePath: string, bootstrap: string) => Promise<void>,
): Promise<void> {
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, `ci-g8-${mode.toLowerCase()}.mts`);
  fs.writeFileSync(
    runner,
    `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo, "src/mcp/http-server.ts")).href)};await startHttpServer();`,
  );
  const loader = pathToFileURL(path.join(repo, "node_modules/tsx/dist/loader.mjs")).href;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOOSHIX_HTTP_PORT: undefined, HOOSHIX_HTTP_HOST: undefined,
    HOOSHIX_PUBLIC_BASE_URL: undefined, HOOSHIX_ALLOWED_ORIGINS: undefined,
    HOOSHIX_BOOTSTRAP_TOKEN: bootstrap,
    MCP_ACCESS_TOKEN: undefined, MCP_API_KEY: undefined,
    MCP_PORT: String(port), MCP_PUBLIC_BASE_URL: base, MCP_BIND_HOST: "127.0.0.1",
    HOOSHIX_WORKSPACE: fixture.root, HOOSHIX_DB_PATH: fixture.sqlitePath,
    HOOSHIX_LOG_DIR: path.join(fixture.root, "logs"),
    HOOSHIX_PERMISSION_LEVEL: "READ_ONLY",
    CTX_ISOLATION_MODE: mode,
  };
  const child: ChildProcess = spawn(process.execPath, ["--import", loader, runner], {
    cwd: fixture.root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 75; attempt++) {
      try {
        if ((await fetch(base + "/health/live")).status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* booting */
      }
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(ready, stderr).toBe(true);
    await phase(base, fixture.sqlitePath, bootstrap);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      child.kill();
      await closed;
    }
  }
}

describe("CI-G8 / rollback rehearsal on one non-sensitive project", () => {
  it("carries a project through OFF → SHADOW → PER_CONNECTION → OFF → SHADOW with no data loss", async () => {
    const fixture = createDisposableFixture("ci-g8-rehearsal");
    const lease = await reserveEphemeralLoopbackPort();
    const port = lease.port;
    await lease.close();
    const bootstrap = "bootstrap-" + crypto.randomBytes(32).toString("base64url");
    try {
      // ── Phase 1: OFF — the project starts isolated-off, as production is today.
      // A live credential is granted here; it must keep working for the whole cycle.
      let liveCredential = "";
      await runPhase(fixture, port, "OFF", bootstrap, async (base) => {
        const resource = base + "/mcp";
        liveCredential = await obtainToken(base, resource, bootstrap);
        await expect(mcpInitialize(base, resource, liveCredential)).resolves.toBeUndefined();
      });

      // ── Phase 2: SHADOW — observe only. The unbound credential flows, but the
      // DENY is now recorded, and the live credential never skips a beat.
      await runPhase(fixture, port, "SHADOW", bootstrap, async (base, sqlitePath) => {
        const resource = base + "/mcp";
        const unbound = issueUnboundToken(sqlitePath, resource);
        // Live traffic still served.
        await expect(mcpInitialize(base, resource, liveCredential)).resolves.toBeUndefined();
        // Unbound traffic ALSO served — SHADOW observes, never enforces.
        await expect(mcpInitialize(base, resource, unbound)).resolves.toBeUndefined();
        const audits = readAudits(sqlitePath);
        const denies = audits.filter((row) => row.decision === "DENY");
        expect(denies, JSON.stringify(audits)).not.toHaveLength(0);
      });

      // ── Phase 3: PER_CONNECTION — cutover. Unbound traffic now dies at the
      // edge with the stable sentinel; the live credential is unaffected.
      await runPhase(fixture, port, "PER_CONNECTION", bootstrap, async (base, sqlitePath) => {
        const resource = base + "/mcp";
        const unbound = issueUnboundToken(sqlitePath, resource);
        await expect(mcpInitialize(base, resource, liveCredential)).resolves.toBeUndefined();
        await expectRefused(resource, unbound);
      });

      // ── Phase 4: ROLLBACK to OFF. This is the move the gate is about. The
      // mode is a process env var, so rollback is a restart — nothing written
      // under enforcement has to be undone. Unbound traffic flows again and the
      // live credential still works.
      await runPhase(fixture, port, "OFF", bootstrap, async (base, sqlitePath) => {
        const resource = base + "/mcp";
        const unbound = issueUnboundToken(sqlitePath, resource);
        await expect(mcpInitialize(base, resource, liveCredential)).resolves.toBeUndefined();
        await expect(mcpInitialize(base, resource, unbound)).resolves.toBeUndefined();
      });

      // ── Phase 5: re-enroll in SHADOW. The audit history written in phases 2
      // and 3 is still there, still readable, still continuous — rollback did
      // not erase the observation record.
      await runPhase(fixture, port, "SHADOW", bootstrap, async (base, sqlitePath) => {
        const resource = base + "/mcp";
        await expect(mcpInitialize(base, resource, liveCredential)).resolves.toBeUndefined();
        const audits = readAudits(sqlitePath);
        // History from the earlier SHADOW pass survived the full cycle.
        const shadowDenies = audits.filter((row) => row.action === "MCP_REQUEST" && row.decision === "DENY");
        expect(shadowDenies, JSON.stringify(audits)).not.toHaveLength(0);
        // And the live credential's ALLOWs are a continuous thread.
        const allows = audits.filter((row) => row.decision === "ALLOW");
        expect(allows, JSON.stringify(audits)).not.toHaveLength(0);
      });
    } finally {
      fixture.cleanup();
    }
  }, 240_000);

  it("rejects an unknown mode loudly instead of silently degrading to a stricter one", async () => {
    const fixture = createDisposableFixture("ci-g8-bad-mode");
    const lease = await reserveEphemeralLoopbackPort();
    const port = lease.port;
    await lease.close();
    const bootstrap = "bootstrap-" + crypto.randomBytes(32).toString("base64url");
    // A typo must never accidentally enable isolation (or accidentally disable
    // it) — parseCiIsolationMode throws before the server can boot.
    await expect(
      runPhase(fixture, port, "SHADWO", bootstrap, async () => {
        /* unreachable */
      }),
    ).rejects.toThrow(/CTX_ISOLATION_MODE/);
    fixture.cleanup();
  }, 60_000);
});
