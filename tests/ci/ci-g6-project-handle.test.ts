import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createDisposableFixture, reserveEphemeralLoopbackPort } from "../helpers/r0-disposable-fixtures.js";

/**
 * CI-G6 — conversation-scoped project handles, end to end on a live server.
 *
 * One OAuth connection is shared by every ChatGPT conversation, and the 2026
 * MCP revision carries no per-chat signal, so the server cannot tell two chats
 * apart. The only per-conversation carrier is the conversation itself:
 * open_project mints an opaque ph_... handle that lives only in that chat's
 * model context, and every workspace-bound call must echo it as
 * project=<handle>.
 *
 * The properties pinned here:
 *   1. On a multi-project server an untargeted file/exec call is DENIED with
 *      guidance — there is no shared "active project" to fall back on.
 *   2. A handle scopes calls to exactly its project: the other project is
 *      invisible through it (relative escape and absolute paths both fail).
 *   3. Interleaving another project's handle never changes the first one's
 *      scope — the server holds no mutable selection at all (no bleed).
 *   4. Handles are bound to the minting credential, revocable (close_project),
 *      and expire absolutely (HOOSHIX_PROJECT_HANDLE_TTL_MS).
 *   5. A single-project server keeps the old behavior — no handle required.
 *   6. Under a per-Context enforcement jail a handle can only confirm the
 *      jail's root, never widen it, and the refusal is explicit.
 *   7. A handle crosses the Task boundary: task_create requires it, the plan
 *      persists that root as its immutable workspace, and its steps run there.
 *   8. Exec, Git and search are scoped by the handle exactly as file tools are,
 *      and a failed call persists its classified label — not a bare "failed" —
 *      so a live failure can be triaged after the fact.
 */
interface G6Context {
  readonly base: string;
  readonly sqlitePath: string;
  readonly bootstrap: string;
  readonly dirA: string;
  readonly dirB: string;
}

