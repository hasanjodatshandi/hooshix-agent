import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createDisposableFixture, reserveEphemeralLoopbackPort } from "../helpers/r0-disposable-fixtures.js";

/**
 * CI-G5 — the per-Context FILESYSTEM jail, end to end on a live server.
 *
 * CI-G4 proved an unbound credential is refused at the edge and CI-G7b proved
 * each new OAuth connection mints a distinct Context. What was still missing was
 * the property the operator actually cares about: two connections on the SAME
 * server cannot touch each other's files. That is enforced here — under an
 * enforcement mode the effective workspace root becomes the Context's own grant
 * canonicalRoot (`data/contexts/<ctx>`), and every file tool resolves through
 * validateWorkspace(), which rejects anything outside that root.
 *
 * Three facts are pinned:
 *   1. A connection reads a file it owns inside its own Context directory.
 *   2. The same filename in ANOTHER connection's directory is invisible, and an
 *      attempt to reach it by relative or absolute escape is DENIED.
 *   3. Under OFF the same shared workspace file IS readable — proving the
 *      refusal is enforcement (the jail), not resolution or an unrelated bug.
 */
async function withServer(
  mode: string,
  block: (base: string, sqlitePath: string, bootstrap: string, serverCwd: string, workspaceDir: string) => Promise<void>,
): Promise<void> {
  const fixture = createDisposableFixture(`ci-g5-${mode.toLowerCase().replace("_", "-")}`);
  const workspaceDir = path.join(fixture.root, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const lease = await reserveEphemeralLoopbackPort();
  const port = lease.port;
  await lease.close();
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, "ci-g5-runner.mts");
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
    HOOSHIX_WORKSPACE: workspaceDir,
    HOOSHIX_DB_PATH: fixture.sqlitePath,
    HOOSHIX_LOG_DIR: path.join(fixture.root, "logs"),
    HOOSHIX_PERMISSION_LEVEL: "READ_ONLY",
    CTX_ISOLATION_MODE: mode,
  };
  const child: ChildProcess = spawn(process.execPath, ["--import", loader, runner], {
    cwd: fixture.root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 75; attempt++) {
      try { if ((await fetch(base + "/health/live")).status === 200) { ready = true; break; } } catch { /* booting */ }
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(ready, stderr).toBe(true);
    await block(base, fixture.sqlitePath, bootstrap, fixture.root, workspaceDir);
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

/** The Context id provisioned for a given access token, via its binding. */
function contextIdForToken(sqlitePath: string, accessToken: string): string {
  const credentialHash = crypto.createHash("sha256").update(accessToken).digest("hex");
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const row = db
      .prepare(
        "SELECT context_id FROM context_binding WHERE credential_hash=?" ,
      )
      .get(credentialHash) as { context_id: string } | undefined;
    expect(row, "no Context bound to this token").toBeDefined();
    expect(row!.context_id).not.toBe("ctx-legacy-shared-operator");
    return row!.context_id;
  } finally {
    db.close();
  }
}

interface ToolResult { ok: boolean; text: string; }
async function callTool(resource: string, accessToken: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = new Client({ name: "ci-g5-jail", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: "Bearer " + accessToken } },
  });
  try {
    await client.connect(transport);
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean; content?: Array<{ type: string; text?: string }>;
    };
    const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
    return { ok: result.isError !== true, text };
  } finally {
    await client.close();
  }
}

const DENIAL = /outside workspace|access denied|no such file|not found|does not exist|enoent|denied/i;

describe("CI-G5 / per-Context filesystem jail on the live path", () => {
  it("confines each connection to its own Context directory and blocks cross-Context reads", async () => {
    await withServer("PER_CONNECTION", async (base, sqlitePath, bootstrap, serverCwd, workspaceDir) => {
      const resource = base + "/mcp";
      // The shared workspace holds a file NO per-Context connection should see.
      fs.writeFileSync(path.join(workspaceDir, "shared.txt"), "SHARED-LEAK-MARKER");

      const tokenA = await obtainToken(base, resource, bootstrap);
      const tokenB = await obtainToken(base, resource, bootstrap);
      const ctxA = contextIdForToken(sqlitePath, tokenA);
      const ctxB = contextIdForToken(sqlitePath, tokenB);
      expect(ctxA).not.toBe(ctxB);

      // The jail root is materialized relative to the server cwd (= fixture root).
      const dirA = path.join(serverCwd, "data/contexts", ctxA);
      fs.mkdirSync(dirA, { recursive: true });
      fs.writeFileSync(path.join(dirA, "own.txt"), "ONLY-A-SECRET");

      // A first tool call also creates B's (empty) jail directory.
      await callTool(resource, tokenB, "read_file", { path: "probe.txt" });

      // 1. A reads its OWN file — the jail is the right root, not a blanket block.
      const own = await callTool(resource, tokenA, "read_file", { path: "own.txt" });
      expect(own.ok, JSON.stringify(own)).toBe(true);
      expect(own.text).toContain("ONLY-A-SECRET");

      // 2a. The same filename in B's own (empty) jail is invisible.
      const crossName = await callTool(resource, tokenB, "read_file", { path: "own.txt" });
      expect(crossName.text).not.toContain("ONLY-A-SECRET");

      // 2b. Reaching A's directory by relative escape is refused.
      const escape = await callTool(resource, tokenB, "read_file", { path: `../${ctxA}/own.txt` });
      expect(escape.text).not.toContain("ONLY-A-SECRET");
      expect(escape.ok === false || DENIAL.test(escape.text), JSON.stringify(escape)).toBe(true);

      // 2c. Reaching A's directory by absolute path is refused too.
      const abs = await callTool(resource, tokenB, "read_file", { path: path.join(dirA, "own.txt") });
      expect(abs.text).not.toContain("ONLY-A-SECRET");
      expect(abs.ok === false || DENIAL.test(abs.text), JSON.stringify(abs)).toBe(true);

      // 3. The shared workspace file is invisible from inside a Context jail,
      //    even by walking out with ../.
      const shared = await callTool(resource, tokenA, "read_file", { path: "shared.txt" });
      expect(shared.text).not.toContain("SHARED-LEAK-MARKER");
      const sharedEscape = await callTool(resource, tokenA, "read_file", { path: "../../../shared.txt" });
      expect(sharedEscape.text).not.toContain("SHARED-LEAK-MARKER");
      expect(sharedEscape.ok === false || DENIAL.test(sharedEscape.text), JSON.stringify(sharedEscape)).toBe(true);
    });
  }, 60_000);

  it("leaves the shared workspace readable under OFF — isolation is enforcement, not resolution", async () => {
    await withServer("OFF", async (base, sqlitePath, bootstrap, _serverCwd, workspaceDir) => {
      const resource = base + "/mcp";
      fs.writeFileSync(path.join(workspaceDir, "shared.txt"), "SHARED-LEAK-MARKER");

      void sqlitePath;
      const token = await obtainToken(base, resource, bootstrap);
      const shared = await callTool(resource, token, "read_file", { path: "shared.txt" });
      expect(shared.ok, JSON.stringify(shared)).toBe(true);
      expect(shared.text).toContain("SHARED-LEAK-MARKER");
    });
  }, 60_000);
});
