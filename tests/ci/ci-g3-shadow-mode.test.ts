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
 * CI-G3 — SHADOW mode end to end. The flag is OFF by default; turning it on must
 * (a) keep every existing request working — no enforcement yet — and (b) write
 * what the new policy WOULD have decided into security_audit. The legacy pin
 * means an operator token resolves to the legacy Context, so the audit row is an
 * ALLOW; an OFF deployment writes nothing at all.
 */
async function withShadowServer(
  mode: string,
  block: (base: string, sqlitePath: string, bootstrap: string) => Promise<void>,
): Promise<void> {
  const fixture = createDisposableFixture(`ci-g3-${mode.toLowerCase()}`);
  const lease = await reserveEphemeralLoopbackPort();
  const port = lease.port;
  await lease.close();
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, "ci-g3-runner.mts");
  fs.writeFileSync(
    runner,
    `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo, "src/mcp/http-server.ts")).href)};await startHttpServer();`,
  );
  const loader = pathToFileURL(path.join(repo, "node_modules/tsx/dist/loader.mjs")).href;
  const bootstrap = "bootstrap-" + crypto.randomBytes(32).toString("base64url");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The ambient environment may already carry the canonical HOOSHIX_HTTP_* /
    // HOOSHIX_PUBLIC_BASE_URL names, which assertNoAliasConflict rejects when
    // they disagree with the MCP_* aliases this fixture must set.
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
  const redirect = "http://127.0.0.1:49993/callback";
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

async function mcpInitialize(base: string, resource: string, accessToken: string): Promise<void> {
  const client = new Client({ name: "ci-g3-shadow", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: "Bearer " + accessToken } },
  });
  try {
    await client.connect(transport);
  } finally {
    await client.close();
  }
}

describe("CI-G3 / SHADOW mode request observation", () => {
  it("records an ALLOW audit row for a legacy operator token and still serves the request", async () => {
    await withShadowServer("SHADOW", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      const accessToken = await obtainToken(base, resource, bootstrap);
      expect(accessToken).toBeTruthy();

      // SHADOW must not change behavior: the request is served as before.
      await expect(mcpInitialize(base, resource, accessToken)).resolves.toBeUndefined();

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const audits = db
          .prepare("SELECT action, decision, context_id FROM security_audit ORDER BY id")
          .all() as Array<{ action: string; decision: string; context_id: string }>;
        expect(audits.length, JSON.stringify(audits)).toBeGreaterThanOrEqual(1);
        const requestAudit = audits.find((row) => row.action === "MCP_REQUEST");
        expect(requestAudit, JSON.stringify(audits)).toBeDefined();
        expect(requestAudit!.decision).toBe("ALLOW");
        // The legacy pin bridged the operator token to the legacy Context.
        expect(requestAudit!.context_id).toBe("ctx-legacy-shared-operator");
      } finally {
        db.close();
      }
    });
  }, 30_000);

  it("writes no audit rows while isolation is OFF", async () => {
    await withShadowServer("OFF", async (base, sqlitePath, bootstrap) => {
      const resource = base + "/mcp";
      const accessToken = await obtainToken(base, resource, bootstrap);
      await mcpInitialize(base, resource, accessToken);

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const count = (db.prepare("SELECT COUNT(*) AS n FROM security_audit").get() as { n: number }).n;
        expect(count).toBe(0);
      } finally {
        db.close();
      }
    });
  }, 30_000);
});
