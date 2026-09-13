# Configuration & Operations Runbook Specification

**Primary findings:** HIGH-11, HIGH-12, MED-15, MED-16, MED-29, LOW-05/12.  
**Goal:** one executable configuration contract and one production runbook for local stdio and local HTTP (public exposure delegated to an external deployment project).

---

## 1. Configuration architecture

All configuration is loaded once by `src/infrastructure/config/**`, validated, then passed as typed immutable `AppConfig` into composition.

Forbidden after cutover:
- scattered `process.env` reads;
- dead `config/config.json`;
- adapter-specific fallback env names;
- silent unknown/stale config variables for security-sensitive options.

Example:

```ts
interface AppConfig {
  runtimeMode: "stdio" | "http";
  environment: "development" | "test" | "production";
  permissionCeiling: PermissionLevel;
  workspaceDefaults: WorkspaceBootstrapConfig;
  security: SecurityConfig;
  oauth: OAuthConfig;
  http?: HttpConfig;
  database: DatabaseConfig;
  retention: RetentionConfig;
  limits: LimitsConfig;
  observability: ObservabilityConfig;
}
```

---

## 2. Canonical environment variables

Final names should use one `HOOSHIX_` namespace. Suggested contract:

- `HOOSHIX_MODE=stdio|http`
- `HOOSHIX_ENV=development|test|production`
- `HOOSHIX_PERMISSION_LEVEL=READ_ONLY|PROJECT_ACCESS|DEVELOPER_MODE|ADMIN_MODE`
- `HOOSHIX_WORKSPACE=<path>`
- `HOOSHIX_ALLOW_UNRESTRICTED=false|true`
- `HOOSHIX_BOOTSTRAP_TOKEN=<secret>` or file-based secret alternative
- `HOOSHIX_PUBLIC_BASE_URL=https://...`
- `HOOSHIX_HTTP_HOST=127.0.0.1|...`
- `HOOSHIX_HTTP_PORT=3001`
- `HOOSHIX_ALLOWED_ORIGINS=https://...,...`
- `HOOSHIX_DB_PATH=<path>`
- `HOOSHIX_LOG_DIR=<path>`
- `HOOSHIX_RETENTION_*` class-specific values
- `HOOSHIX_ACCESS_TOKEN_TTL_SECONDS`
- `HOOSHIX_REFRESH_TOKEN_TTL_SECONDS`
- `HOOSHIX_RATE_LIMIT_*`
- `HOOSHIX_SEARCH_MAX_AGGREGATE_BYTES`
- `HOOSHIX_TERMINATION_GRACE_MS`
- `HOOSHIX_LEASE_TTL_MS`
- `HOOSHIX_LEASE_HEARTBEAT_MS`

Exact final names are chosen in ADR/config implementation, but no duplicate aliases persist beyond a documented migration window.

---

## 3. Legacy variable policy

### `MCP_API_KEY`
Fail startup with a migration error. Do not silently ignore.

### `MCP_ACCESS_TOKEN`
If compatibility is needed for one migration release, treat only as deprecated bootstrap-secret alias, emit warning, and never return it as OAuth access token. Remove on scheduled cutoff.

### `MCP_PUBLIC_BASE_URL`
May be accepted temporarily as alias for `HOOSHIX_PUBLIC_BASE_URL` with explicit deprecation; final docs use one name.

### `config/config.json`
Remove or migrate to typed config input. An inert file is forbidden.

---

## 4. Validation/fail-fast rules

Production HTTP startup fails if:
- public/external binding without trusted public base URL;
- invalid/unknown permission value;
- unrestricted enabled without explicit server allowance;
- bootstrap secret too short/placeholder/default;
- stale `MCP_API_KEY` present;
- DB/log/data directories unusable;
- lease heartbeat >= lease TTL;
- access/refresh TTL outside safe configured bounds;
- wildcard CORS configured for public authenticated HTTP;
- unsupported MCP protocol/SDK combination configured.

Warnings are insufficient for security-critical contradictions.

---

## 5. Effective configuration logging

At startup log safe effective configuration:
- mode/environment;
- HTTP bind and canonical public URL;
- permission ceiling;
- workspace root count/paths only if path disclosure is acceptable locally; for public logs prefer count + hashed IDs;
- unrestricted capability enabled/disabled;
- token source **type** (`env|file|generated`) but never value;
- DB path in local operator logs if acceptable, not public response;
- retention/limits summary;
- MCP supported protocol eras;
- Node/pnpm/app version.

Never log secret/token values.

---

## 6. Supported operating modes

### 6.1 Local stdio

- no OAuth HTTP auth;
- local OS/user trust + server permission ceiling;
- stable local application context;
- workspace explicitly configured/pinned;
- same application authorization/tool gateway still applies.

### 6.2 Local HTTP

- bind loopback by default;
- OAuth/issued access token model still used if HTTP protected interface is enabled;
- public base URL may use localhost semantics according to MCP/OAuth requirements;
- rate/session bounds active.

### 6.3 Network-exposed HTTP (optional, handled by external deployment)

