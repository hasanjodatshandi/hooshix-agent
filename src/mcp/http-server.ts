import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./registry.js";
import { TOOL_NAMES, TOOL_CAPABILITIES, TOOL_CATEGORIES, TOOL_CATEGORY_MAP, type ToolName } from "../core/orchestrator/tool-orchestrator.js";
import { OAuthProvider } from "./oauth.js";
import { mcpMetrics } from "./metrics.js";
import { createMetricsServer } from "./metrics-server.js";
import { getAgentMetrics } from "../core/trace/metrics-service.js";
import { withAgentDatabase } from "../core/memory/database.js";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.env.MCP_PORT ?? "3001", 10);
const PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

// Current access token (set in startHttpServer)
let currentAccessToken = "";
// OAuth provider reference used by monitoring-endpoint auth (set per request)
let oauthProviderRef: OAuthProvider | null = null;

// --- Persistent Token ---
// Token priority: MCP_ACCESS_TOKEN env → .token file → auto-generate + save
const TOKEN_FILE = path.join(process.cwd(), ".token");

/** Load access token with persistent storage */
function loadToken(): string {
  const envToken = process.env.MCP_ACCESS_TOKEN;
  if (envToken) return envToken;
  try {
    const fileToken = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    if (fileToken) return fileToken;
  } catch { /* File doesn't exist yet */ }
  const generated = crypto.randomBytes(24).toString("base64url");
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, generated, "utf-8");
    console.error(`🔑 Auto-generated token saved to ${TOKEN_FILE}`);
  } catch (err) {
    console.error(`⚠️  Could not save token to ${TOKEN_FILE}:`, err);
  }
  return generated;
}

// Grace period before cleaning up closed sessions (ms)
const SESSION_GRACE_MS = 5 * 60 * 1000; // 5 minutes

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  closedAt?: number; // timestamp when transport closed (grace period starts)
}

const sessions = new Map<string, SessionEntry>();

/**
 * Clean up sessions that have been closed for longer than the grace period.
 * Called periodically to prevent unbounded memory growth.
 */
function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (entry.closedAt && now - entry.closedAt > SESSION_GRACE_MS) {
      sessions.delete(id);
      console.error(`🧹 session_expired id=${id.slice(0, 8)}`);
    }
  }
}
setInterval(cleanupStaleSessions, 60_000); // run every minute

