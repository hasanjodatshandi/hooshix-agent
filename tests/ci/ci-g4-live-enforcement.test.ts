import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createDisposableFixture, reserveEphemeralLoopbackPort } from "../helpers/r0-disposable-fixtures.js";
import Database from "better-sqlite3";

/**
 * CI-G4 — PER_CONNECTION enforcement, end to end on a live server.
 *
 * CI-G3 proved the wiring resolves and audits; CI-G4 is the first time the
 * policy actually refuses traffic. Three behaviours are pinned here, on a real
 * HTTP server with a real SQLite control plane:
 *
 *   1. PER_CONNECTION still serves a credential that resolves — the legacy
 *      operator token is pinned to the legacy Context, so live credentials keep
 *      working when the flag flips (ADR-CI-007).
 *   2. PER_CONNECTION REFUSES a credential with no binding: a token issued to a
 *      non-legacy principal never gets pinned, so it resolves UNBOUND and the
 *      request dies at the edge with a 403 and a stable sentinel — before any
 *      session, tool or filesystem work.
 *   3. SHADOW still serves that same unbound credential — proving the refusal is
 *      enforcement, not resolution, and the DENY is only audited there.
 *
 * The unbound credential is a real, valid OAuth access token (it verifies) whose
 * principal is not "operator", so `pinLegacyContext` intentionally never binds
 * it. That is exactly the post-CI world the flag exists for.
 */
async function withIsolationServer(
  mode: string,
  block: (base: string, sqlitePath: string, bootstrap: string) => Promise<void>,
): Promise<void> {
  const fixture = createDisposableFixture(`ci-g4-${mode.toLowerCase().replace("_","-")}`);
  const lease = await reserveEphemeralLoopbackPort();
  const port = lease.port;
  await lease.close();
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, "ci-g4-runner.mts");
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
    CTX_ISOLATION_MODE: mode,
  };
  const child: ChildProcess = spawn(process.execPath, ["--import", loader, runner], {
    cwd: fixture.root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 75; attempt++) {
      try { if ((await fetch(base + "/health/live")).status === 200) { ready = true; break; } } catch { /* booting */ }
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

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

async function obtainToken(base: string, resource: string, bootstrap: string): Promise<string> {
  const { verifier, challenge } = pkce();
  const redirect = "http://127.0.0.1:49994/callback";
  const registration = await fetch(base + "/oauth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirect] }),
  });
  expect(registration.status).toBe(201);
  const clientId = (await registration.json() as { client_id: string }).client_id;
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
  return (await exchange.json() as { access_token: string }).access_token;
}

/**
 * Mint a real, verifying OAuth access token whose principal is NOT the legacy
 * "operator". It authenticates fine, but pinLegacyContext only binds legacy
 * principal tokens, so this credential has no Context binding at all.
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
      tokenHash,
      "principal-post-ci-connection",
      "client-post-ci",
      resource,
      JSON.stringify(["hooshix:read"]),
      "family-post-ci-" + crypto.randomBytes(8).toString("hex"),
      Date.now(),
      Date.now() + 3_600_000,
    );
  } finally {
    db.close();
  }
  return raw;
}

/**
 * Seed a PRE-CI legacy credential: a real, verifying token whose principal is
 * exactly "operator" and which has no Context binding yet — the shape of every
 * token minted before the CI flag existed. `pinLegacyContext` binds these to the
 * shared legacy Context, so they must keep serving under enforcement
 * (ADR-CI-007). This is distinct from a NEW connection, which now provisions its
 * own Context at issuance.
 */
function issueLegacyOperatorToken(sqlitePath: string, resource: string): string {
  const raw = "hx_" + crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const db = new Database(sqlitePath);
  try {
    db.prepare(
      "INSERT INTO oauth_access_tokens" +
        " (token_hash,principal_id,client_id,resource,scopes_json,family_id,issued_at,expires_at)" +
        " VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      tokenHash,
      "operator",
      "client-legacy",
      resource,
      JSON.stringify(["hooshix:read"]),
      "family-legacy-" + crypto.randomBytes(8).toString("hex"),
      Date.now(),
      Date.now() + 3_600_000,
    );
  } finally {
    db.close();
  }
  return raw;
}

async function mcpInitialize(base: string, resource: string, accessToken: string): Promise<void> {
  const client = new Client({ name: "ci-g4-enforcement", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: "Bearer " + accessToken } },
  });
  try {
    await client.connect(transport);
  } finally {
    await client.close();
  }
}

