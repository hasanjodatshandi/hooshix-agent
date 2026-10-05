import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe, expect, it} from "vitest";
import {createDisposableFixture, reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";
import Database from "better-sqlite3";

/**
 * CI-G6b — the Owner Console over a live server.
 *
 * The gate's contract, pinned against a real HTTP server with a real SQLite
 * control plane:
 *
 *   1. `/admin/login` reauthenticates with the bootstrap secret and issues a
 *      SEPARATE session cookie (`hx_admin`) with a CSRF secret.
 *   2. Every mutating route requires the cookie AND the CSRF secret AND a
 *      same-site Origin; missing any one is a 401/403 with a stable sentinel.
 *   3. The full transfer protocol runs over HTTP — prepare → approve → commit —
 *      and the commit leaves the lease on the destination binding with a
 *      bumped epoch, which is exactly what CI-G5 needs to fence the old chat.
 *   4. The one-time ticket is never persisted; replaying it is refused.
 *   5. The endpoints are reachable ONLY under `/admin/` — no MCP tool can
 *      transfer ownership (the model never receives this surface).
 */

const CONTEXT_A = "ctx-gate-a";
const BINDING_A = "binding-gate-a";
const BINDING_B = "binding-gate-b";
const TARGET_CONNECTION = "conn-operator-gate";
const OWNER_ID = "owner-gate";

async function withIsolationServer(
  block: (base: string, sqlitePath: string, bootstrap: string) => Promise<void>,
): Promise<void> {
  const fixture = createDisposableFixture("ci-g6b");
  const lease = await reserveEphemeralLoopbackPort();
  const port = lease.port;
  await lease.close();
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, "ci-g6b-runner.mts");
  fs.writeFileSync(
    runner,
    `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo, "src/mcp/http-server.ts")).href)};await startHttpServer();`,
  );
  const loader = pathToFileURL(path.join(repo, "node_modules/tsx/dist/loader.mjs")).href;
  const bootstrap = "bootstrap-" + crypto.randomBytes(32).toString("base64url");
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
    CTX_ISOLATION_MODE: "PER_CONNECTION",
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
    await block(base, fixture.sqlitePath, bootstrap);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      child.kill();
      await closed;
    }
    fixture.cleanup();
  }
}

