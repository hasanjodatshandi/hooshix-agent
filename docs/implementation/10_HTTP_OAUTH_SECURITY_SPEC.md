# HTTP & OAuth Security Redesign Specification

**Primary findings:** HIGH-04, HIGH-11, HIGH-12, MED-01, MED-03, MED-29, LOW token-file hardening.  
**Reference baseline:** current MCP authorization specification (2025-11-25 at documentation preparation), RFC 9700 OAuth 2.0 Security BCP, RFC 8707 Resource Indicators, RFC 9728 Protected Resource Metadata.

---

## 1. Security goals

1. The bootstrap/operator secret is **not** an MCP client access token.
2. OAuth access tokens have enforceable expiry, resource/audience and scope.
3. Refresh tokens rotate and replay is detectable.
4. MCP bearer credentials are accepted in Authorization headers only.
5. HTTP public URL/issuer is configured, not Host-header derived.
6. Public endpoints are rate limited.
7. Health probes work without exposing authentication secrets.
8. Dashboard/browser authentication does not put a master token in URLs/HTML.
9. HTTP session state is bounded and cleaned.
10. Transport authorization maps to a typed Principal used by the common application authorization layer.

---

## 2. Secret/token taxonomy

### 2.1 Bootstrap operator secret

Purpose:
- prove local/operator authority when approving OAuth authorization or opening the operator dashboard login flow.

Properties:
- generated random secret if not supplied;
- stored in `.token` or renamed canonical bootstrap file;
- POSIX mode 0600;
- never returned as OAuth `access_token` or `refresh_token`;
- never accepted through URI query;
- never exposed to child-process environment by default;
- rotation invalidates operator login but does not necessarily require raw-token equality with client tokens because client tokens are separate records.

Recommended canonical config name:
- `HOOSHIX_BOOTSTRAP_TOKEN` (preferred new name), with an explicit migration policy for old `MCP_ACCESS_TOKEN`.

`MCP_API_KEY` must not be silently ignored. If present, startup fails with a clear migration message.

### 2.2 Access token

Opaque random token:
- >= 32 random bytes before encoding;
- raw value returned once to client;
- only hash persisted;
- default lifetime: 3600 seconds (configurable within safe bounds);
- bound to client, resource and scopes;
- revocable.

### 2.3 Refresh token

Opaque random token:
- high entropy;
- hash persisted;
- token family ID + generation;
- default absolute lifetime e.g. 30 days, configurable;
- **one-time rotation**: successful refresh consumes current generation and creates next;
- reuse of consumed generation => replay response and family revocation/lock according to policy.

### 2.4 Authorization code

- high entropy random value;
- one-time;
- five-minute default expiry;
- PKCE S256 required;
- client/redirect/resource/scopes bound;
- stored in memory or repository behind `AuthorizationCodeStorePort`; multi-process HTTP would require shared storage.

---

## 3. Token persistence schema behavior

Persist hashes, not raw tokens.

Access record:

```text
id
hash
client_id
principal_id
resource
scopes_json
issued_at
expires_at
revoked_at
created_at
```

Refresh record:

```text
id
hash
family_id
generation
client_id
principal_id
resource
scopes_json
issued_at
expires_at
consumed_at
revoked_at
rotated_to_id
```

Indexes:
- unique token hash;
- access `expires_at` for cleanup;
- refresh `family_id,generation`;
- refresh `expires_at`.

Atomic refresh rotation transaction:
1. find hash;
2. require unconsumed/unrevoked/unexpired and matching client/resource;
3. mark consumed;
4. insert next generation;
5. commit;
6. return new raw access/refresh values.

Concurrent reuse must allow only one winner.

---

## 4. MCP authorization compliance targets

For HTTP MCP:

- access token via `Authorization: Bearer <token>` on every protected MCP request;
- no access token accepted in URI query string;
- Protected Resource Metadata endpoint implemented as required by current MCP specification;
- authorization server discovery metadata available;
- resource indicator required/validated for authorization and token flows where applicable;
- resource server validates that token is intended for the canonical MCP resource;
- invalid/expired token -> HTTP 401;
- insufficient scope -> HTTP 403;
- `WWW-Authenticate` metadata supplied as required for resource discovery/scope challenge behavior;
- PKCE S256;
- current redirect/client validation preserved or strengthened.

Current MCP SHOULD/MAY features (such as Client ID Metadata Documents vs DCR) should be evaluated against SDK/client interoperability during implementation. Mandatory current-spec requirements are release gates; optional registration mechanisms must not weaken security.

---

## 5. Scope design

Recommended scopes:

```text
hooshix:read
hooshix:project:write
hooshix:execute
hooshix:task:manage
hooshix:workspace:manage
hooshix:monitoring:read
hooshix:admin
```

Mapping examples:
- read/list/search/git status/log -> `hooshix:read`;
- file mutation/project memory write -> `hooshix:project:write`;
- command/Git/package execution -> `hooshix:execute`;
- task create/run/approve/resume -> `hooshix:task:manage` plus operation permission;
- workspace roots -> `hooshix:workspace:manage`; unrestricted additionally `hooshix:admin` + server ADMIN + approval;
- metrics/dashboard APIs -> `hooshix:monitoring:read`.

Scopes never override server permission ceiling.

---

## 6. HTTP route model

### Public unauthenticated

- `GET /health/live`
- `GET /health/ready`
- required OAuth metadata/discovery endpoints;
- OAuth authorize/token/register endpoints (protocol authentication/validation applies, rate-limited).

### Bearer protected

- `/mcp` transport requests;
- `/metrics` API;
- `/tools` machine-readable inventory if retained.