describe("CI-G4 / PER_CONNECTION enforcement on the live path", () => {
  it("still serves a PRE-EXISTING legacy operator credential via the pinned legacy Context (ADR-CI-007)", async () => {
    await withIsolationServer("PER_CONNECTION", async (base, sqlitePath, bootstrap) => {
      void bootstrap;
      const resource = base + "/mcp";
      // A pre-CI token: principal "operator", no Context binding. pinLegacyContext
      // must attach it to the shared legacy Context so flipping the flag on does
      // not invalidate live credentials.
      const legacyToken = issueLegacyOperatorToken(sqlitePath, resource);

      await expect(mcpInitialize(base, resource, legacyToken)).resolves.toBeUndefined();

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const audits = db
          .prepare("SELECT action, decision, context_id FROM security_audit ORDER BY id")
          .all() as Array<{ action: string; decision: string; context_id: string }>;
        const requestAudit = audits.find((row) => row.action === "MCP_REQUEST");
        expect(requestAudit, JSON.stringify(audits)).toBeDefined();
        expect(requestAudit!.decision).toBe("ALLOW");
        expect(requestAudit!.context_id).toBe("ctx-legacy-shared-operator");
      } finally {
        db.close();
      }
    });
  }, 30_000);

  it("mints a distinct, non-legacy Context for each NEW OAuth connection under PER_CONNECTION (CI-G7b)", async () => {
    await withIsolationServer("PER_CONNECTION", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      // Two connectors authorize through the live OAuth path. Each must now
      // provision its OWN Context — not collapse onto the legacy one — which is
      // exactly the per-connection issuance that the CI-G7b host test found missing.
      const tok1 = await obtainToken(base, resource, bootstrap);
      const tok2 = await obtainToken(base, resource, bootstrap);
      await expect(mcpInitialize(base, resource, tok1)).resolves.toBeUndefined();
      await expect(mcpInitialize(base, resource, tok2)).resolves.toBeUndefined();

      const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
      const db = new Database(sqlitePath, { readonly: true });
      try {
        const getCtx = (tokenHash: string) =>
          db
            .prepare("SELECT context_id FROM context_binding WHERE credential_hash=?")
            .get(tokenHash) as { context_id: string } | undefined;
        const c1 = getCtx(hash(tok1));
        const c2 = getCtx(hash(tok2));
        expect(c1, "connection 1 has no provisioned Context").toBeDefined();
        expect(c2, "connection 2 has no provisioned Context").toBeDefined();
        expect(c1!.context_id).not.toBe("ctx-legacy-shared-operator");
        expect(c1!.context_id).not.toBe(c2!.context_id);
      } finally {
        db.close();
      }
    });
  }, 30_000);

  it("refuses an unbound credential with a 403 and a stable sentinel under PER_CONNECTION", async () => {
    await withIsolationServer("PER_CONNECTION", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      // Silence "unused variable" while keeping the fixture's bootstrap contract explicit.
      void bootstrap;
      const unbound = issueUnboundToken(sqlitePath, resource);

      const response = await fetch(resource, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          authorization: "Bearer " + unbound,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });

      // The request dies at the edge, before any session or tool work.
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string; reason: string };
      expect(body.error).toBe("context_denied");
      expect(body.reason).toBe("context_not_bound");
      // No existence oracle: the body carries no Context, binding or path.
      expect(JSON.stringify(body)).not.toMatch(/ctx-|bind-|conn-[0-9a-f]/);

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const audits = db
          .prepare("SELECT action, decision, context_id, binding_id FROM security_audit ORDER BY id")
          .all() as Array<{ action: string; decision: string; context_id: string | null; binding_id: string | null }>;
        const denial = audits.find((row) => row.action === "MCP_REQUEST" && row.decision === "DENY");
        // The refusal is audited with no Context attached — exactly the SHADOW
        // record shape, so the operator reads one continuous history.
        expect(denial, JSON.stringify(audits)).toBeDefined();
        expect(denial!.context_id).toBeNull();
        expect(denial!.binding_id).toBeNull();
      } finally {
        db.close();
      }
    });
  }, 30_000);

  it("still serves an unbound credential under SHADOW — refusal is enforcement, not resolution", async () => {
    await withIsolationServer("SHADOW", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      void bootstrap;
      const unbound = issueUnboundToken(sqlitePath, resource);

      // SHADOW observes only: the same unbound credential authenticates and the
      // request proceeds, with the DENY recorded for the operator.
      await expect(mcpInitialize(base, resource, unbound)).resolves.toBeUndefined();

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const audits = db
          .prepare("SELECT action, decision FROM security_audit ORDER BY id")
          .all() as Array<{ action: string; decision: string }>;
        const requestAudit = audits.find((row) => row.action === "MCP_REQUEST");
        expect(requestAudit, JSON.stringify(audits)).toBeDefined();
        expect(requestAudit!.decision).toBe("DENY");
      } finally {
        db.close();
      }
    });
  }, 30_000);
});
