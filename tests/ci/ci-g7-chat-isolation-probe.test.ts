import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe, expect, it} from "vitest";
import {createDisposableFixture, reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Database from "better-sqlite3";

/**
 * CI-G7 — ChatGPT real-connection gate, server-side instrument.
 *
 * The gate's definitive question (CIG0 §1): does the server see a distinct,
 * verifiable identity for chat A and chat B? CI-2 made the server issue
 * distinct principals; this leaf answers whether two REAL connections — two
 * independently registered OAuth clients, each granted its own token — resolve
 * to two distinct Contexts, with 100% request-context match.
 *
 * The `chat_isolation_probe` tool (CIG0 §5) is the evidence instrument: it
 * reports pseudonyms, never raw ids, so an operator eyeballing two probe
 * outputs can tell "same connection / different Context" without the server
 * ever disclosing which Context, connection or principal is involved.
 *
 * What this suite can settle server-side, and what it cannot:
 *
 *   - CAN: that two independently-issued tokens resolve to two Contexts, that
 *     the probe reports DIFFERENT pseudonyms for them, that each request's
 *     resolution matches its own token, and that the probe leaks no raw
 *     identity (the disclosure discipline of design 03 §4 / threat T07).
 *   - CANNOT: whether the ChatGPT product lets a user pick a different
 *     connection per chat, or hands over a signed conversation claim. That is
 *     the host test in the CI-G7 checklist and is recorded by the owner, not by
 *     this suite — the outcome register below is what the owner fills in.
 */

async function withIsolationServer(
  mode: string,
  block: (base: string, sqlitePath: string, bootstrap: string) => Promise<void>,
): Promise<void> {
  const fixture = createDisposableFixture(`ci-g7-${mode.toLowerCase().replace("_", "-")}`);
  const lease = await reserveEphemeralLoopbackPort();
  const port = lease.port;
  await lease.close();
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, "ci-g7-runner.mts");
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

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return {verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url")};
};

/** Register an OAuth client and exchange a full grant for a live access token. */
async function obtainToken(base: string, resource: string, bootstrap: string): Promise<string> {
  const {verifier, challenge} = pkce();
  const redirect = "http://127.0.0.1:49995/callback";
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
 * Mint a real, verifying OAuth token bound to a DISTINCT principal, and bind it
 * to a fresh Context with its own binding and grant — the post-CI-2 shape a
 * second chat's connection would have.
 */
function bindTokenToContext(
  sqlitePath: string,
  resource: string,
  principalId: string,
  contextId: string,
  bindingId: string,
  grantId: string,
): string {
  const raw = "hx_" + crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const now = new Date().toISOString();
  const db = new Database(sqlitePath);
  try {
    db.prepare(
      "INSERT INTO oauth_access_tokens" +
        " (token_hash,principal_id,client_id,resource,scopes_json,family_id,issued_at,expires_at)" +
        " VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      tokenHash, principalId, `client-${principalId}`, resource,
      JSON.stringify(["hooshix:read"]),
      `family-${principalId}-${crypto.randomBytes(8).toString("hex")}`,
      Date.now(), Date.now() + 3_600_000,
    );
    db.prepare(
      "INSERT INTO context_registry(context_id, owner_id, project_label, workspace_grant_id, storage_locator, created_at, updated_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(contextId, `owner-${contextId}`, "p", grantId, `data/contexts/${contextId}`, now, now);
    db.prepare(
      "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, worktree_locator, access_mode, grant_version, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(grantId, contextId, `data/contexts/${contextId}`, null, "READ_WRITE", 1, now);
    db.prepare(
      "INSERT INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, created_at)" +
        " VALUES(?,?,?,?,?,?,?)",
    ).run(bindingId, `owner-${contextId}`, contextId, `conn-${bindingId}`, principalId, tokenHash, now);
  } finally {
    db.close();
  }
  return raw;
}

/** Call the read-only probe through the modern MCP endpoint. */
async function callProbe(base: string, resource: string, accessToken: string): Promise<Record<string, unknown>> {
  const client = new Client({ name: "ci-g7-probe", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: "Bearer " + accessToken } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "chat_isolation_probe", arguments: {} });
    const text = result.content?.[0]?.text;
    expect(text, JSON.stringify(result)).toBeDefined();
    return JSON.parse(text!) as Record<string, unknown>;
  } finally {
    await client.close();
  }
}

describe("CI-G7 / chat_isolation_probe on a live server", () => {
  it("reports DISTINCT Context pseudonyms for two independently bound connections", async () => {
    await withIsolationServer("PER_CONNECTION", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      // Two chats = two connections = two principals, each with its own token,
      // Context, binding and grant. Nothing is shared except the server.
      const tokenA = bindTokenToContext(
        sqlitePath, resource, "principal-chat-a", "ctx-chat-a", "bind-chat-a", "grant-chat-a",
      );
      const tokenB = bindTokenToContext(
        sqlitePath, resource, "principal-chat-b", "ctx-chat-b", "bind-chat-b", "grant-chat-b",
      );

      const probeA = await callProbe(base, resource, tokenA);
      const probeB = await callProbe(base, resource, tokenB);

      // Both requests resolved — the gate requires 100% request-context match.
      expect(probeA.bind_state).toBe("RESOLVED");
      expect(probeB.bind_state).toBe("RESOLVED");

      // Two DIFFERENT connections: the connection pseudonyms differ.
      expect(probeA.bound_connection_pseudonym).not.toBe(probeB.bound_connection_pseudonym);
      // Two DIFFERENT Contexts: the Context pseudonyms differ. This is the
      // answer to the gate's definitive question, server-side.
      expect(probeA.server_context_pseudonym).not.toBe(probeB.server_context_pseudonym);
    });
  }, 45_000);

  it("reports the SAME Context when the same connection asks twice (request-context match)", async () => {
    await withIsolationServer("PER_CONNECTION", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      const token = bindTokenToContext(
        sqlitePath, resource, "principal-chat-a", "ctx-chat-a", "bind-chat-a", "grant-chat-a",
      );

      const first = await callProbe(base, resource, token);
      const second = await callProbe(base, resource, token);

      // One connection, one Context, repeated requests — the resolution is
      // stable, so a chat never observes a Context that shifts under it.
      expect(first.bound_connection_pseudonym).toBe(second.bound_connection_pseudonym);
      expect(first.server_context_pseudonym).toBe(second.server_context_pseudonym);
      expect(first.ownership_epoch).toBe(second.ownership_epoch);
      // The trace id is per-request, so the two calls are distinguishable.
      expect(first.trace_id).not.toBe(second.trace_id);
    });
  }, 45_000);

  it("reports UNBOUND for a credential with no binding and leaks no raw identity", async () => {
    // SHADOW, not PER_CONNECTION: an unbound credential is correctly refused at
    // the edge under enforcement (pinned in CI-G4), so the probe is only
    // reachable for an unbound request while the flag observes. That is also
    // the honest host scenario — a second chat that shares the operator
    // connection resolves UNBOUND and this is what its probe shows.
    await withIsolationServer("SHADOW", async (base, sqlitePath) => {
      const resource = base + "/mcp";
      const raw = "hx_" + crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
      const db = new Database(sqlitePath);
      try {
        db.prepare(
          "INSERT INTO oauth_access_tokens" +
            " (token_hash,principal_id,client_id,resource,scopes_json,family_id,issued_at,expires_at)" +
            " VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          tokenHash, "principal-unbound", "client-unbound", resource,
          JSON.stringify(["hooshix:read"]),
          "family-unbound-" + crypto.randomBytes(8).toString("hex"),
          Date.now(), Date.now() + 3_600_000,
        );
      } finally {
        db.close();
      }

      const probe = await callProbe(base, resource, raw);
      expect(probe.bind_state).toBe("UNBOUND");
      expect(probe.server_context_pseudonym).toBeNull();
      expect(probe.ownership_epoch).toBeNull();
      // Pseudonyms are still present for the connection itself, but they are
      // non-reversible: 12 hex chars of a SHA-256, never the raw id.
      expect(typeof probe.bound_connection_pseudonym).toBe("string");
      expect(probe.bound_connection_pseudonym).toMatch(/^[0-9a-f]{12}$/);
    });
  }, 45_000);

  it("never returns raw ids, bearers, or conversation content (discipline T07)", async () => {
    await withIsolationServer("PER_CONNECTION", async (base, sqlitePath) => {
      const resource = base + "/mcp";
      const token = bindTokenToContext(
        sqlitePath, resource, "principal-chat-a", "ctx-chat-a", "bind-chat-a", "grant-chat-a",
      );

      const probe = await callProbe(base, resource, token);
      const serialized = JSON.stringify(probe);

      // The probe output must not carry any raw identity material back to the
      // model. Pseudonyms are hashes; the underlying values never appear.
      expect(serialized).not.toContain("principal-chat-a");
      expect(serialized).not.toContain("ctx-chat-a");
      expect(serialized).not.toContain("bind-chat-a");
      expect(serialized).not.toContain("grant-chat-a");
      expect(serialized).not.toContain("conn-bind-chat-a");
      expect(serialized).not.toContain("hx_");
      // And it must positively declare the disclosure contract.
      expect(probe._disclosure).toBe("pseudonyms_only_no_raw_identity");
    });
  }, 45_000);

  it("is advertised under OFF and honestly reports UNBOUND (no Context exists to match)", async () => {
    await withIsolationServer("OFF", async (base, _sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      // A real OAuth grant, obtained through the normal flow. Under OFF the
      // database is opened lazily on first use and the legacy Context is never
      // pinned, so resolution is a total no-op and the probe's honest answer is
      // UNBOUND — not a tool that has silently vanished from the catalog.
      const accessToken = await obtainToken(base, resource, bootstrap);
      const probe = await callProbe(base, resource, accessToken);
      expect(probe.bind_state).toBe("UNBOUND");
      expect(probe.server_context_pseudonym).toBeNull();
      expect(probe.ownership_epoch).toBeNull();
    });
  }, 45_000);
});

/**
 * CI-G7 host-test outcome register (CIG0 §5). The owner fills this in after
 * running the checklist against a real ChatGPT product surface on the
 * experimental endpoint. The server-side part above is what makes the test
 * meaningful; without distinct principals the host result is unknowable.
 *
 *   [ ] Two chats A and B opened with two separately registered connections.
 *   [ ] chat_isolation_probe run from BOTH chats, outputs compared.
 *   [ ] Result recorded as exactly one of:
 *         HOST_ATTESTED_CONVERSATION  — the host hands over a signed
 *                                        conversation claim the resolver can map
 *         DISTINCT_CONNECTIONS        — the two chats carry distinguishable
 *                                        connections and resolve to two Contexts
 *         NO_VERIFIABLE_CHAT_ID       — the host shares one connection; only
 *                                        per-connection isolation can be claimed
 *
 * Until this register is filled, the public claim stays at per-connection
 * isolation (CIG0 §4). No per-chat privacy claim is permitted before CI-G7.
 */