- production mode;
- canonical HTTPS public base URL required;
- host/origin validation;
- OAuth security fully enabled;
- bootstrap secret protected;
- TLS termination and public exposure are owned by an external deployment project (reverse proxy, tunnel, or gateway). HooshiX itself binds loopback by default; no tunnel/Caddy/VPS artifacts live in this repository;
- any network-exposed deployment must pass the release checklist.

Do not maintain multiple incompatible “production” instructions.

---

## 7. Health/diagnostic operations

### Public unauthenticated
- `/health/live`
- `/health/ready` with minimal status only.

### Authenticated diagnostics
- metrics;
- runtime/config summary without secrets;
- unresolved reconciliations;
- DB/migration/retention status;
- supported MCP versions.

Never use bootstrap/access token in query string.

---

## 8. Token/bootstrap secret operations

Provide operator commands/scripts for:
- generate/reset bootstrap token;
- verify token file permissions;
- revoke all OAuth access/refresh tokens if operator requests global security reset;
- rotate bootstrap without silently changing issued-token state unless documented;
- inspect token metadata IDs/expiry without raw values.

No script contains a reusable default secret.

---

## 9. Database operations

Runbook sections:
- locate DB from effective config;
- stop/quiesce service before manual backup where required;
- create consistent backup;
- verify integrity;
- run migration dry/preflight on a copy;
- start upgraded version;
- verify readiness/migration version;
- restore backup if migration/cutover fails according to document 23.

Never instruct operators to delete WAL/SHM or database files while service is live without a verified procedure.

---

## 10. Recovery operations

Operator flow for `outcome_unknown`:
1. inspect task report and safe receipt metadata;
2. run automatic reconciliation when supported;
3. if manual required, inspect external state using safe dedicated tools;
4. choose confirm-succeeded/confirm-failed/abandon/new task according to use case;
5. action audited;
6. never blindly reset step to pending.

Runbook explicitly documents at-least-once risk avoidance and no exactly-once promise.

---

## 11. Git/package compensation operations

- Git snapshot/rollback requires clean snapshot contract.
- Package compensation called “manifest restore” unless verified environment reversal.
- Historical file restore requires approval/revision semantics.

User-facing operational text must match implementation terms exactly.

---

## 12. Service/watchdog bootstrap

Windows service/scheduled-task/watchdog must:
- use explicit Node executable or deterministic PATH initialization;
- verify Node version before launch;
- invoke built production entrypoint, not dev command;
- use one canonical config/env file or service environment;
- not embed secrets in command line where process listings/logs expose them;
- restart with sane backoff to avoid overlapping processes over same DB;
- verify existing process ownership before starting a second runtime.

If watchdog overlap remains possible, durable execution lease still protects task effects but service deployment should prevent duplicate runtime accidentally.

---

## 13. Network-exposed deployment boundary

HooshiX does not ship tunnel/proxy/TLS assets. Public exposure is owned by a separate deployment project that fronts this server. The contract this repository must satisfy:

```text
client -> external edge (TLS, owned elsewhere) -> local HooshiX HTTP (loopback bind)
```

Requirements on the HooshiX side:
- bind loopback by default; do not expose the local bind to LAN/Internet directly;
- public URL config exactly matches externally visible resource/issuer URLs (`MCP_PUBLIC_BASE_URL`);
- Authorization and MCP protocol headers pass through the edge unchanged;
- the edge must not log bearer values.

---

## 14. Incident response quick procedures

### Suspected token leak
- rotate/revoke affected access/refresh tokens;
- if bootstrap compromised, rotate bootstrap and revoke issued token families as policy;
- inspect security events without exposing secrets;
- invalidate dashboard sessions;
- verify query-string token path is absent.

### Unknown task outcome
- stop retries;
- inspect reconciliation state;
- do not delete evidence/backups;
- reconcile before resume.

### Database issue
- stop writes safely;
- backup current files;
- integrity check copy;
- use documented restore, not ad hoc file deletion.

### External edge outage
- verify local `/health/live`;
- verify the external deployment project's edge (out of scope for this repository);
- never weaken auth/CORS/host validation merely to restore service.

---

## 15. Operations acceptance tests

1. clean production env starts with one documented command.
2. stale `MCP_API_KEY` causes clear startup failure.
3. literal/default weak secret rejected.
4. supported Node/pnpm detected in service-like non-interactive environment.
5. public bind without base URL fails.
6. liveness works without auth; metrics require proper auth/scope.
7. Docker and watchdog use the same canonical config names.
8. token reset script creates secure file mode on POSIX fixture.
9. recovery manual flow can resolve a fixture unknown outcome without raw SQL/editing DB.
10. docs commands validated in CI/smoke where feasible.

---

## 16. Definition of done

- one typed config loader;
- one canonical env namespace;
- no dead config file;
- one production runbook;
- stale auth variables/default secrets fail visibly;
- non-interactive service bootstrap resolves correct Node/pnpm;
- public URL/host/CORS/health contracts are fail-closed and tested;
- operator procedures exist for token rotation, DB backup/migration, unknown outcomes and incident response.