/** Seed a Context, two bindings and a live lease directly in the control plane. */
function seedControlPlane(sqlitePath: string): void {
  const now = new Date().toISOString();
  const db = new Database(sqlitePath);
  try {
    db.prepare(
      "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(CONTEXT_A, OWNER_ID, "p", `grant-${CONTEXT_A}`, `data/contexts/${CONTEXT_A}`, now, now);
    db.prepare(
      "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(BINDING_A, OWNER_ID, CONTEXT_A, `conn-${BINDING_A}`, "principal-A", `sha256:${BINDING_A}`, now);
    db.prepare(
      "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(BINDING_B, OWNER_ID, CONTEXT_A, TARGET_CONNECTION, "principal-B", `sha256:${BINDING_B}`, now);
    db.prepare(
      "INSERT INTO ownership_lease(context_id, owner_binding_id, context_epoch, lease_deadline_ms, fencing_token, updated_at)" +
        " VALUES(?,?,1,?,?,?)",
    ).run(CONTEXT_A, BINDING_A, Date.now() + 3_600_000, crypto.randomUUID(), now);
  } finally {
    db.close();
  }
}

function readLease(sqlitePath: string) {
  const db = new Database(sqlitePath, {readonly: true});
  try {
    return db
      .prepare(
        "SELECT owner_binding_id, context_epoch FROM ownership_lease WHERE context_id=?",
      )
      .get(CONTEXT_A) as {owner_binding_id: string; context_epoch: number} | undefined;
  } finally {
    db.close();
  }
}

function readIntent(sqlitePath: string, intentId: string) {
  const db = new Database(sqlitePath, {readonly: true});
  try {
    return db
      .prepare("SELECT state, ticket_hash FROM handoff_intent WHERE intent_id=?")
      .get(intentId) as {state: string; ticket_hash: string} | undefined;
  } finally {
    db.close();
  }
}

/** Extract the `hx_admin=...` cookie value from a Set-Cookie header. */
function adminCookieFrom(setCookie: string | null): string {
  expect(setCookie).toContain("hx_admin=");
  return (setCookie!.split(";")[0] ?? "").split("=").slice(1).join("=");
}

/** Parse the CSRF secret out of a login response body. */
async function adminCsrfFrom(response: Response): Promise<string> {
  const body = (await response.json()) as {csrf: string};
  expect(body.csrf).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  return body.csrf;
}

describe("CI-G6b / Owner Console on a live server", () => {
  it("reauthenticates the owner and issues a separate admin session", async () => {
    await withIsolationServer(async (base, _sqlitePath, bootstrap) => {
      const response = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: bootstrap}).toString(),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("hx_admin=");
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
      await adminCsrfFrom(response);
    });
  }, 30_000);

  it("refuses a wrong owner secret", async () => {
    await withIsolationServer(async (base) => {
      const response = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: "definitely-not-the-secret"}).toString(),
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as {error: string}).error).toBe("invalid_operator_secret");
    });
  }, 30_000);

  it("refuses admin mutations without a session, without CSRF, and cross-origin", async () => {
    await withIsolationServer(async (base) => {
      // No cookie at all → 401.
      const noSession = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({sourceContextId: CONTEXT_A}).toString(),
      });
      expect(noSession.status).toBe(401);

      // A cross-site Origin is refused before any session work.
      const crossOrigin = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.com",
        },
        body: new URLSearchParams({sourceContextId: CONTEXT_A}).toString(),
      });
      expect(crossOrigin.status).toBe(403);
      // The global Origin check in handleRequest fires before the admin gate,
      // so this is the outer CSRF layer, not the session layer.
      expect(((await crossOrigin.json()) as {error: string}).error).toBe("origin_not_allowed");
    });
  }, 30_000);

  it("runs the full two-phase transfer over HTTP and rebinds the lease", async () => {
    await withIsolationServer(async (base, sqlitePath, bootstrap) => {
      seedControlPlane(sqlitePath);
      expect(readLease(sqlitePath)).toEqual({owner_binding_id: BINDING_A, context_epoch: 1});

      // --- login (reauth) ---
      const login = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: bootstrap}).toString(),
      });
      expect(login.status).toBe(200);
      const cookie = adminCookieFrom(login.headers.get("set-cookie"));
      const csrf = await adminCsrfFrom(login);
      const cookieHeader = `hx_admin=${cookie}`;
      const form = (extra: Record<string, string>) =>
        new URLSearchParams({csrf, ...extra}).toString();
      const headers = {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader,
      };

      // --- phase 1: prepare ---
      const prepared = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers,
        body: form({
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
          kind: "TRANSFER",
        }),
      });
      expect(prepared.status).toBe(200);
      const preparedBody = (await prepared.json()) as {
        intentId: string;
        ticket: string;
        kind: string;
        expiresAt: string;
      };
      expect(preparedBody.ticket).toMatch(/^hxbi_/);
      expect(preparedBody.kind).toBe("TRANSFER");
      expect(preparedBody.intentId).toBeTruthy();

      // Only the hash is ever persisted.
      const seeded = readIntent(sqlitePath, preparedBody.intentId);
      expect(seeded).toBeDefined();
      expect(seeded!.state).toBe("PREPARED");
      expect(seeded!.ticket_hash).not.toContain(preparedBody.ticket);

      // --- phase 2a: approve ---
      const approved = await fetch(base + "/admin/transfer/approve", {
        method: "POST",
        headers,
        body: form({
          intentId: preparedBody.intentId,
          ticket: preparedBody.ticket,
          ownerId: OWNER_ID,
        }),
      });
      expect(approved.status).toBe(200);
      expect(((await approved.json()) as {state: string}).state).toBe("APPROVED");

      // --- phase 2b: commit ---
      const committed = await fetch(base + "/admin/transfer/commit", {
        method: "POST",
        headers,
        body: form({intentId: preparedBody.intentId, newBindingId: BINDING_B}),
      });
      expect(committed.status).toBe(200);
      expect(((await committed.json()) as {state: string}).state).toBe("COMMITTED");

      // The lease moved to the destination and the epoch bumped — this is the
      // state CI-G5's fence reads to deny the old chat.
      expect(readLease(sqlitePath)).toEqual({owner_binding_id: BINDING_B, context_epoch: 2});
      expect(readIntent(sqlitePath, preparedBody.intentId)!.state).toBe("COMMITTED");

      // The Context landed back ACTIVE (never left TRANSFERRING on disk).
      const db = new Database(sqlitePath, {readonly: true});
      try {
        const ctx = db
          .prepare("SELECT state FROM context_registry WHERE context_id=?")
          .get(CONTEXT_A) as {state: string};
        expect(ctx.state).toBe("ACTIVE");
      } finally {
        db.close();
      }
    });
  }, 45_000);

  it("refuses a replayed one-time ticket", async () => {
    await withIsolationServer(async (base, sqlitePath, bootstrap) => {
      seedControlPlane(sqlitePath);
      const login = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: bootstrap}).toString(),
      });
      const cookie = adminCookieFrom(login.headers.get("set-cookie"));
      const csrf = await adminCsrfFrom(login);
      const headers = {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `hx_admin=${cookie}`,
      };
      const form = (extra: Record<string, string>) =>
        new URLSearchParams({csrf, ...extra}).toString();

      const prepared = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers,
        body: form({
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
          kind: "TRANSFER",
        }),
      });
      const preparedBody = (await prepared.json()) as {intentId: string; ticket: string};

      const first = await fetch(base + "/admin/transfer/approve", {
        method: "POST",
        headers,
        body: form({intentId: preparedBody.intentId, ticket: preparedBody.ticket, ownerId: OWNER_ID}),
      });
      expect(first.status).toBe(200);

      // Replay the same ticket: the intent is no longer PREPARED, so the CAS
      // touches zero rows and the approve is refused.
      const replay = await fetch(base + "/admin/transfer/approve", {
        method: "POST",
        headers,
        body: form({intentId: preparedBody.intentId, ticket: preparedBody.ticket, ownerId: OWNER_ID}),
      });
      expect(replay.status).toBe(409);
      expect(((await replay.json()) as {error: string}).error).toBe("CONTEXT_INACTIVE");
    });
  }, 45_000);

  it("refuses mutations whose CSRF secret is wrong", async () => {
    await withIsolationServer(async (base, sqlitePath, bootstrap) => {
      seedControlPlane(sqlitePath);
      const login = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: bootstrap}).toString(),
      });
      const cookie = adminCookieFrom(login.headers.get("set-cookie"));

      const bad = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `hx_admin=${cookie}`,
        },
        body: new URLSearchParams({
          csrf: "not-the-csrf-secret",
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
          kind: "TRANSFER",
        }).toString(),
      });
      expect(bad.status).toBe(403);
      expect(((await bad.json()) as {error: string}).error).toBe("invalid_csrf");
      // Nothing was created.
      const db = new Database(sqlitePath, {readonly: true});
      try {
        const count = db
          .prepare("SELECT COUNT(*) AS n FROM handoff_intent")
          .get() as {n: number};
        expect(count.n).toBe(0);
      } finally {
        db.close();
      }
    });
  }, 45_000);

  it("inspects an intent read-only through the cookie session", async () => {
    await withIsolationServer(async (base, sqlitePath, bootstrap) => {
      seedControlPlane(sqlitePath);
      const login = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: bootstrap}).toString(),
      });
      const cookie = adminCookieFrom(login.headers.get("set-cookie"));
      const csrf = await adminCsrfFrom(login);
      const headers = {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `hx_admin=${cookie}`,
      };
      const form = (extra: Record<string, string>) =>
        new URLSearchParams({csrf, ...extra}).toString();

      const prepared = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers,
        body: form({
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
          kind: "TRANSFER",
        }),
      });
      const intentId = ((await prepared.json()) as {intentId: string}).intentId;

      // GET is cookie-only; no CSRF field needed (same discipline as /metrics).
      const inspection = await fetch(base + "/admin/transfer/" + intentId, {
        headers: {cookie: `hx_admin=${cookie}`},
      });
      expect(inspection.status).toBe(200);
      const body = (await inspection.json()) as {
        intent: {id: string; state: string; ticketHash?: string};
      };
      expect(body.intent.id).toBe(intentId);
      expect(body.intent.state).toBe("PREPARED");
      // The ticket hash is never echoed to a browser surface.
      expect(body.intent.ticketHash).toBeUndefined();

      // An unknown intent is 404, and the body carries no Context detail.
      const missing = await fetch(base + "/admin/transfer/nope", {
        headers: {cookie: `hx_admin=${cookie}`},
      });
      expect(missing.status).toBe(404);
    });
  }, 45_000);

  it("denies the admin surface to a plain operator cookie", async () => {
    await withIsolationServer(async (base, sqlitePath, bootstrap) => {
      seedControlPlane(sqlitePath);
      // Log into the OPERATOR console, which issues hx_operator — not hx_admin.
      const operatorLogin = await fetch(base + "/operator/login", {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({secret: bootstrap}).toString(),
        redirect: "manual",
      });
      expect(operatorLogin.status).toBe(303);
      const operatorCookie = operatorLogin.headers.get("set-cookie") ?? "";
      expect(operatorCookie).toContain("hx_operator=");

      const attempted = await fetch(base + "/admin/transfer/prepare", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: operatorCookie.split(";")[0]!,
        },
        body: new URLSearchParams({
          csrf: "anything",
          sourceContextId: CONTEXT_A,
          sourceBindingId: BINDING_A,
          targetConnectionId: TARGET_CONNECTION,
        }).toString(),
      });
      expect(attempted.status).toBe(401);
      expect(((await attempted.json()) as {error: string}).error).toBe("invalid_admin_session");
    });
  }, 45_000);
});