function createServer(): McpServer {
  return createMetricsServer(
    { name: "hooshix-agent", version: "0.1.0" },
    registerTools,
  );
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  oauth: OAuthProvider,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";
  oauthProviderRef = oauth;

  // Health check — requires the monitoring token when one is configured.
  if (path === "/health") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    sendJSON(res, 200, {
      status: "ok",
      bridge: "running",
      pid: process.pid,
      tools_loaded: true,
    });
    return;
  }

  // Metrics endpoint — supports ?taskId=uuid&tool=X&status=X&from=X&to=X&limit=N&offset=N
  if (path === "/metrics") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/plain")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(mcpMetrics.getPrometheusMetrics());
    } else {
      const dbMetrics = getAgentMetrics({
        taskId: url.searchParams.get("taskId") ?? undefined,
        tool: url.searchParams.get("tool") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        limit: parseInt(url.searchParams.get("limit") ?? "100", 10),
        offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
      });
      sendJSON(res, 200, { ...mcpMetrics.getSnapshot(), database: dbMetrics });
    }
    return;
  }

  // Dashboard — supports ?page=N&tool=X&status=X&from=X&to=X for filtering
  if (path === "/dashboard" || path === "/dashboard/") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const pageSize = 20;
    const toolFilter = url.searchParams.get("tool") ?? undefined;
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const fromFilter = url.searchParams.get("from") ?? undefined;
    const toFilter = url.searchParams.get("to") ?? undefined;
    const taskIdFilter = url.searchParams.get("taskId") ?? undefined;
    const snapshot = mcpMetrics.getSnapshot();
    const dbMetrics = getAgentMetrics({
      taskId: taskIdFilter,
      tool: toolFilter,
      status: statusFilter,
      from: fromFilter,
      to: toFilter,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    // Get distinct tool names from database for the filter dropdown
    const toolNames = getDistinctToolNames();
    sendHTML(res, 200, dashboardPage(snapshot, dbMetrics, toolNames, page, pageSize, { toolFilter, statusFilter, fromFilter, toFilter, taskIdFilter }));
    return;
  }

  // Tools listing — requires the monitoring token when one is configured.
  if (path === "/tools") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/html") || !accept.includes("application/json")) {
      sendHTML(res, 200, toolsPage());
    } else {
      sendJSON(res, 200, toolsList());
    }
    return;
  }

  // Grouped tool documentation — Desktop-Commander-style reference page:
  // category sections (Read actions / Write actions / …) with expandable tools.
  if (path === "/docs" || path === "/docs/") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    sendHTML(res, 200, toolDocsPage());
    return;
  }

  // --- OAuth well-known endpoints (no auth) ---
  if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration") {
    const base = externalBaseURL(req);
    sendJSON(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: ["offline_access"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    return;
  }

  if (path === "/.well-known/oauth-protected-resource") {
    const base = externalBaseURL(req);
    sendJSON(res, 200, {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: ["offline_access"],
      bearer_methods_supported: ["header"],
    });
    return;
  }

  // --- OAuth endpoints (no bearer auth) ---
  if (path === "/oauth/authorize") {
    if (method === "GET") {
      const query = Object.fromEntries(url.searchParams);
      sendHTML(res, 200, authorizePage(query, externalBaseURL(req)));
      return;
    }
    if (method === "POST") {
      await handleAuthorizePOST(req, res, url, oauth, externalBaseURL(req));
      return;
    }
  }

  if (path === "/oauth/token" && method === "POST") {
    await handleTokenPOST(req, res, oauth);
    return;
  }

  if (path === "/oauth/register" && method === "POST") {
    await handleRegisterPOST(req, res);
    return;
  }

  // --- MCP endpoint ---
  if (path !== "/mcp") {
    sendJSON(res, 404, { error: "not found" });
    return;
  }

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Mcp-Session-Id, Authorization",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Bearer token auth (skip if ACCESS_TOKEN is empty = no auth required)
  if (currentAccessToken && !oauth.verifyToken(req.headers.authorization)) {
    const metadata = `${externalBaseURL(req)}/.well-known/oauth-protected-resource`;
    res.writeHead(401, {
      "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="offline_access"`,
    });
    const body = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized: missing or invalid bearer token" } });
    res.end(body);
    return;
  }

  // DELETE — close session
  if (method === "DELETE") {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      await entry.transport.close();
      sessions.delete(sessionId);
    }
    res.writeHead(200);
    res.end();
    return;
  }

  // GET — SSE stream for server-initiated messages
  if (method === "GET") {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(400);
      res.end("Missing or invalid Mcp-Session-Id header");
      return;
    }
    const entry = sessions.get(sessionId)!;
    // Ensure Accept header includes both types
    const accept = req.headers.accept ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      req.headers.accept = [accept, "application/json", "text/event-stream"]
        .filter(Boolean)
        .join(", ");
    }
    await entry.transport.handleRequest(req, res);
    return;
  }

  // POST — JSON-RPC messages
  if (method === "POST") {
    // New session if no session header
    const existingSessionId = req.headers["mcp-session-id"] as
      | string
      | undefined;

    if (existingSessionId && sessions.has(existingSessionId)) {
      const entry = sessions.get(existingSessionId)!;
      // If transport was closed (grace period), create a new one for reconnection
      if (entry.closedAt) {
        console.error(`🔌 MCP session_reconnect id=${existingSessionId.slice(0, 8)}`);
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => existingSessionId,
          enableJsonResponse: true,
        });
        entry.transport = newTransport;
        entry.closedAt = undefined;
        await entry.server.connect(newTransport);
        newTransport.onclose = () => {
          mcpMetrics.recordSessionClosed(existingSessionId);
          entry.closedAt = Date.now();
          console.error(`🔌 MCP session_closed id=${existingSessionId.slice(0, 8)} (grace=${SESSION_GRACE_MS / 1000}s)`);
        };
      }
      // Ensure Accept header includes both types (required by MCP Streamable HTTP spec)
      const accept = req.headers.accept ?? "";
      if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
        req.headers.accept = [accept, "application/json", "text/event-stream"]
          .filter(Boolean)
          .join(", ");
      }
      await entry.transport.handleRequest(req, res);
      return;
    }

    // Create new session
    const sessionId = crypto.randomUUID();
    const server = createServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: true,
    });

    sessions.set(sessionId, { transport, server });

    await server.connect(transport);

    // Ensure Accept header includes both types (required by MCP Streamable HTTP spec)
    const accept = req.headers.accept ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      req.headers.accept = [accept, "application/json", "text/event-stream"]
        .filter(Boolean)
        .join(", ");
    }

    // Forward the initial request
    await transport.handleRequest(req, res);

    // Log session creation after transport processes the body
    mcpMetrics.recordSessionCreated(sessionId);
    console.error(`🔌 MCP session_created id=${sessionId.slice(0, 8)}`);

    // Cleanup on close — keep session alive during grace period
    // so ChatGPT can reconnect if the SSE stream drops
    transport.onclose = () => {
      mcpMetrics.recordSessionClosed(sessionId);
      const entry = sessions.get(sessionId);
      if (entry) {
        entry.closedAt = Date.now();
      }
      console.error(`🔌 MCP session_closed id=${sessionId.slice(0, 8)} (grace=${SESSION_GRACE_MS / 1000}s)`);
    };

    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
}

// --- Helper functions ---

function sendJSON(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 0);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendHTML(res: http.ServerResponse, status: number, html: string): void {
  const data = Buffer.from(html, "utf-8");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": data.length,
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function externalBaseURL(req: http.IncomingMessage): string {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  return `https://${req.headers.host ?? "localhost:3001"}`;
}

/**
 * Auth gate for monitoring/UI endpoints (/health, /metrics, /dashboard, /tools).
 * Mechanism: the same single bearer token that protects /mcp, but browser-friendly:
 * accepted via the Authorization header OR `?token=<token>` query parameter
 * (browsers cannot send headers on a plain navigation). Timing-safe comparison.
 * When no access token is configured (empty MCP_ACCESS_TOKEN and no .token file),
 * the endpoints stay open — that is the local stdio/dev scenario only.
 */
function authorizeMonitoringRequest(req: http.IncomingMessage, url: URL, res: http.ServerResponse): boolean {
  if (!currentAccessToken) return true; // no token configured — local dev mode
  if (oauthProviderRef?.verifyToken(req.headers.authorization)) return true;
  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken.length === currentAccessToken.length && oauthProviderRef) {
    if (oauthProviderRef.verifyToken(`Bearer ${queryToken}`)) return true;
  }
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": `Bearer realm="hooshix-monitoring"`,
  });
  res.end("unauthorized: provide Authorization: Bearer <token> or ?token=<token>");
  return false;
}