### Dashboard protected by operator web session

- `/dashboard` and dashboard API should use a dedicated server session cookie after operator authentication.

Do not use `?token=` for any long-lived credential.

---

## 7. Dashboard session security

If dashboard remains browser-accessible:

1. operator submits bootstrap secret through HTTPS POST form or approved local authentication flow;
2. server compares securely and creates random dashboard session ID;
3. cookie flags:
   - `Secure` in public HTTPS mode;
   - `HttpOnly`;
   - `SameSite=Strict`;
   - bounded Max-Age;
4. session idle timeout recommended 30 minutes;
5. absolute timeout recommended 8–24 hours according to operator workflow;
6. logout deletes server state/cookie;
7. CSRF protection for any state-changing dashboard endpoint;
8. bootstrap secret is never stored in cookie/session response.

Dashboard session scope is monitoring/operator UI, not automatically a reusable MCP bearer.

---

## 8. Rate limits

Limits are configurable through validated config and implemented by `RateLimiterPort`.

Recommended starting policy classes, not immutable constants:

### Public OAuth endpoints
- low per-IP request rate and small burst;
- stricter failed bootstrap/PIN attempts;
- temporary cooldown after repeated failures;
- DCR/registration bounded.

### Authenticated MCP
- generous envelope rate appropriate to personal agent use;
- per-principal and optionally per-IP tracking;
- separate concurrent expensive-tool limits managed at application execution layer.

### Sessions
- max active sessions per principal/config;
- idle/absolute TTL;
- closed session deletion from all maps/metrics.

429 response includes safe `Retry-After` where appropriate.

---

## 9. Canonical public URL and Host/CORS

### Public base URL

For public HTTP mode:
- canonical URL must come from validated configuration (`MCP_PUBLIC_BASE_URL` during migration or renamed field);
- startup fails if public mode binds externally but no trusted canonical base URL is configured;
- issuer/resource/redirect metadata does not derive from arbitrary request Host header.

### CORS

- configure explicit allowed origins;
- no wildcard `*` for browser authorization surface when Authorization headers are accepted;
- OPTIONS behavior explicit;
- non-browser MCP clients are unaffected by browser CORS enforcement.

---

## 10. Liveness/readiness contract

### `/health/live`

Purpose: Docker/service manager liveness.

Requirements:
- no auth;
- constant/minimal 200 while process event loop/server is alive;
- no token/path/config/version leakage.

### `/health/ready`

Purpose: readiness.

Checks:
- configuration valid;
- DB initialized/migrations complete;
- startup recovery/reconciliation initialization not fatally failed;
- optional adapter dependencies required for serving traffic initialized.

Response only `ok/ready` style status; detailed diagnostics remain authenticated.

Docker/Compose healthchecks use `/health/live` or `/health/ready` consistently.

---

## 11. Legacy migration policy

### `MCP_API_KEY`

New runtime: fail startup if set with message:

```text
MCP_API_KEY is unsupported. Use HOOSHIX_BOOTSTRAP_TOKEN (or documented canonical variable). The old value was never the current HTTP access-token contract.
```

Do not silently accept a stale variable.

### `MCP_ACCESS_TOKEN`

If backward compatibility is necessary for one migration release:
- interpret only as bootstrap operator secret alias;
- emit deprecation warning;
- never issue it as OAuth access token;
- disable legacy bearer acceptance by default;
- remove alias at defined cutover.

### `.token`

May remain as bootstrap-secret file for local operator compatibility, with explicit mode/ACL hardening.

---

## 12. OAuth/HTTP test plan

Use process-level E2E with fake clock where application tests permit.

Mandatory cases:

1. valid authorization code + S256 -> issued distinct access/refresh tokens.
2. access token raw value != bootstrap secret.
3. expired access token -> 401.
4. wrong resource/audience -> 401.
5. insufficient scope -> 403.
6. access token in query string -> rejected; header token accepted.
7. wrong PKCE verifier -> rejected.
8. authorization code reuse -> rejected.
9. redirect mismatch -> rejected.
10. client mismatch -> rejected.
11. refresh token rotation -> old consumed, new valid.
12. old refresh replay -> rejected and family response policy applied.
13. concurrent refresh use -> exactly one success.
14. revoked access token -> 401.
15. Host header does not alter issuer/public metadata.
16. CORS allowed origin works; unlisted origin does not receive permissive CORS.
17. OAuth endpoints rate limit abusive attempts.
18. health live/ready work without auth and contain no sensitive data.
19. `/metrics` requires monitoring scope/header.
20. dashboard URL/query never contains bootstrap/access token.
21. bootstrap token file permission test on POSIX-capable CI.

---

## 13. Security logging for OAuth

Log:
- auth code requested/issued/consumed (code ID/fingerprint only);
- token issued (token ID, client, resource, scopes, expiry — no raw token);
- token validation failure category;
- refresh rotation/replay/revocation;
- bootstrap login failures/successes;
- rate limits.

Do not log:
- raw bearer/access/refresh/bootstrap token;
- PKCE verifier;
- authorization code raw value;
- full sensitive query/body values.

---

## 14. Release acceptance

HTTP/OAuth redesign is complete only when:
- current HIGH-04/MED-01/MED-03/MED-29 regressions pass;
- current master-token-as-access-token code path no longer exists;
- query token path no longer exists;
- HTTP E2E is part of CI;
- healthcheck uses the final health contract;
- public base URL is fail-closed;
- token/session cleanup is bounded and retention tested;
- current MCP mandatory authorization requirements listed above pass interoperability tests with the supported client/SDK.