async function withG6Server(
  options: { tag: string; mode: string; pool: "both" | "a-only"; git?: boolean; extraEnv?: Record<string, string | undefined> },
  block: (ctx: G6Context) => Promise<void>,
): Promise<void> {
  const fixture = createDisposableFixture(`ci-g6-${options.tag}`);
  const dirA = path.join(fixture.root, "ProjectAlpha");
  const dirB = path.join(fixture.root, "ProjectBeta");
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  fs.writeFileSync(path.join(dirA, "alpha.txt"), "ALPHA-MARKER");
  fs.writeFileSync(path.join(dirB, "beta.txt"), "BETA-MARKER");
  // Only A becomes a repository: through a handle, a Git call must succeed on A
  // and fail on B, which is what proves the subprocess cwd followed the handle.
  if (options.git) {
    for (const args of [["init", "--quiet", dirA], ["-C", dirA, "config", "user.name", "CI G6"],
      ["-C", dirA, "config", "user.email", "ci-g6@example.invalid"]] as string[][]) {
      const result = spawnSync("git", args, { encoding: "utf8" });
      if (result.status !== 0) throw new Error(`Fixture git ${args.join(" ")} failed: ${result.stderr}`);
    }
  }
  const lease = await reserveEphemeralLoopbackPort();
  const port = lease.port;
  await lease.close();
  const repo = process.cwd();
  const base = "http://127.0.0.1:" + port;
  const runner = path.join(fixture.root, "ci-g6-runner.mts");
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
    HOOSHIX_BOOTSTRAP_TOKEN: bootstrap, HOOSHIX_BOOTSTRAP_TOKEN_FILE: undefined,
    MCP_ACCESS_TOKEN: undefined, MCP_API_KEY: undefined, MCP_ALLOWED_ORIGINS: undefined,
    MCP_PORT: String(port), MCP_PUBLIC_BASE_URL: base, MCP_BIND_HOST: "127.0.0.1",
    HOOSHIX_WORKSPACE: options.pool === "both" ? dirA + "," + dirB : dirA,
    HOOSHIX_DB_PATH: fixture.sqlitePath,
    HOOSHIX_LOG_DIR: path.join(fixture.root, "logs"),
    HOOSHIX_PERMISSION_LEVEL: "READ_ONLY",
    HOOSHIX_UNRESTRICTED: undefined, HOOSHIX_DIRECT_AUTO_APPROVE: undefined,
    HOOSHIX_EXEC_ENABLED: undefined, HOOSHIX_PROJECT_HANDLE_TTL_MS: undefined,
    CTX_ISOLATION_MODE: options.mode,
    ...options.extraEnv,
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
    await block({ base, sqlitePath: fixture.sqlitePath, bootstrap, dirA, dirB });
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

async function obtainToken(base: string, resource: string, bootstrap: string, scopes = "offline_access hooshix:read"): Promise<string> {
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
      resource, scope: scopes,
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

interface ToolResult { ok: boolean; text: string; }
async function callTool(resource: string, accessToken: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = new Client({ name: "ci-g6-handle", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
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

interface OpenProjectResponse {
  project: string; root: string; handle: string; expiresAt: string; instruction: string;
}
function parseOpenProject(text: string): OpenProjectResponse {
  return JSON.parse(text) as OpenProjectResponse;
}

const DENIAL = /outside workspace|access denied|no such file|not found|does not exist|enoent|denied/i;

describe("CI-G6 / conversation-scoped project handles on the live path", () => {
  it("requires a handle on a multi-project server and scopes every call to it with no bleed", async () => {
    await withG6Server({ tag: "main", mode: "OFF", pool: "both" }, async ({ base, sqlitePath, bootstrap, dirA, dirB }) => {
      const resource = base + "/mcp";
      // Both chats live on ONE connector: the same token, the same connection.
      const token = await obtainToken(base, resource, bootstrap);

      // 1. Untargeted workspace-bound calls are ambiguous → denied with guidance.
      for (const [name, args] of [
        ["read_file", { path: "alpha.txt" }],
        ["list_directory", { path: "." }],
        ["execute_command", { command: "git", args: ["status"] }],
      ] as Array<[string, Record<string, unknown>]>) {
        const untargeted = await callTool(resource, token, name, args);
        expect(untargeted.ok, JSON.stringify(untargeted)).toBe(false);
        expect(untargeted.text).toMatch(/project_required/);
        expect(untargeted.text).toContain("open_project");
        expect(untargeted.text).toContain("ProjectAlpha");
        expect(untargeted.text).toContain("ProjectBeta");
      }

      // The workspace listing itself is readable and advertises the pool.
      const ws = await callTool(resource, token, "get_workspace", {});
      expect(ws.ok, JSON.stringify(ws)).toBe(true);
      const wsData = JSON.parse(ws.text) as { projects: Array<{ name: string }>; hint: string };
      expect(wsData.projects.map((project) => project.name).sort()).toEqual(["ProjectAlpha", "ProjectBeta"]);
      expect(wsData.hint).toContain("open_project");

      // 2. open_project mints a conversation-local handle.
      const opened = await callTool(resource, token, "open_project", { path: dirA });
      expect(opened.ok, JSON.stringify(opened)).toBe(true);
      const hA = parseOpenProject(opened.text);
      expect(hA.handle).toMatch(/^ph_[A-Za-z0-9_-]{16}$/);
      expect(hA.project).toBe("ProjectAlpha");
      expect(fs.realpathSync(hA.root)).toBe(fs.realpathSync(dirA));
      expect(hA.instruction).toContain(hA.handle);

      // 3. The handle scopes file calls to exactly its project.
      const alpha = await callTool(resource, token, "read_file", { path: "alpha.txt", project: hA.handle });
      expect(alpha.ok, JSON.stringify(alpha)).toBe(true);
      expect(alpha.text).toContain("ALPHA-MARKER");
      const listed = await callTool(resource, token, "list_directory", { path: ".", project: hA.handle });
      expect(listed.ok, JSON.stringify(listed)).toBe(true);
      expect(listed.text).toContain("alpha.txt");

      // 4. With A's handle, B is invisible — relative escape and absolute path both fail.
      const escape = await callTool(resource, token, "read_file", { path: "../ProjectBeta/beta.txt", project: hA.handle });
      expect(escape.text).not.toContain("BETA-MARKER");
      expect(escape.ok === false || DENIAL.test(escape.text), JSON.stringify(escape)).toBe(true);
      const abs = await callTool(resource, token, "read_file", { path: path.join(dirB, "beta.txt"), project: hA.handle });
      expect(abs.text).not.toContain("BETA-MARKER");
      expect(abs.ok === false || DENIAL.test(abs.text), JSON.stringify(abs)).toBe(true);

      // 5. "Chat 2" opens B (by unique folder name) while "chat 1" keeps its A handle —
      //    interleaved calls never bleed one project's scope into the other.
      const openedB = await callTool(resource, token, "open_project", { path: "ProjectBeta" });
      expect(openedB.ok, JSON.stringify(openedB)).toBe(true);
      const hB = parseOpenProject(openedB.text);
      expect(hB.project).toBe("ProjectBeta");
      expect(hB.handle).not.toBe(hA.handle);
      const alphaAgain = await callTool(resource, token, "read_file", { path: "alpha.txt", project: hA.handle });
      expect(alphaAgain.ok, JSON.stringify(alphaAgain)).toBe(true);
      expect(alphaAgain.text).toContain("ALPHA-MARKER");
      const beta = await callTool(resource, token, "read_file", { path: "beta.txt", project: hB.handle });
      expect(beta.ok, JSON.stringify(beta)).toBe(true);
      expect(beta.text).toContain("BETA-MARKER");
      const crossed = await callTool(resource, token, "read_file", { path: "alpha.txt", project: hB.handle });
      expect(crossed.text).not.toContain("ALPHA-MARKER");
      expect(crossed.ok === false || DENIAL.test(crossed.text), JSON.stringify(crossed)).toBe(true);

      // 6. Opening a project never creates a server-side "active" selection.
      const stillUntargeted = await callTool(resource, token, "read_file", { path: "alpha.txt" });
      expect(stillUntargeted.ok).toBe(false);
      expect(stillUntargeted.text).toMatch(/project_required/);

      // 7. Forged handles are refused with guidance.
      const forged = await callTool(resource, token, "read_file", {
        path: "alpha.txt", project: "ph_" + crypto.randomBytes(12).toString("base64url"),
      });
      expect(forged.ok).toBe(false);
      expect(forged.text).toMatch(/project_handle_unknown/);
      expect(forged.text).toContain("open_project");

      // 8. Re-opening the same project is idempotent; close_project revokes.
      const reopened = await callTool(resource, token, "open_project", { path: dirA });
      expect(reopened.ok).toBe(true);
      expect(parseOpenProject(reopened.text).handle).toBe(hA.handle);
      const closed = await callTool(resource, token, "close_project", { handle: hA.handle });
      expect(closed.ok, JSON.stringify(closed)).toBe(true);
      expect((JSON.parse(closed.text) as { closed: boolean }).closed).toBe(true);
      const revoked = await callTool(resource, token, "read_file", { path: "alpha.txt", project: hA.handle });
      expect(revoked.ok).toBe(false);
      expect(revoked.text).toMatch(/project_handle_unknown/);
      const reclose = await callTool(resource, token, "close_project", { handle: hA.handle });
      expect(reclose.ok).toBe(false);

      // 9. Mint/close/refuse are all audited.
      const db = new Database(sqlitePath, { readonly: true });
      try {
        const actions = db.prepare(
          "SELECT DISTINCT action FROM decisions WHERE action LIKE 'project_handle%'",
        ).all() as Array<{ action: string }>;
        const names = new Set(actions.map((row) => row.action));
        expect(names.has("project_handle_mint")).toBe(true);
        expect(names.has("project_handle_close")).toBe(true);
        expect(names.has("project_handle_reject")).toBe(true);
        const reasons = db.prepare(
          "SELECT DISTINCT reason FROM decisions WHERE action='project_handle_reject'",
        ).all() as Array<{ reason: string }>;
        const reasonNames = new Set(reasons.map((row) => row.reason));
        expect(reasonNames.has("project_required")).toBe(true);
        expect(reasonNames.has("project_handle_unknown")).toBe(true);
      } finally {
        db.close();
      }
    });
  }, 120_000);

  it("expires handles absolutely and advertises a fresh one on re-open", async () => {
    await withG6Server(
      { tag: "expiry", mode: "OFF", pool: "both", extraEnv: { HOOSHIX_PROJECT_HANDLE_TTL_MS: "2000" } },
      async ({ base, bootstrap, dirA }) => {
        const resource = base + "/mcp";
        const token = await obtainToken(base, resource, bootstrap);
        const opened = await callTool(resource, token, "open_project", { path: dirA });
        expect(opened.ok, JSON.stringify(opened)).toBe(true);
        const first = parseOpenProject(opened.text);
        const fresh = await callTool(resource, token, "read_file", { path: "alpha.txt", project: first.handle });
        expect(fresh.ok, JSON.stringify(fresh)).toBe(true);
        expect(fresh.text).toContain("ALPHA-MARKER");

        await new Promise((resolve) => setTimeout(resolve, 2300));
        const expired = await callTool(resource, token, "read_file", { path: "alpha.txt", project: first.handle });
        expect(expired.ok).toBe(false);
        expect(expired.text).toMatch(/project_handle_expired/);
        expect(expired.text).toContain("open_project");

        const reopened = await callTool(resource, token, "open_project", { path: dirA });
        expect(reopened.ok).toBe(true);
        const second = parseOpenProject(reopened.text);
        const again = await callTool(resource, token, "read_file", { path: "alpha.txt", project: second.handle });
        expect(again.ok, JSON.stringify(again)).toBe(true);
        expect(again.text).toContain("ALPHA-MARKER");
      },
    );
  }, 120_000);

  it("carries the conversation's project handle across the Task boundary", async () => {
    await withG6Server(
      { tag: "taskplan", mode: "OFF", pool: "both", extraEnv: { HOOSHIX_PERMISSION_LEVEL: "DEVELOPER_MODE" } },
      async ({ base, sqlitePath, bootstrap, dirA, dirB }) => {
        const resource = base + "/mcp";
        // Task controls need their own OAuth scope; the plan inherits the
        // creation-time scopes, which is what its steps are authorized with.
        const token = await obtainToken(base, resource, bootstrap, "offline_access hooshix:read hooshix:task:manage");
        const opened = await callTool(resource, token, "open_project", { path: dirA });
        expect(opened.ok, JSON.stringify(opened)).toBe(true);
        const hA = parseOpenProject(opened.text).handle;
        const steps = (path: string) => [{ action: "read", tool: "read_file", arguments: { path } }];

        // A plan is born with a workspace, so the handle is required here too —
        // creating it untargeted would capture no root and every step would
        // then be denied far from the reason.
        const untargeted = await callTool(resource, token, "task_create", { title: "no handle", steps: steps("alpha.txt") });
        expect(untargeted.ok).toBe(false);
        expect(untargeted.text).toMatch(/project_required/);

        const created = await callTool(resource, token, "task_create", { title: "alpha plan", project: hA, steps: steps("alpha.txt") });
        expect(created.ok, JSON.stringify(created)).toBe(true);
        const taskId = (JSON.parse(created.text) as { id: string }).id;

        // The handle crosses into the persisted, immutable execution context.
        let capturedRoot: string | null | undefined;
        {
          const db = new Database(sqlitePath, { readonly: true });
          try {
            const row = db.prepare("SELECT execution_context AS context FROM tasks WHERE id = ?")
              .get(taskId) as { context: string };
            capturedRoot = (JSON.parse(row.context) as { workspace?: string | null }).workspace;
          } finally {
            db.close();
          }
        }
        expect(fs.realpathSync(capturedRoot ?? "")).toBe(fs.realpathSync(dirA));

        // ...so the step resolves inside THAT project, not the server process.
        const ran = await callTool(resource, token, "task_run", { taskId });
        expect(ran.ok, JSON.stringify(ran)).toBe(true);
        expect((JSON.parse(ran.text) as { status: string }).status).toBe("completed");
        expect(ran.text).toContain("ALPHA-MARKER");
        expect(ran.text).not.toContain("BETA-MARKER");

        // The plan cannot widen its own root: an escape step is blocked, and the
        // Task is reported failed rather than completed around that step.
        const escapeTask = (JSON.parse((await callTool(resource, token, "task_create", {
          title: "escape plan", project: hA, steps: steps(path.posix.join("..", path.basename(dirB), "beta.txt")),
        })).text) as { id: string }).id;
        const escaped = await callTool(resource, token, "task_run", { taskId: escapeTask });
        expect((JSON.parse(escaped.text) as { status: string }).status).toBe("failed");
        expect(escaped.text).toMatch(/outside workspace/i);
        expect(escaped.text).not.toContain("BETA-MARKER");
      },
    );
  }, 180_000);

  it("scopes exec, git and search to the handle root and persists why a call failed", async () => {
    await withG6Server(
      {
        tag: "scopetools", mode: "OFF", pool: "both", git: true,
        extraEnv: { HOOSHIX_PERMISSION_LEVEL: "DEVELOPER_MODE", HOOSHIX_DIRECT_AUTO_APPROVE: "0" },
      },
      async ({ base, sqlitePath, bootstrap, dirA, dirB }) => {
        const resource = base + "/mcp";
        // Git and process operations sit behind the execute scope even when the
        // operation itself is read-only; the read scope alone cannot reach them.
        const token = await obtainToken(base, resource, bootstrap, "offline_access hooshix:read hooshix:execute");
        const openedA = await callTool(resource, token, "open_project", { path: dirA });
        expect(openedA.ok, JSON.stringify(openedA)).toBe(true);
        const hA = parseOpenProject(openedA.text).handle;
        const openedB = await callTool(resource, token, "open_project", { path: dirB });
        expect(openedB.ok, JSON.stringify(openedB)).toBe(true);
        const hB = parseOpenProject(openedB.text).handle;

        // 1. Exec, Git and search are as ambiguous as the file tools were: an
        //    untargeted call has no project to resolve against.
        for (const [name, args] of [
          ["git_status", {}],
          ["search_files", { query: "MARKER" }],
          ["execute_command", { command: "git", args: ["status"] }],
        ] as Array<[string, Record<string, unknown>]>) {
          const untargeted = await callTool(resource, token, name, args);
          expect(untargeted.ok, JSON.stringify(untargeted)).toBe(false);
          expect(untargeted.text).toMatch(/project_required/);
        }

        // 2. Only ProjectAlpha is a repository, so a Git call that succeeds
        //    through A's handle and reports "not a git repository" through B's
        //    can only have run inside the handle's root.
        const gitThroughA = await callTool(resource, token, "git_status", { project: hA });
        expect(gitThroughA.ok, JSON.stringify(gitThroughA)).toBe(true);
        const gitThroughB = await callTool(resource, token, "git_status", { project: hB });
        expect(gitThroughB.ok).toBe(false);
        expect(gitThroughB.text).toMatch(/not_a_git_repository/);
        const execThroughA = await callTool(resource, token, "execute_command", {
          command: "git", args: ["status"], project: hA,
        });
        expect(execThroughA.ok, JSON.stringify(execThroughA)).toBe(true);
        expect((JSON.parse(execThroughA.text) as { exitCode: number }).exitCode).toBe(0);

        // 3. Search resolves its path through the handle too, and an escaping
        //    path is refused rather than quietly re-rooted.
        const searched = await callTool(resource, token, "search_files", { query: "MARKER", path: ".", project: hA });
        expect(searched.ok, JSON.stringify(searched)).toBe(true);
        expect(searched.text).toContain("ALPHA-MARKER");
        expect(searched.text).not.toContain("BETA-MARKER");
        const escaped = await callTool(resource, token, "search_files", {
          query: "MARKER", path: path.posix.join("..", path.basename(dirB)), project: hA,
        });
        expect(escaped.ok).toBe(false);
        expect(escaped.text).toMatch(/path_outside_workspace/);

        // 4. The persisted gateway row carries the classified label, not a bare
        //    "failed". Without it a live failure cannot be triaged afterwards —
        //    the operator-reported ones stayed unproven precisely because the
        //    label was computed, sent to the client and then dropped.
        const missing = await callTool(resource, token, "read_file", { path: "no-such-file.txt", project: hA });
        expect(missing.ok).toBe(false);
        expect(missing.text).toMatch(/resource_not_found/);
        const db = new Database(sqlitePath, { readonly: true });
        try {
          const reasons = db.prepare(
            "SELECT action, reason FROM decisions WHERE action IN " +
              "('r2_gateway:read_file','r2_gateway:search_files','r2_gateway:git_status') ORDER BY id DESC LIMIT 12",
          ).all() as Array<{ action: string; reason: string }>;
          // Rows come newest-first, so the first row per action is the latest call.
          const byAction = new Map<string, string>();
          for (const row of reasons) if (!byAction.has(row.action)) byAction.set(row.action, row.reason);
          expect(byAction.get("r2_gateway:read_file")).toBe("resource_not_found");
          expect(byAction.get("r2_gateway:search_files")).toBe("path_outside_workspace");
          expect(byAction.get("r2_gateway:git_status")).toBe("not_a_git_repository");
          expect(reasons.some((row) => row.reason === "failed")).toBe(false);
        } finally {
          db.close();
        }
      },
    );
  }, 180_000);

  it("binds handles to the minting credential and never lets a jail be widened", async () => {
    await withG6Server({ tag: "perconn", mode: "PER_CONNECTION", pool: "both" }, async ({ base, bootstrap, dirA }) => {
      const resource = base + "/mcp";
      const tokenA = await obtainToken(base, resource, bootstrap);
      const tokenB = await obtainToken(base, resource, bootstrap);

      const opened = await callTool(resource, tokenA, "open_project", { path: dirA });
      expect(opened.ok, JSON.stringify(opened)).toBe(true);
      const hA = parseOpenProject(opened.text).handle;

      // Another connection's handle is indistinguishable from a forged one.
      const steal = await callTool(resource, tokenB, "read_file", { path: "alpha.txt", project: hA });
      expect(steal.ok).toBe(false);
      expect(steal.text).toMatch(/project_handle_unknown/);

      // B's own handle for the same project is a distinct value.
      const openedB = await callTool(resource, tokenB, "open_project", { path: dirA });
      expect(openedB.ok, JSON.stringify(openedB)).toBe(true);
      const hB = parseOpenProject(openedB.text).handle;
      expect(hB).not.toBe(hA);

      // Under the per-Context jail a handle may only confirm the jail's root:
      // requesting another root is refused explicitly, never silently jailed.
      const confined = await callTool(resource, tokenB, "read_file", { path: "alpha.txt", project: hB });
      expect(confined.ok).toBe(false);
      expect(confined.text).toMatch(/project_conflicts_with_context_workspace/);

      // Untargeted calls keep the CI-G5 jail behavior — the handle gate is
      // inactive while an enforcement jail defines the scope.
      const legacy = await callTool(resource, tokenB, "read_file", { path: "alpha.txt" });
      expect(legacy.text).not.toMatch(/project_required/);
    });
  }, 120_000);

  it("keeps single-project servers unchanged — no handle required", async () => {
    await withG6Server({ tag: "single", mode: "OFF", pool: "a-only" }, async ({ base, bootstrap }) => {
      const resource = base + "/mcp";
      const token = await obtainToken(base, resource, bootstrap);
      const direct = await callTool(resource, token, "read_file", { path: "alpha.txt" });
      expect(direct.ok, JSON.stringify(direct)).toBe(true);
      expect(direct.text).toContain("ALPHA-MARKER");
    });
  }, 120_000);
});
