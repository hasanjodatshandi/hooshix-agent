import { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { StreamableHTTPServerTransport } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { registerTools } from "./registry.js";
import { toolDocsPage, toolsPage, dashboardPage, authorizePage, getDistinctToolNames, toolsList } from "./pages.js";
import { OAuthProvider, OAUTH_SCOPES } from "./oauth.js";
import { mcpMetrics } from "./metrics.js";
import { createMetricsServer } from "./metrics-server.js";
import { getAgentMetrics } from "../core/trace/metrics-service.js";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import {loadAppConfig} from "../infrastructure/config/app-config.js";
import { createSessionWorkspaceContext, runWithSessionWorkspace, type SessionWorkspaceContext } from "../security/workspace-guard.js";
import { runWithTrustedInboundIdentity } from "../core/runtime/r2-trusted-inbound-identity.js";
import type { PrincipalId, SessionId } from "../domain/shared/ids.js";
import {OperatorWebSessions,HttpWindowLimiter,HttpPrincipalContexts} from "../infrastructure/server/http-security.js";
import {installGracefulShutdown} from "../infrastructure/server/graceful-shutdown.js";
import {isDatabaseReady,closeAgentDatabase} from "../core/memory/database/index.js";
import {createMcpHandler} from "@modelcontextprotocol/server";
import {toNodeHandler} from "@modelcontextprotocol/node";
// R7.01: the HTTP transport never reads environment variables directly; the
// single immutable AppConfig contract owns that boundary (runtime mode is the
// only transport-specific input and is passed explicitly here).
const APP_CONFIG=loadAppConfig(undefined,undefined,"http");
const CONFIG=APP_CONFIG.http;
const PORT=CONFIG.port;
const PUBLIC_BASE_URL=CONFIG.publicBaseUrl;
let oauthProviderRef:OAuthProvider|null=null;
const TOKEN_FILE=APP_CONFIG.bootstrapTokenFile;
/** Bootstrap is an operator-only credential. It is never accepted as MCP bearer. */
function loadToken():string{
  const supplied=APP_CONFIG.bootstrapToken;
  if(supplied){
    if(Buffer.byteLength(supplied,"utf8")<32)throw new Error("HOOSHIX_BOOTSTRAP_TOKEN requires at least 32 bytes");
    return supplied;
  }
  try {
    const stat=fs.lstatSync(TOKEN_FILE);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error("unsafe bootstrap secret file");
    if(process.platform!=="win32"&&(stat.mode&0o077)!==0)
      throw new Error("insecure bootstrap secret file: expected 0600");
    const current=fs.readFileSync(TOKEN_FILE,"utf8").trim();
    if(Buffer.byteLength(current,"utf8")<32)throw new Error("insecure bootstrap secret length");
    return current;
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  }
  const generated=crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(TOKEN_FILE,generated,{flag:"wx",mode:0o600,encoding:"utf8"});
  return generated;
}
// R7.01: session, rate-limit and concurrency budgets come from the single
// immutable AppConfig contract, not duplicated module constants.
const SESSION_GRACE_MS = APP_CONFIG.session.graceMs;
const SESSION_IDLE_MS = APP_CONFIG.session.idleMs;
const SESSION_ABSOLUTE_MS = APP_CONFIG.session.absoluteMs;
const MAX_MCP_SESSIONS = APP_CONFIG.session.maxMcpSessions;
const operatorSessions=new OperatorWebSessions(undefined,
  APP_CONFIG.session.idleMs,APP_CONFIG.session.absoluteMs,APP_CONFIG.session.operatorCap);
const publicLimiter=new HttpWindowLimiter(APP_CONFIG.rateLimit.publicRequestsPerWindow,
  APP_CONFIG.rateLimit.windowMs,undefined,APP_CONFIG.rateLimit.maxLimiterKeys);
const principalLimiter=new HttpWindowLimiter(APP_CONFIG.rateLimit.principalRequestsPerWindow,
  APP_CONFIG.rateLimit.windowMs,undefined,APP_CONFIG.rateLimit.maxLimiterKeys);
const operatorLoginLimiter=new HttpWindowLimiter(APP_CONFIG.rateLimit.operatorLoginAttemptsPerWindow,
  APP_CONFIG.rateLimit.windowMs,undefined,APP_CONFIG.rateLimit.maxLimiterKeys);
const MAX_CONCURRENT_REQUESTS_PER_PRINCIPAL = APP_CONFIG.rateLimit.maxConcurrentRequestsPerPrincipal;
// The legacy POST path caps bodies via readBody(); the modern /mcp handler lets
// the SDK read the stream itself, so bound it here by content-length to keep an
// oversized JSON-RPC batch from being buffered fully into memory.
const MAX_MCP_BODY_BYTES = 1_000_000;
const expensiveInflight=new Map<string,number>();

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  readonly workspace: SessionWorkspaceContext;
  readonly principalBinding: string;
  closedAt?: number;
  readonly createdAt: number;
  lastActiveAt: number;
}