function validRedirectURI(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === "https:" && parsed.hostname === "chatgpt.com") return true;
    if (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

interface ToolInfo {
  name: string;
  description: string;
  risk: string;
  requiredArguments: string[];
  capabilities: string[];
}

function toolsList(): ToolInfo[] {
  // Full registry inventory (includes task/project/memory management tools that
  // are not step-executable and therefore absent from TOOL_NAMES).
  const allNames = [
    ...TOOL_NAMES,
    "task_create", "task_get", "task_list", "task_run", "task_approve", "task_resume",
    "task_report", "task_replay", "task_cancel", "task_append_steps", "task_link", "task_links", "task_step_risks",
    "project_save", "project_get", "project_delete", "project_archive", "project_list",
    "memory_add", "memory_list", "memory_get", "memory_delete",
  ];
  return allNames.map((name) => {
    const cap = TOOL_CAPABILITIES[name as ToolName];
    return {
      name,
      description: getToolDescription(name as ToolName),
      risk: cap?.risk ?? "medium",
      requiredArguments: [...(cap?.requiredArguments ?? [])],
      capabilities: [...(cap?.capabilities ?? [])],
    };
  });
}

/**
 * Grouped tool reference page (Desktop-Commander-style): category sections,
 * each tool expandable to its full description. /tools stays the flat list;
 * /docs is the categorized, clickable reference.
 */
function toolDocsPage(): string {
  const tools = toolsList();
  const groups = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const category = TOOL_CATEGORY_MAP[tool.name] ?? "Other";
    const bucket = groups.get(category);
    if (bucket) bucket.push(tool);
    else groups.set(category, [tool]);
  }

  const riskBadge = (risk: string): string =>
    `<span class="badge" style="background:${RISK_COLORS[risk] ?? "#6e7681"};color:#fff">${escapeHTML(risk)}</span>`;

  let sections = "";
  for (const category of TOOL_CATEGORIES) {
    const group = groups.get(category);
    if (!group || group.length === 0) continue;
    groups.delete(category);
    const cards = group.map((tool) => `
      <details class="tool">
        <summary>
          <span class="tool-name">${escapeHTML(tool.name)}</span>
          <span class="tool-summary">${escapeHTML(tool.description.split("\n")[0])}</span>
          ${riskBadge(tool.risk)}
        </summary>
        <div class="tool-body">
          <pre class="tool-desc">${escapeHTML(tool.description)}</pre>
          ${tool.requiredArguments.length > 0 ? `<p class="meta">Required: <code>${tool.requiredArguments.map(escapeHTML).join(", ")}</code></p>` : ""}
          <p class="meta">Capabilities: ${tool.capabilities.map((c) => `<code>${escapeHTML(c)}</code>`).join(" ")}</p>
        </div>
      </details>`).join("\n");
    sections += `
    <h2 class="category">${escapeHTML(category)} <span class="count">${group.length}</span></h2>
    <div class="group">${cards}</div>`;
  }
  // Defensive: any tool not covered by the canonical categories
  for (const [category, group] of groups) {
    const cards = group.map((tool) => `<details class="tool"><summary><span class="tool-name">${escapeHTML(tool.name)}</span><span class="tool-summary">${escapeHTML(tool.description.split("\n")[0])}</span></summary><pre class="tool-desc">${escapeHTML(tool.description)}</pre></details>`).join("\n");
    sections += `<h2 class="category">${escapeHTML(category)} <span class="count">${group.length}</span></h2><div class="group">${cards}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HooshiX MCP — Tool Reference</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; padding: 28px; max-width: 980px; margin: 0 auto; }
  h1 { font-size: 1.5rem; color: #58a6ff; margin-bottom: 4px; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; }
  .subtitle a { color: #58a6ff; text-decoration: none; }
  h2.category { font-size: 1.05rem; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #30363d; color: #c9d1d9; }
  h2.category .count { color: #8b949e; font-weight: 400; font-size: 0.85rem; margin-left: 6px; }
  details.tool { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 8px; }
  details.tool[open] { border-color: #388bfd; }
  details.tool summary { display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer; list-style: none; }
  details.tool summary::-webkit-details-marker { display: none; }
  details.tool summary::before { content: "▸"; color: #8b949e; transition: transform 0.15s; }
  details.tool[open] summary::before { transform: rotate(90deg); }
  .tool-name { font-family: 'SF Mono', 'Fira Code', monospace; font-weight: 600; color: #58a6ff; min-width: 190px; }
  .tool-summary { color: #8b949e; font-size: 0.85rem; flex: 1; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 500; }
  .tool-body { padding: 4px 14px 12px 38px; }
  .tool-desc { white-space: pre-wrap; font-family: inherit; font-size: 0.88rem; color: #c9d1d9; line-height: 1.5; margin-bottom: 8px; }
  .meta { font-size: 0.78rem; color: #8b949e; margin-top: 4px; }
  code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.78rem; }
</style>
</head>
<body>
  <h1>🛠️ HooshiX MCP — Tool Reference</h1>
  <p class="subtitle">${tools.length} tools in ${TOOL_CATEGORIES.length} categories · <a href="/tools">Flat list</a> · <a href="/dashboard">Dashboard</a> · <a href="/health">Health</a></p>
  ${sections}
</body>
</html>`;
}

function getToolDescription(tool: ToolName): string {
  const descriptions: Record<string, string> = {
    get_system_info: "Get OS, CPU, memory, and disk info about the local machine.",
    agent_metrics: "View recovery, tool reliability, and performance dashboard.",
    list_directory: "List files and directories inside the active workspace.",
    read_file: "Read a file (relative or absolute path). Returns text content.",
    write_file: "Write content to a file. Overwrites if exists. Returns backupId for undo.",
    create_file: "Create a new file. Fails if already exists. Returns backupId.",
    modify_file: "Find-and-replace text in a file. Returns backupId for undo.",
    delete_file: "Delete a file after creating a backup. Returns backupId.",
    restore_file: "Restore a file from a backupId returned by write/create/modify/delete.",
    search_files: "Search text inside workspace files. Returns matching file paths.",
    execute_command: "Execute a whitelisted command (node, npm, pnpm, git, python, py, gh).",
    git_status: "Show git working tree status.",
    git_diff: "Show git diff (staged or unstaged).",
    git_clone: "Clone an HTTPS repo into the workspace.",
    git_commit: "Commit staged changes with a message.",
    git_branch: "Create a new git branch.",
    git_checkout: "Switch to an existing branch or create a new one.",
    git_add: "Stage files for the next commit.",
    git_init: "Initialize a new git repository.",
    git_log: "Show recent commit history.",
    install_package: "Install a package via npm, pnpm, pip, winget, or choco.",
    remove_package: "Remove a package via npm, pnpm, pip, winget, or choco.",
    update_package: "Update a package via npm, pnpm, pip, winget, or choco.",
    package_restore: "Restore package manifests from a snapshot id.",
    task_snapshot: "Capture a git snapshot of a workspace before a task runs.",
    task_rollback: "Reset a workspace to its pre-task git snapshot (destructive).",
    set_workspace: "Select the active workspace from the allowed roots pool (pure selector — cannot expand file-tool scope).",
    get_workspace: "View the active workspace and the allowed roots pool.",
    remove_workspace_root: "📂 WORKSPACE — Remove one directory from the allowed workspace roots pool.",
    add_workspace_roots: "📂 WORKSPACE — Add one or more directories to the allowed workspace roots pool (idempotent).",
    // Management tools registered via tools/task (not step-executable, so absent from TOOL_CAPABILITIES):
    task_create: "🗂️ TASK — Persist an explicit multi-step plan. Lifecycle: task_create → task_run → (approval?) task_approve → task_resume → task_report.",
    task_get: "🗂️ TASK (read) — Full task object: state, steps with statuses/outputs/errors, pending approval info.",
    task_list: "🗂️ TASK (read) — Recent task summaries: ids, titles, statuses.",
    task_run: "🗂️ TASK — Execute a task's next unfinished steps sequentially; templates auto-resolve; transient failures retry with backoff.",
    task_approve: "🗂️ TASK — Human approval for a paused high-risk step. Single-use; follow with task_resume.",
    task_resume: "🗂️ TASK — Consume an approval and continue the paused task from its exact step. Exactly-once.",
    task_report: "🗂️ TASK (read) — Step statuses, unified execution/recovery timeline, reflection, metrics.",
    task_replay: "🗂️ TASK — Re-execute a copy of a task and compare outputs (reproducibility testing).",
    task_cancel: "🗂️ TASK — Cancel a non-running task and revoke its unconsumed approvals.",
    task_append_steps: "🗂️ TASK — Add corrective steps to a failed/completed/cancelled task.",
    task_link: "🗂️ TASK — Record a causal link between two tasks (repair, recovery, follow_up…).",
    task_links: "🗂️ TASK (read) — A task's causal links: upstream and downstream.",
    task_step_risks: "🗂️ TASK (read) — Dry-run risk analysis: which planned steps will require approval.",
    project_save: "📁 CONTEXT — Create or update a project record (name, path, description, last/next action).",
    project_get: "📁 CONTEXT (read) — Fetch one project record by id.",
    project_delete: "📁 CONTEXT — Permanently delete a project record by id.",
    project_archive: "📁 CONTEXT — Soft-archive a project (status → 'archived').",
    project_list: "📁 CONTEXT (read) — List project records, paginated; filter by status.",
    memory_add: "🧠 MEMORY — Store a categorized note for a project or task.",
    memory_list: "🧠 MEMORY (read) — List stored memory notes; filter by taskId, projectId, or kind; paginated.",
    memory_get: "🧠 MEMORY (read) — Fetch one memory record by id.",
    memory_delete: "🧠 MEMORY — Permanently delete one memory record by id.",
  };
  return descriptions[tool] ?? tool;
}

const RISK_COLORS: Record<string, string> = {
  low: "#3fb950",
  medium: "#d29922",
  high: "#f85149",
  critical: "#da3633",
};

function toolsPage(): string {
  const tools = toolsList();
  const grouped: Record<string, ToolInfo[]> = {};
  for (const tool of tools) {
    const group = RISK_COLORS[tool.risk] ? `${tool.risk}` : "other";
    (grouped[group] ??= []).push(tool);
  }
  const riskOrder = ["low", "medium", "high", "critical"];

  let toolCards = "";
  for (const risk of riskOrder) {
    const group = grouped[risk];
    if (!group || group.length === 0) continue;
    toolCards += `<h2 style="color:${RISK_COLORS[risk]};margin-top:24px;text-transform:capitalize">${escapeHTML(risk)} Risk (${group.length})</h2>`;
    for (const tool of group) {
      const metrics = mcpMetrics.getSnapshot().tools[tool.name];
      const calls = metrics?.calls ?? 0;
      const errors = metrics?.errors ?? 0;
      const avgMs = metrics?.avgMs ?? 0;
      toolCards += `
      <div class="section" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong style="font-size:1rem;color:#58a6ff">${escapeHTML(tool.name)}</strong>
            <span class="badge" style="background:${RISK_COLORS[tool.risk]};color:#fff;margin-left:8px">${tool.risk}</span>
          </div>
          <span style="color:#8b949e;font-size:0.8rem">${calls} calls · ${errors} errors · ${avgMs}ms avg</span>
        </div>
        <p style="margin:8px 0 4px;color:#c9d1d9;font-size:0.9rem">${escapeHTML(tool.description)}</p>
        ${tool.requiredArguments.length > 0 ? `<p style="font-size:0.8rem;color:#8b949e">Required: <code style="background:#0d1117;padding:2px 6px;border-radius:4px">${tool.requiredArguments.join(", ")}</code></p>` : ''}
        <p style="font-size:0.8rem;color:#8b949e">Capabilities: ${tool.capabilities.map((c) => `<code style="background:#0d1117;padding:2px 6px;border-radius:4px;margin-right:4px">${c}</code>`).join('')}</p>
      </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HooshiX MCP Tools</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 20px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #58a6ff; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 20px; }
  .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>🛠️ HooshiX MCP Tools</h1>
  <p class="subtitle">${tools.length} tools available · <a href="/dashboard">Dashboard</a> · <a href="/health">Health</a> · <a href="/tools">Tools (JSON)</a></p>
  ${toolCards}
</body>
</html>`;
}

interface DashboardFilters {
  toolFilter?: string;
  statusFilter?: string;
  fromFilter?: string;
  toFilter?: string;
  taskIdFilter?: string;
}

function getDistinctToolNames(): string[] {
  try {
    return withAgentDatabase((db) => {
      const rows = db.prepare("SELECT DISTINCT tool FROM tool_calls ORDER BY tool").all() as Array<{ tool: string }>;
      return rows.map((r) => r.tool);
    });
  } catch {
    return [];
  }
}

function buildFilterQuery(base: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function dashboardPage(snapshot: ReturnType<typeof mcpMetrics.getSnapshot>, dbMetrics: ReturnType<typeof getAgentMetrics>, toolNames: string[], page: number, pageSize: number, filters: DashboardFilters = {}): string {
  const tokenSource = process.env.MCP_ACCESS_TOKEN
    ? "env MCP_ACCESS_TOKEN"
    : fs.existsSync(TOKEN_FILE)
      ? ".token file"
      : "auto-generated";
  const maskedToken = maskToken(currentAccessToken);
  const toolRows = Object.entries(snapshot.tools)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([name, stats]) => `
      <tr>
        <td><a href="/dashboard?tool=${encodeURIComponent(name)}" style="color:#58a6ff;text-decoration:none">${escapeHTML(name)}</a></td>
        <td>${stats.calls}</td>
        <td>${stats.errors}</td>
        <td>${stats.avgMs}ms</td>
        <td>${stats.calls > 0 ? ((1 - stats.errors / stats.calls) * 100).toFixed(1) + '%' : 'N/A'}</td>
      </tr>`)
    .join("");
  // Use database-backed recent calls with pagination
  const recentRows = dbMetrics.recentCalls
    .map((c) => `
      <tr>
        <td>${c.success ? '✅' : '❌'}</td>
        <td><a href="/dashboard?tool=${encodeURIComponent(c.tool)}" style="color:#58a6ff;text-decoration:none">${escapeHTML(c.tool)}</a></td>
        <td>${c.durationMs}ms</td>
        <td>${c.sessionId.slice(0, 8)}</td>
        <td>${c.taskId ? c.taskId.slice(0, 8) : '-'}</td>
        <td>${new Date(c.timestamp).toLocaleTimeString()}</td>
      </tr>`)
    .join("");
  const totalPages = Math.ceil(dbMetrics.pagination.total / pageSize);
  
  // Build filter query base for pagination links
  // Map DashboardFilters keys to URL param names
  const fq = (extra: Record<string, string>) => {
    const base: Record<string, string> = { ...extra };
    if (filters.toolFilter) base.tool = filters.toolFilter;
    if (filters.statusFilter) base.status = filters.statusFilter;
    if (filters.fromFilter) base.from = filters.fromFilter;
    if (filters.toFilter) base.to = filters.toFilter;
    if (filters.taskIdFilter) base.taskId = filters.taskIdFilter;
    // Remove empty values
    for (const k of Object.keys(base)) { if (!base[k]) delete base[k]; }
    return buildFilterQuery(base);
  };
  
  // Full pagination with page numbers
  let paginationHtml = '';
  if (totalPages > 1) {
    const pages: string[] = [];
    // Smart page range: show first, last, and ±2 around current
    const addPage = (n: number) => {
      const isActive = n === page;
      const style = isActive
        ? 'background:#58a6ff;color:#fff;padding:4px 10px;border-radius:4px;font-weight:600'
        : 'color:#58a6ff;padding:4px 8px';
      pages.push(isActive ? `<span style="${style}">${n}</span>` : `<a href="/dashboard${fq({ page: String(n) })}" style="${style};text-decoration:none">${n}</a>`);
    };
    const addEllipsis = () => pages.push('<span style="color:#484f58;padding:4px 4px">…</span>');
    
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) addPage(i);
    } else {
      addPage(1);
      if (page > 3) addEllipsis();
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) addPage(i);
      if (page < totalPages - 2) addEllipsis();
      addPage(totalPages);
    }
    
    paginationHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:10px 0;border-top:1px solid #30363d">
      <span style="color:#8b949e;font-size:0.85rem">${dbMetrics.pagination.total} total calls</span>
      <div style="display:flex;align-items:center;gap:4px">
        ${page > 1 ? `<a href="/dashboard${fq({ page: String(page - 1) })}" style="color:#58a6ff;padding:4px 8px">← Prev</a>` : '<span style="color:#30363d;padding:4px 8px">← Prev</span>'}
        ${pages.join('')}
        ${page < totalPages ? `<a href="/dashboard${fq({ page: String(page + 1) })}" style="color:#58a6ff;padding:4px 8px">Next →</a>` : '<span style="color:#30363d;padding:4px 8px">Next →</span>'}
      </div>
    </div>`;
  }
  
  // Active filter badges
  const activeFilters: string[] = [];
  if (filters.toolFilter) activeFilters.push(`<span class="badge" style="background:#1f6feb;color:#fff">tool: ${escapeHTML(filters.toolFilter)} <a href="/dashboard${fq({ tool: '' })}" style="color:#fff;margin-left:4px">✕</a></span>`);
  if (filters.statusFilter) activeFilters.push(`<span class="badge" style="background:#1f6feb;color:#fff">status: ${escapeHTML(filters.statusFilter)} <a href="/dashboard${fq({ status: '' })}" style="color:#fff;margin-left:4px">✕</a></span>`);
  if (filters.fromFilter) activeFilters.push(`<span class="badge" style="background:#1f6feb;color:#fff">from: ${escapeHTML(filters.fromFilter)} <a href="/dashboard${fq({ from: '' })}" style="color:#fff;margin-left:4px">✕</a></span>`);
  if (filters.toFilter) activeFilters.push(`<span class="badge" style="background:#1f6feb;color:#fff">to: ${escapeHTML(filters.toFilter)} <a href="/dashboard${fq({ to: '' })}" style="color:#fff;margin-left:4px">✕</a></span>`);
  if (filters.taskIdFilter) activeFilters.push(`<span class="badge" style="background:#1f6feb;color:#fff">task: ${escapeHTML(filters.taskIdFilter.slice(0,8))} <a href="/dashboard${fq({ taskId: '' })}" style="color:#fff;margin-left:4px">✕</a></span>`);
  const filterBadgesHtml = activeFilters.length > 0 ? `<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">${activeFilters.join('')} <a href="/dashboard" style="color:#f85149;font-size:0.8rem;text-decoration:none">Clear all</a></div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>HooshiX MCP Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 20px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #58a6ff; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .card-label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-value { font-size: 1.6rem; font-weight: 600; margin-top: 4px; }
  .card-value.green { color: #3fb950; }
  .card-value.blue { color: #58a6ff; }
  .card-value.yellow { color: #d29922; }
  .card-value.red { color: #f85149; }
  .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .section h2 { font-size: 1rem; margin-bottom: 12px; color: #c9d1d9; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; color: #8b949e; font-weight: 500; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; }
  tr:hover { background: #1c2128; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
  .badge-green { background: #238636; color: #fff; }
  .badge-yellow { background: #9e6a03; color: #fff; }
  .token-box { font-family: monospace; background: #0d1117; padding: 8px 12px; border-radius: 6px; border: 1px solid #30363d; display: inline-block; margin-top: 4px; }
  .refresh-note { color: #8b949e; font-size: 0.75rem; text-align: right; }
  .empty { color: #8b949e; font-style: italic; padding: 20px; text-align: center; }
</style>
</head>
<body>
  <h1>🔌 HooshiX MCP Dashboard</h1>
  <p class="subtitle">Server monitoring &amp; metrics — auto-refreshes every 10s</p>

  <div class="section">
    <h2>🔍 Filter Calls</h2>
    <form id="filterForm" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
      <div><label style="display:block;font-size:0.75rem;color:#8b949e;margin-bottom:2px">Tool</label>
        <select id="filterTool" style="background:#0d1117;color:#e1e4e8;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:0.85rem">
          <option value="">All tools</option>
          ${toolNames.map((t) => `<option value="${t}"${filters.toolFilter === t ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div><label style="display:block;font-size:0.75rem;color:#8b949e;margin-bottom:2px">Status</label>
        <select id="filterStatus" style="background:#0d1117;color:#e1e4e8;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:0.85rem">
          <option value="">All</option>
          <option value="success"${filters.statusFilter === 'success' ? ' selected' : ''}>✅ Success</option>
          <option value="failed"${filters.statusFilter === 'failed' ? ' selected' : ''}>❌ Failed</option>
        </select></div>
      <div><label style="display:block;font-size:0.75rem;color:#8b949e;margin-bottom:2px">From</label>
        <input type="date" id="filterFrom" value="${escapeHTML(filters.fromFilter ?? '')}" style="background:#0d1117;color:#e1e4e8;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:0.85rem"></div>
      <div><label style="display:block;font-size:0.75rem;color:#8b949e;margin-bottom:2px">To</label>
        <input type="date" id="filterTo" value="${escapeHTML(filters.toFilter ?? '')}" style="background:#0d1117;color:#e1e4e8;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:0.85rem"></div>
      <button type="submit" style="background:#238636;color:#fff;border:0;border-radius:6px;padding:6px 16px;font-size:0.85rem;cursor:pointer">Apply</button>
      <a href="/dashboard" style="color:#8b949e;font-size:0.85rem;text-decoration:none;padding:6px 8px">Reset</a>
    </form>
    <script>
    document.getElementById('filterForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var p = new URLSearchParams();
      var t = document.getElementById('filterTool').value;
      var s = document.getElementById('filterStatus').value;
      var f = document.getElementById('filterFrom').value;
      var o = document.getElementById('filterTo').value;
      if (t) p.set('tool', t);
      if (s) p.set('status', s);
      if (f) p.set('from', f);
      if (o) p.set('to', o);
      window.location.href = '/dashboard' + (p.toString() ? '?' + p.toString() : '');
    });
    </script>
  </div>

  ${filterBadgesHtml}

  <div class="grid">
    <div class="card">
      <div class="card-label">Status</div>
      <div class="card-value green">● Online</div>
    </div>
    <div class="card">
      <div class="card-label">Uptime</div>
      <div class="card-value blue">${formatUptime(snapshot.uptime)}</div>
    </div>
    <div class="card">
      <div class="card-label">Active Sessions</div>
      <div class="card-value blue">${snapshot.sessions.active}</div>
    </div>
    <div class="card">
      <div class="card-label">Total Tool Calls</div>
      <div class="card-value blue">${snapshot.toolCalls.total}</div>
    </div>
    <div class="card">
      <div class="card-label">Success Rate</div>
      <div class="card-value ${snapshot.toolCalls.total > 0 && parseFloat(snapshot.toolCalls.successRate) >= 95 ? 'green' : snapshot.toolCalls.total > 0 ? 'yellow' : 'blue'}">${snapshot.toolCalls.total > 0 ? snapshot.toolCalls.successRate : 'N/A'}</div>
    </div>
    <div class="card">
      <div class="card-label">Avg Response</div>
      <div class="card-value blue">${snapshot.performance.avgDurationMs}ms</div>
    </div>
  </div>

  <div class="section">
    <h2>🔑 Token Info</h2>
    <table>
      <tr><th style="width:120px">Source</th><td>${escapeHTML(tokenSource)}</td></tr>
      <tr><th>Token</th><td><span class="token-box">${maskedToken}</span></td></tr>
      <tr><th>PID</th><td>${process.pid}</td></tr>
      <tr><th>Port</th><td>${PORT}</td></tr>
      ${PUBLIC_BASE_URL ? `<tr><th>Public URL</th><td><a href="${escapeHTML(PUBLIC_BASE_URL)}" style="color:#58a6ff">${escapeHTML(PUBLIC_BASE_URL)}</a></td></tr>` : ''}
    </table>
  </div>

  <div class="section">
    <h2>📊 Performance</h2>
    <div class="grid" style="margin-bottom:0">
      <div class="card">
        <div class="card-label">P95 Latency</div>
        <div class="card-value blue">${snapshot.performance.p95DurationMs}ms</div>
      </div>
      <div class="card">
        <div class="card-label">P99 Latency</div>
        <div class="card-value blue">${snapshot.performance.p99DurationMs}ms</div>
      </div>
      <div class="card">
        <div class="card-label">Peak Concurrent</div>
        <div class="card-value blue">${snapshot.sessions.peakConcurrent}</div>
      </div>
      <div class="card">
        <div class="card-label">Failed Calls</div>
        <div class="card-value ${snapshot.toolCalls.failed > 0 ? 'red' : 'green'}">${snapshot.toolCalls.failed}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>🛠️ Tool Usage</h2>
    ${toolRows
      ? `<table>
      <thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Avg Duration</th><th>Success</th></tr></thead>
      <tbody>${toolRows}</tbody>
    </table>`
      : '<div class="empty">No tool calls yet</div>'}
  </div>

  <div class="section">
    <h2>📋 Recent Calls</h2>
    ${recentRows
      ? `<table>
      <thead><tr><th>Status</th><th>Tool</th><th>Duration</th><th>Session</th><th>Task</th><th>Time</th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table>${paginationHtml}`
      : '<div class="empty">No recent calls</div>'}
  </div>

  <p class="refresh-note">Auto-refreshes every 10 seconds · <a href="/health" style="color:#58a6ff">Health</a> · <a href="/metrics" style="color:#58a6ff">Metrics (JSON)</a> · <a href="/tools" style="color:#58a6ff">Tools</a></p>
</body>
</html>`;
}

function authorizePage(query: Record<string, string>, _base: string): string {
  const hidden = {
    redirect_uri: query.redirect_uri ?? "",
    state: query.state ?? "",
    code_challenge: query.code_challenge ?? "",
    code_challenge_method: "S256",
    client_id: query.client_id ?? "",
    resource: query.resource ?? "",
    scope: query.scope ?? "",
    response_type: "code",
  };
  const fields = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHTML(k)}" value="${escapeHTML(String(v))}">`)
    .join("\n");

  return `<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
<title>HooshiX Brain — تأیید دسترسی</title>
<style>body{font-family:Tahoma;background:#101418;color:#eee;display:flex;
justify-content:center;align-items:center;height:100vh;margin:0}
.box{background:#1a2027;padding:32px;border-radius:12px;width:380px}
input{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:1px solid #345}
button{width:100%;padding:12px;background:#0a7c43;color:#fff;border:0;
border-radius:8px;font-size:16px;cursor:pointer}</style></head><body>
<div class="box"><h3>HooshiX Brain MCP</h3>
<p>ChatGPT درخواست دسترسی به سیستم شما را دارد.<br>
کلید دسترسی را وارد کنید:</p>
<form method="post" action="/oauth/authorize">
${fields}
<input type="password" name="pin" placeholder="کلید دسترسی (http_token.txt)" required>
<button type="submit">اجازه دسترسی</button></form></div></body></html>`;
}

async function handleAuthorizePOST(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  oauth: OAuthProvider,
  base: string,
): Promise<void> {
  try {
    const body = await readBody(req);
    const form = Object.fromEntries(new URLSearchParams(body.toString("utf-8")));
    const query = Object.fromEntries(url.searchParams);

    const redirectUri = form.redirect_uri ?? query.redirect_uri ?? "";
    const state = form.state ?? query.state ?? "";
    const challenge = form.code_challenge ?? query.code_challenge ?? "";
    const clientId = form.client_id ?? query.client_id ?? "";
    const resource = form.resource ?? query.resource ?? "";
    const pin = form.pin ?? "";

    if (!validRedirectURI(redirectUri)) { sendHTML(res, 400, "invalid redirect_uri"); return; }
    if (resource !== `${base}/mcp`) { sendHTML(res, 400, "invalid resource"); return; }
    if (!clientId) { sendHTML(res, 400, "client_id missing"); return; }
    if (!challenge) { sendHTML(res, 400, "PKCE S256 required"); return; }

    if (!pin) {
      sendHTML(res, 200, authorizePage({ ...query, ...form }, base));
      return;
    }

    if (pin !== currentAccessToken) {
      sendHTML(res, 403, "<h3>کلید اشتباه است</h3>");
      return;
    }

    // Timing-safe comparison for the PIN (it is the master token)
    {
      const supplied = Buffer.from(pin);
      const expected = Buffer.from(currentAccessToken);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        sendHTML(res, 403, "<h3>کلید اشتباه است</h3>");
        return;
      }
    }

    const code = oauth.issueCode(challenge, resource, redirectUri, clientId);
    const sep = redirectUri.includes("?") ? "&" : "?";
    const params = new URLSearchParams({ code });
    if (state) params.set("state", state);
    res.writeHead(302, { Location: `${redirectUri}${sep}${params.toString()}` });
    res.end();
  } catch {
    sendHTML(res, 500, "oauth error");
  }
}

async function handleTokenPOST(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  oauth: OAuthProvider,
): Promise<void> {
  try {
    const body = await readBody(req);
    const form = Object.fromEntries(new URLSearchParams(body.toString("utf-8")));
    const grantType = form.grant_type ?? "authorization_code";

    let tokenResponse: Record<string, unknown> | null = null;
    if (grantType === "authorization_code") {
      tokenResponse = oauth.exchange(form.code, form.code_verifier, form.resource, form.redirect_uri, form.client_id);
    } else if (grantType === "refresh_token") {
      tokenResponse = oauth.refresh(form.refresh_token, form.resource);
    } else {
      sendJSON(res, 400, { error: "unsupported_grant_type" });
      return;
    }

    if (!tokenResponse) {
      sendJSON(res, 400, { error: "invalid_grant" });
      return;
    }
    sendJSON(res, 200, tokenResponse);
  } catch {
    sendJSON(res, 500, { error: "token_error" });
  }
}

async function handleRegisterPOST(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(req);
    const registration = JSON.parse(body.toString("utf-8"));
    const redirectUris = registration.redirect_uris;

    if (!Array.isArray(redirectUris) || !redirectUris.length || !redirectUris.every(validRedirectURI)) {
      sendJSON(res, 400, { error: "invalid_client_metadata" });
      return;
    }

    sendJSON(res, 201, {
      client_id: `hooshix-auto-${crypto.randomBytes(8).toString("base64url")}`,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  } catch {
    sendJSON(res, 400, { error: "invalid_client_metadata" });
  }
}

export function startHttpServer(): Promise<void> {
  currentAccessToken = loadToken();
  const accessToken = currentAccessToken;
  const source = process.env.MCP_ACCESS_TOKEN
    ? "env MCP_ACCESS_TOKEN"
    : fs.existsSync(TOKEN_FILE)
      ? ".token file"
      : "auto-generated + saved";

  const oauth = new OAuthProvider(accessToken);

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        await handleRequest(req, res, oauth);
      } catch (error) {
        console.error("MCP HTTP error:", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal server error");
        }
      }
    });

    server.listen(PORT, () => {
      console.error(`HooshiX MCP HTTP server running on http://localhost:${PORT}/mcp`);
      console.error(`Token source: ${source}`);
      // Do NOT print the raw token to logs — use the masked form instead.
      console.error(`Access token: ${maskToken(accessToken)} (full token in ${process.env.MCP_ACCESS_TOKEN ? "env MCP_ACCESS_TOKEN" : TOKEN_FILE})`);
      if (PUBLIC_BASE_URL) {
        console.error(`Public base URL: ${PUBLIC_BASE_URL}`);
      }
      resolve();
    });
  });
}
