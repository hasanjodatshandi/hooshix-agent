import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./registry.js";
import { OAuthProvider } from "./oauth.js";
import { mcpMetrics } from "./metrics.js";
import { createMetricsServer } from "./metrics-server.js";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.env.MCP_PORT ?? "3001", 10);
const PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

// Current access token (set in startHttpServer)
let currentAccessToken = "";

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

  // Health check (no auth)
  if (path === "/health") {
    sendJSON(res, 200, {
      status: "ok",
      bridge: "running",
      pid: process.pid,
      tools_loaded: true,
    });
    return;
  }

  // Metrics endpoint (no auth)
  if (path === "/metrics") {
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/plain")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(mcpMetrics.getPrometheusMetrics());
    } else {
      sendJSON(res, 200, mcpMetrics.getSnapshot());
    }
    return;
  }

  // Dashboard (no auth)
  if (path === "/dashboard") {
    const snapshot = mcpMetrics.getSnapshot();
    sendHTML(res, 200, dashboardPage(snapshot));
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

function dashboardPage(snapshot: ReturnType<typeof mcpMetrics.getSnapshot>): string {
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
        <td>${escapeHTML(name)}</td>
        <td>${stats.calls}</td>
        <td>${stats.errors}</td>
        <td>${stats.avgMs}ms</td>
        <td>${stats.calls > 0 ? ((1 - stats.errors / stats.calls) * 100).toFixed(1) + '%' : 'N/A'}</td>
      </tr>`)
    .join("");
  const recentRows = snapshot.recentCalls
    .slice(0, 20)
    .map((c) => `
      <tr>
        <td>${c.success ? '✅' : '❌'}</td>
        <td>${escapeHTML(c.tool)}</td>
        <td>${c.durationMs}ms</td>
        <td>${c.sessionId.slice(0, 8)}</td>
        <td>${new Date(c.timestamp).toLocaleTimeString()}</td>
      </tr>`)
    .join("");

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
      <thead><tr><th>Status</th><th>Tool</th><th>Duration</th><th>Session</th><th>Time</th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table>`
      : '<div class="empty">No recent calls</div>'}
  </div>

  <p class="refresh-note">Auto-refreshes every 10 seconds · <a href="/health" style="color:#58a6ff">Health</a> · <a href="/metrics" style="color:#58a6ff">Metrics (JSON)</a></p>
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
      console.error(`Access token: ${accessToken}`);
      if (PUBLIC_BASE_URL) {
        console.error(`Public base URL: ${PUBLIC_BASE_URL}`);
      }
      resolve();
    });
  });
}