const sessions = new Map<string, SessionEntry>();
/** 2026 protocol is per request; application workspace selection is a
 * bounded, authenticated principal+client context, NOT an MCP session ID. */
const modernContexts=new HttpPrincipalContexts<SessionWorkspaceContext>(undefined,
  APP_CONFIG.session.idleMs,APP_CONFIG.session.absoluteMs,APP_CONFIG.session.contextCap);
const modernHandler=toNodeHandler(createMcpHandler(()=>createServer(),{legacy:"reject"}));


/**
 * Clean up sessions that have been closed for longer than the grace period.
 * Called periodically to prevent unbounded memory growth.
 */
function cleanupStaleSessions():void{
  const now=Date.now();
  for(const [id,entry] of sessions){
    if(now-entry.createdAt>=SESSION_ABSOLUTE_MS||now-entry.lastActiveAt>=SESSION_IDLE_MS||
       (entry.closedAt!==undefined&&now-entry.closedAt>=SESSION_GRACE_MS)){
      sessions.delete(id);
      void entry.transport.close().catch(()=>{});
      mcpMetrics.recordSessionClosed(id);
    }
  }
  operatorSessions.prune();
}
setInterval(cleanupStaleSessions,APP_CONFIG.session.cleanupIntervalMs).unref?.();

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
  const url = new URL(req.url ?? "/", CONFIG.publicBaseUrl);
  if(url.origin!==CONFIG.publicBaseUrl){sendJSON(res,400,{error:"invalid_request_target"});return;}

  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";
  oauthProviderRef = oauth;
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Frame-Options","DENY");
  if(url.searchParams.has("token")||url.searchParams.has("access_token")){
    sendJSON(res,400,{error:"credentials_in_query_forbidden"});return;
  }
  const origin=req.headers.origin;
  if(origin){
    if(origin!==CONFIG.publicBaseUrl&&!CONFIG.allowedOrigins.includes(origin)){
      sendJSON(res,403,{error:"origin_not_allowed"});return;
    }
    res.setHeader("Vary","Origin");
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Access-Control-Allow-Methods","GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Mcp-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers","Mcp-Session-Id");
  }
  if(method==="OPTIONS"){
    if(!origin){sendJSON(res,403,{error:"origin_required"});return;}
    res.writeHead(204);res.end();return;
  }
  const remoteIp=req.socket.remoteAddress??"unknown";
  if(path.startsWith("/oauth/")||path.startsWith("/.well-known/")||path.startsWith("/operator/")){
    const limit=publicLimiter.allow(remoteIp);
    if(!limit.allowed){res.setHeader("Retry-After",String(limit.retryAfter));sendJSON(res,429,{error:"rate_limited"});return;}
  }

  if (path === "/health/live") {sendJSON(res,200,{status:"ok"});return;}
  if (path === "/health/ready") {
    const ready=isDatabaseReady();
    sendJSON(res,ready?200:503,{status:ready?"ready":"not_ready"});
    return;
  }
  // Historical /health is deliberately protected; use /health/live for probes.
  if (path === "/health") {
    if(!authorizeMonitoringRequest(req,url,res))return;
    sendJSON(res,200,{status:"ok"});return;
  }
  if(path==="/operator/login" && method==="GET"){
    sendHTML(res,200,`<!doctype html><html><head><meta charset="utf-8"></head><body><form method="post" action="/operator/login"><label>Operator secret<input type="password" autocomplete="off" name="secret" required></label><button type="submit">Sign in</button></form></body></html>`);return;
  }
  if(path==="/operator/login" && method==="POST"){
    const loginRate=operatorLoginLimiter.allow(remoteIp);
    if(!loginRate.allowed){res.setHeader("Retry-After",String(loginRate.retryAfter));sendJSON(res,429,{error:"login_rate_limited"});return;}
    if(origin&&origin!==CONFIG.publicBaseUrl){sendJSON(res,403,{error:"origin_not_allowed"});return;}
    const supplied=new URLSearchParams((await readBody(req,4096)).toString("utf8")).get("secret")??"";
    if(!oauth.verifyBootstrapSecret(supplied)){sendJSON(res,403,{error:"invalid_operator_secret"});return;}
    try{
      const session=operatorSessions.issue();
      res.setHeader("Set-Cookie",`hx_operator=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${CONFIG.publicBaseUrl.startsWith("https:")?"; Secure":""}`);
      res.setHeader("Location","/dashboard");res.writeHead(303);res.end();
    }catch{sendJSON(res,429,{error:"operator_session_limit"});}
    return;
  }
  if(path==="/operator/logout" && method==="POST"){
    if(origin&&origin!==CONFIG.publicBaseUrl){sendJSON(res,403,{error:"origin_not_allowed"});return;}
    const token=operatorCookie(req),session=operatorSessions.get(token);
    const form=new URLSearchParams((await readBody(req,4096)).toString("utf8"));
    if(!session||form.get("csrf")!==session.csrf){sendJSON(res,403,{error:"invalid_csrf"});return;}
    operatorSessions.close(token);
    res.setHeader("Set-Cookie","hx_operator=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    res.writeHead(204);res.end();return;
  }

  // Metrics endpoint — supports ?taskId=uuid&tool=X&status=X&from=X&to=X&limit=N&offset=N
  if (path === "/metrics") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    // R-N2: an OAuth client granted the monitoring scope must only see its own
    // rows. The operator-cookie session keeps the full unscoped view.
    const monitoringClaims=oauthProviderRef?.tokenClaims(req.headers.authorization,CONFIG.resource);
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
        principalId: monitoringClaims?.principalId,
      });
      sendJSON(res, 200, { ...mcpMetrics.getSnapshot(), database: dbMetrics });
    }
    return;
  }

  // Dashboard — supports ?page=N&tool=X&status=X&from=X&to=X for filtering
  if (path === "/dashboard" || path === "/dashboard/") {
    if (!authorizeMonitoringRequest(req, url, res)) return;
    // R-N2: same scoping as /metrics — OAuth clients see only their own rows.
    const monitoringClaims=oauthProviderRef?.tokenClaims(req.headers.authorization,CONFIG.resource);
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
      principalId: monitoringClaims?.principalId,
    });
    // Get distinct tool names from database for the filter dropdown
    const toolNames = getDistinctToolNames();
    sendHTML(res, 200, dashboardPage(snapshot, dbMetrics, toolNames, page, pageSize, { toolFilter, statusFilter, fromFilter, toFilter, taskIdFilter },operatorSessions.get(operatorCookie(req))?.csrf,{port:PORT,publicBaseUrl:PUBLIC_BASE_URL}));
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

  // Protected Resource Metadata (RFC 9728) and trusted AS discovery.
  if(path==="/.well-known/oauth-authorization-server"||path==="/.well-known/openid-configuration"){
    const base=CONFIG.publicBaseUrl;
    sendJSON(res,200,{
      issuer:base,authorization_endpoint:base+"/oauth/authorize",
      token_endpoint:base+"/oauth/token",registration_endpoint:base+"/oauth/register",
      response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],
      scopes_supported:[...OAUTH_SCOPES],code_challenge_methods_supported:["S256"],
      token_endpoint_auth_methods_supported:["none"],authorization_response_iss_parameter_supported:true
    });return;
  }
  if(path==="/.well-known/oauth-protected-resource"||path==="/.well-known/oauth-protected-resource/mcp"){
    sendJSON(res,200,{
      resource:CONFIG.resource,authorization_servers:[CONFIG.publicBaseUrl],
      scopes_supported:["hooshix:read"],bearer_methods_supported:["header"]
    });return;
  }
  if(path==="/oauth/authorize"){
    if(method==="GET"){
      const query=Object.fromEntries(url.searchParams);
      if(query.resource!==CONFIG.resource||query.response_type!=="code"||
         query.code_challenge_method!=="S256"||
         !/^[a-zA-Z0-9_-]{43}$/.test(query.code_challenge??"")||
         !validRedirectURI(query.redirect_uri??"")||!query.client_id||
         query.client_id.length>256){sendJSON(res,400,{error:"invalid_request"});return;}
      if(!oauth.isRegisteredClientRedirect(query.client_id,query.redirect_uri)){sendJSON(res,400,{error:"invalid_registered_client"});return;}
      // Chrome sends Origin: null for a same-origin form under no-referrer.
      // Keep consent page navigation same-origin without exposing the OAuth
      // request URL as a referrer to any cross-origin destination.
      res.setHeader("Referrer-Policy","same-origin");
      sendHTML(res,200,authorizePage(query,CONFIG.publicBaseUrl));return;
    }
    if(method==="POST"){await handleAuthorizePOST(req,res,url,oauth,CONFIG.publicBaseUrl);return;}
  }
  if(path==="/oauth/token"&&method==="POST"){await handleTokenPOST(req,res,oauth);return;}
  if(path==="/oauth/register"&&method==="POST"){await handleRegisterPOST(req,res,oauth);return;}

  // --- MCP endpoint ---
  if (path !== "/mcp") {
    sendJSON(res, 404, { error: "not found" });
    return;
  }

  const grant=oauth.tokenClaims(req.headers.authorization,CONFIG.resource);
  if(!grant){
    // R-N1: unauthenticated requests never reach the principal limiter, so
    // cap them by IP here. A token flood must not pin the DB shard with
    // unbounded SHA-256 + SQLite lookups.
    const preAuth=publicLimiter.allow(remoteIp);
    if(!preAuth.allowed){res.setHeader("Retry-After",String(preAuth.retryAfter));sendJSON(res,429,{error:"rate_limited"});return;}
    const metadata=CONFIG.publicBaseUrl+"/.well-known/oauth-protected-resource";
    res.setHeader("WWW-Authenticate",`Bearer resource_metadata="${metadata}", scope="hooshix:read"`);
    sendJSON(res,401,{error:"invalid_token"});return;
  }
  const quota=principalLimiter.allow(grant.principalId+":"+grant.clientId);
  if(!quota.allowed){
    res.setHeader("Retry-After",String(quota.retryAfter));
    sendJSON(res,429,{error:"rate_limited"});return;
  }
  const principalBinding=crypto.createHash("sha256")
    .update(grant.principalId+"|"+grant.clientId+"|"+grant.resource)
    .digest("hex");
  const verifiedGrant=grant;
  const grantedScopes=verifiedGrant.scopes;
  const permission=({READ_ONLY:"READ",PROJECT_ACCESS:"PROJECT_ACCESS",DEVELOPER_MODE:"DEVELOPER",ADMIN_MODE:"ADMIN"} as const)[APP_CONFIG.permissionLevel];
  function runAuthorizedSession<T>(sessionId:string,entry:SessionEntry,operation:()=>T):T{
    entry.lastActiveAt=Date.now();
    return runWithTrustedInboundIdentity({
      principal:{id:verifiedGrant.principalId as PrincipalId,permission,origin:"http_oauth",scopes:grantedScopes},
      sessionId:sessionId as SessionId,
    },()=>runWithSessionWorkspace(entry.workspace,operation));
  }
  // Global bounded concurrency for expensive protected MCP requests.
  const count=expensiveInflight.get(principalBinding)??0;
  if(count>=MAX_CONCURRENT_REQUESTS_PER_PRINCIPAL){res.setHeader("Retry-After","1");sendJSON(res,429,{error:"concurrency_limited"});return;}
  expensiveInflight.set(principalBinding,count+1);
  let released=false;
  const release=()=>{
    if(released)return;released=true;
    const current=expensiveInflight.get(principalBinding)??1;
    if(current<=1)expensiveInflight.delete(principalBinding);
    else expensiveInflight.set(principalBinding,current-1);
  };
  res.once("finish",release);res.once("close",release);
  cleanupStaleSessions();
  if(req.headers["mcp-protocol-version"]==="2026-07-28"){
    if(method!=="POST"){sendJSON(res,405,{error:"modern_post_only"});return;}
    // Bound the modern request body the same way the legacy readBody path does.
    const declared=req.headers["content-length"];
    if(declared!==undefined&&Number(declared)>MAX_MCP_BODY_BYTES){
      sendJSON(res,413,{error:"payload_too_large"});return;
    }
    // R-N3: a chunked body has no content-length, so enforce the same cap by
    // tracking the bytes the SDK actually reads and aborting on overflow.
    if(declared===undefined){
      let received=0,aborted=false;
      req.on("data",(chunk:Buffer)=>{
        received+=chunk.length;
        if(!aborted&&received>MAX_MCP_BODY_BYTES){
          aborted=true;
          req.destroy(new Error("payload_too_large"));
        }
      });
    }
    let context:SessionWorkspaceContext;
    try{context=modernContexts.get(principalBinding,createSessionWorkspaceContext);}
    catch{res.setHeader("Retry-After","1");sendJSON(res,429,{error:"modern_context_limit"});return;}
    await runWithTrustedInboundIdentity({
      principal:{id:verifiedGrant.principalId as PrincipalId,permission,origin:"http_oauth",scopes:grantedScopes},
      sessionId:principalBinding as SessionId,
    },()=>runWithSessionWorkspace(context,()=>modernHandler(req,res)));
    return;
  }
  const requestedSessionId = req.headers["mcp-session-id"] as string | undefined;
  if (requestedSessionId && sessions.has(requestedSessionId) &&
      sessions.get(requestedSessionId)!.principalBinding !== principalBinding) {
    sendJSON(res, 403, {error:"session_principal_mismatch"});
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
    await runAuthorizedSession(sessionId,entry, () => entry.transport.handleRequest(req, res));
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
        // Register the close hook BEFORE connect: a close that fires between
        // connect() and the assignment would otherwise be missed and the session
        // would leak (never marked closed, never reaped by the grace sweeper).
        newTransport.onclose = () => {
          mcpMetrics.recordSessionClosed(existingSessionId);
          entry.closedAt = Date.now();
          console.error(`🔌 MCP session_closed id=${existingSessionId.slice(0, 8)} (grace=${SESSION_GRACE_MS / 1000}s)`);
        };
        await entry.server.connect(newTransport);
      }
      // Ensure Accept header includes both types (required by MCP Streamable HTTP spec)
      const accept = req.headers.accept ?? "";
      if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
        req.headers.accept = [accept, "application/json", "text/event-stream"]
          .filter(Boolean)
          .join(", ");
      }
      await runAuthorizedSession(existingSessionId,entry, () => entry.transport.handleRequest(req, res));
      return;
    }

    // Create new session
    const sessionId = crypto.randomUUID();
    const server = createServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: true,
    });

    if(sessions.size>=MAX_MCP_SESSIONS){sendJSON(res,429,{error:"session_limit_reached"});return;}
    sessions.set(sessionId, { transport, server, workspace: createSessionWorkspaceContext(), principalBinding, createdAt:Date.now(), lastActiveAt:Date.now() });

    // Register the close hook BEFORE connect for the same reason as the
    // reconnect path: a close during connect() must not slip past the handler.
    transport.onclose = () => {
      mcpMetrics.recordSessionClosed(sessionId);
      const entry = sessions.get(sessionId);
      if (entry) {
        entry.closedAt = Date.now();
      }
      console.error(`🔌 MCP session_closed id=${sessionId.slice(0, 8)} (grace=${SESSION_GRACE_MS / 1000}s)`);
    };

    await server.connect(transport);

    // Ensure Accept header includes both types (required by MCP Streamable HTTP spec)
    const accept = req.headers.accept ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      req.headers.accept = [accept, "application/json", "text/event-stream"]
        .filter(Boolean)
        .join(", ");
    }

    // Forward the initial request under its new, isolated workspace selection.
    const entry = sessions.get(sessionId)!;
    await runAuthorizedSession(sessionId,entry, () => transport.handleRequest(req, res));

    // Log session creation after transport processes the body
    mcpMetrics.recordSessionCreated(sessionId);
    console.error(`🔌 MCP session_created id=${sessionId.slice(0, 8)}`);

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

function operatorCookie(req:http.IncomingMessage):string|undefined{
  const raw=req.headers.cookie??"";
  const value=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith("hx_operator="));
  return value?.slice("hx_operator=".length);
}
/** Query credentials and master/bootstrap tokens are never HTTP bearer auth. */
function authorizeMonitoringRequest(req:http.IncomingMessage,_url:URL,res:http.ServerResponse):boolean{
  const session=operatorSessions.get(operatorCookie(req));
  if(session && (req.method==="GET"||req.method==="HEAD"))return true;
  const claims=oauthProviderRef?.tokenClaims(req.headers.authorization,CONFIG.resource);
  if(claims?.scopes.includes("hooshix:monitoring:read"))return true;
  const metadata=CONFIG.publicBaseUrl+"/.well-known/oauth-protected-resource";
  res.setHeader("WWW-Authenticate",`Bearer resource_metadata="${metadata}", scope="hooshix:monitoring:read"`);
  sendJSON(res,claims?403:401,{error:claims?"insufficient_scope":"invalid_token"});
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

    if (!validRedirectURI(redirectUri) || !oauth.isRegisteredClientRedirect(clientId,redirectUri)) { sendHTML(res, 400, "invalid_registered_redirect_uri"); return; }
    if (resource !== `${base}/mcp`) { sendHTML(res, 400, "invalid resource"); return; }
    if (!clientId || clientId.length>256 || form.response_type!=="code") { sendHTML(res, 400, "invalid_client"); return; }
    if (!/^[a-zA-Z0-9_-]{43}$/.test(challenge)) { sendHTML(res, 400, "PKCE S256 required"); return; }

    if (!pin) {
      sendHTML(res, 200, authorizePage({ ...query, ...form }, base));
      return;
    }

    if (!oauth.verifyBootstrapSecret(pin)) {
      sendHTML(res, 403, "<h3>کلید اشتباه است</h3>");
      return;
    }

    const requestedScopes=(form.scope??"").split(/\s+/).filter(Boolean);
    // Explicitly selected permissions may supplement an offline_access-only
    // request. Neither a refresh grant nor a missing checkbox grants tools.
    const optionalGrants:ReadonlyArray<readonly [string,string]>=[
      ["grant_read","hooshix:read"],
      ["grant_workspace","hooshix:workspace:manage"],
      ["grant_tasks","hooshix:task:manage"],
      ["grant_write","hooshix:project:write"],
      ["grant_execute","hooshix:execute"],
      ["grant_monitoring","hooshix:monitoring:read"],
    ];
    const selectedScopes=optionalGrants.filter(([field])=>form[field]==="yes").map(([,scope])=>scope);
    const approvedScopes=[...new Set([...requestedScopes,...selectedScopes])];
    if(form.code_challenge_method!=="S256") {sendHTML(res,400,"PKCE S256 required");return;}
    const code = oauth.issueCode(challenge, resource, redirectUri, clientId,approvedScopes);
    const sep = redirectUri.includes("?") ? "&" : "?";
    const params = new URLSearchParams({ code });
    params.set("iss",base);
    if (state) params.set("state", state);
    res.writeHead(302, { Location: `${redirectUri}${sep}${params.toString()}` });
    res.end();
  } catch (error) {
    // Log the cause: these failures used to be silent 500s, which made a
    // broken OAuth flow invisible. Thrown messages are constant domain strings
    // (never the submitted form or credentials), so logging them is safe.
    console.error("[oauth] authorize failed:", error instanceof Error ? error.message : String(error));
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
    if(form.resource!==CONFIG.resource){sendJSON(res,400,{error:"invalid_target_resource"});return;}

    let tokenResponse: Record<string, unknown> | null = null;
    if (grantType === "authorization_code") {
      tokenResponse = oauth.exchange(form.code, form.code_verifier, form.resource, form.redirect_uri, form.client_id);
    } else if (grantType === "refresh_token") {
      tokenResponse = oauth.refresh(form.refresh_token, form.resource,form.client_id);
    } else {
      sendJSON(res, 400, { error: "unsupported_grant_type" });
      return;
    }

    if (!tokenResponse) {
      sendJSON(res, 400, { error: "invalid_grant" });
      return;
    }
    sendJSON(res, 200, tokenResponse);
  } catch (error) {
    console.error("[oauth] token exchange failed:", error instanceof Error ? error.message : String(error));
    sendJSON(res, 500, { error: "token_error" });
  }
}

async function handleRegisterPOST(
  req:http.IncomingMessage,res:http.ServerResponse,oauth:OAuthProvider
):Promise<void>{
  try{
    const raw=await readBody(req,4096);
    const registration=JSON.parse(raw.toString("utf8")) as {redirect_uris?:unknown};
    const redirectUris=registration.redirect_uris;
    if(!Array.isArray(redirectUris)||redirectUris.length<1||redirectUris.length>8||
       !redirectUris.every(u=>typeof u==="string"&&validRedirectURI(u))||
       new Set(redirectUris).size!==redirectUris.length){
      sendJSON(res,400,{error:"invalid_client_metadata"});return;
    }
    const id=oauth.registerClient(redirectUris);
    sendJSON(res,201,{client_id:id,redirect_uris:redirectUris,
      token_endpoint_auth_method:"none",grant_types:["authorization_code"],response_types:["code"]});
  }catch(error){
    // Distinguish an expected malformed-metadata rejection from an unexpected
    // internal failure: both used to collapse into a silent 400, hiding real
    // bugs behind a client-error response.
    console.error("[oauth] register failed:", error instanceof Error ? error.message : String(error));
    sendJSON(res,400,{error:"invalid_client_metadata"});
  }
}

export function startHttpServer():Promise<void>{
  const bootstrap=loadToken();
  const oauth=new OAuthProvider(bootstrap,{settings:APP_CONFIG.oauth});
  return new Promise((resolve,reject)=>{
    const server=http.createServer(async(req,res)=>{
      try{await handleRequest(req,res,oauth);}
      catch(error){
        // Do not log credential-bearing URLs, raw headers, or POST form bodies.
        console.error("MCP HTTP handler error:",error instanceof Error?error.name:"unknown");
        if(!res.headersSent)sendJSON(res,500,{error:"internal_server_error"});
        else if(!res.writableEnded)res.end();
      }
    });
    server.once("error",(error:NodeJS.ErrnoException)=>{
      oauth.destroy();
      reject(new Error(error.code==="EADDRINUSE"?
        `MCP port ${PORT} is already in use`:
        `MCP listener startup failed: ${error.code??"unknown"}`));
    });
    server.listen(PORT,CONFIG.host,()=>{
      console.error(`HooshiX MCP HTTP listener ready on ${CONFIG.host}:${PORT} (public resource: ${CONFIG.resource})`);
      resolve();
    });
    server.on("close",()=>oauth.destroy());
    // H2: own SIGTERM/SIGINT — drain in-flight requests before the database is
    // closed and the process exits, instead of process.exit(0) mid-handler.
    installGracefulShutdown(server,{onShutdown:closeAgentDatabase});
  });
}