# R7 local HTTP and container operations (feature-branch working runbook)

Status: R7 implementation document. This is NOT a production release or a replacement for the R9 final operations guide.

## Supported security contract

- Use Node.js 24 and pnpm 11.24.0; install with `pnpm install --frozen-lockfile`, then `pnpm run typecheck && pnpm run build`.
- The default local HTTP listener is `127.0.0.1:3001`. Start with `node dist/index-http.js` or `scripts/start_nodejs_mcp.bat` from a deliberately configured environment. Do not start another instance when the port already has an unowned listener.
- `GET /health/live` is unauthenticated and returns only `{"status":"ok"}`. `GET /health/ready` returns a minimal readiness result; `GET /health` is a protected monitoring endpoint, not the liveness probe.
- The bootstrap credential is an operator-only secret, NOT an MCP bearer/access token. The server accepts `HOOSHIX_BOOTSTRAP_TOKEN` (minimum 32 UTF-8 bytes), otherwise loads a securely generated local token file. Default file location for Windows/local mode: `.token` in the service working directory; container mode: `HOOSHIX_BOOTSTRAP_TOKEN_FILE=/app/data/.token`. Never copy a bootstrap secret into client `Authorization` headers. Use OAuth discovery and authorization code/PKCE for MCP clients; use the operator login for browser diagnostics.
- `MCP_API_KEY` and `MCP_ACCESS_TOKEN` are REMOVED legacy input names and cause explicit startup failure; eliminate them from host/service environments. Neither an empty legacy variable nor an old watchdog configuration is permitted.
- To use a trusted external TLS edge, explicitly set `HOOSHIX_PUBLIC_BASE_URL=https://your-approved-host` for the running process. Do not embed an endpoint or token in tracked scripts. Public exposure, TLS, authorization, rollback and workload qualification remain separate release gates.

## Unified typed configuration (R7.01)

- Every operational setting is parsed and validated exactly once by
  `loadAppConfig()` in `src/infrastructure/config/app-config.ts`, which returns a
  deeply frozen immutable contract. There is no other parsing path: the historical
  `readLegacy*` helpers are compatibility projections of the same parsers.
- Invalid or contradictory settings fail loudly at startup instead of being silently
  coerced or ignored. Examples: a non-integer `HOOSHIX_RETENTION_DAYS`, an OAuth access
  TTL that is not shorter than the refresh TTL, a session idle TTL that is not shorter
  than the absolute TTL, or a lease heartbeat that is not under half the lease TTL.
- Canonical names are the `HOOSHIX_*` variables. The deprecated HTTP aliases
  (`MCP_PORT`, `MCP_BIND_HOST`, `MCP_PUBLIC_BASE_URL`, `MCP_ALLOWED_ORIGINS`) still
  resolve for a migration window, but setting an alias AND its canonical name with
  DIFFERENT values is a hard startup error (`conflicting environment names`).
- The operator-tunable budgets that were previously hardcoded are now part of the
  contract and may be overridden without code changes, all defaulting to the previously
  shipped values: OAuth TTLs and limits (`HOOSHIX_OAUTH_*`), request budgets
  (`HOOSHIX_PUBLIC_RATE_LIMIT`, `HOOSHIX_PRINCIPAL_RATE_LIMIT`,
  `HOOSHIX_OPERATOR_LOGIN_RATE_LIMIT`, `HOOSHIX_RATE_LIMIT_WINDOW_MS`,
  `HOOSHIX_RATE_LIMIT_MAX_KEYS`, `HOOSHIX_MAX_CONCURRENT_REQUESTS`), session lifecycles
  (`HOOSHIX_SESSION_IDLE_MS`, `HOOSHIX_SESSION_ABSOLUTE_MS`, `HOOSHIX_SESSION_GRACE_MS`,
  `HOOSHIX_MAX_MCP_SESSIONS`, `HOOSHIX_OPERATOR_SESSION_LIMIT`,
  `HOOSHIX_MODERN_CONTEXT_LIMIT`), task lease tuning (`HOOSHIX_TASK_LEASE_TTL_MS`,
  `HOOSHIX_TASK_LEASE_HEARTBEAT_MS`) and search budgets (`HOOSHIX_SEARCH_MAX_*`).
- `HOOSHIX_RETENTION_DAYS=0` explicitly disables cleanup; a missing or invalid value
  fails startup. Reference: `tests/core/r7-unified-config.test.ts`.

## Docker / Compose

- `docker build -t hooshix-agent:reviewed .` uses frozen dependency resolution in BOTH build and runtime layers. The production image runs as user `node`; only `/app/data` is prepared as a writable persistent directory. Its SQLite path, logs and bootstrap file live there.
- Direct `docker run` without a configured HTTPS edge is for an INTERNAL local health/process smoke only: Docker's default in-container HTTP bind is loopback. Do not claim that publishing `-p` alone makes a secure or reachable remote MCP interface.
- For the existing Compose example, supply an approved external `HOOSHIX_PUBLIC_BASE_URL` through the operator environment. Compose binds the container to `0.0.0.0:3001` internally, but publishes only host `127.0.0.1:3001` for the separately managed TLS edge. Do NOT publish the container port publicly or expose the local HTTP backend directly to the Internet.
- Keep `mcp-data` persistent and protect its contents, including OAuth tokens, SQLite files and `.token`. Do not change/migrate live data to validate R7. Rehearse migration on a copy during G10.
- The Docker image base is pinned by digest to the exact Node line declared in `.nvmrc`:
  `node:24.18.0-slim@sha256:6f7b03f7…6951452d`. Digest provenance, the exact reference and the
  controlled base-image update procedure are recorded in
  `docs/implementation/R7_DEPLOYMENT_PINNING_2026-09-23.md`. Refresh the digest only through
  that procedure and re-run the container smoke gate afterwards; do not revert to a rolling tag.

## Windows watchdog / manual startup

- The watchdog probes unauthenticated `/health/live` and must NEVER pass the obsolete `MCP_ACCESS_TOKEN` variable into the server. The operator supplies an optional public base URL in the service environment. Check OS process ownership before stopping/restarting; unowned Node processes cannot be terminated by the watchdog.
- Both the watchdog and `scripts/start_nodejs_mcp.bat` validate the toolchain before launch
  (Node.js 24 line, pnpm `11.24.0`). The shared machine-independent gate is
  `node scripts/verify-runtime-versions.mjs`, which reads the same pins (`.nvmrc` and
  `package.json` `packageManager`) and exits non-zero on a wrong Node line, a missing pnpm,
  or a pnpm version mismatch. Its failure paths are executed by
  `tests/core/r7-runtime-version-gate.test.ts`.
- For manual local use, `scripts/start_nodejs_mcp.bat` resolves the project relative to its own location. The watchdog remains intentionally separate from release cutover and must not be restarted against active operational data merely to test these changes.
- An operator inspecting a token with `scripts/mcp-token.ps1 show` must keep the terminal output private. The generated/bootstrap secret is not a raw OAuth access token.

## Bootstrap token generation and rotation (R7.03)

The bootstrap secret is the single operator credential for the HTTP operator login
and the OAuth authorization confirmation page. It is never an MCP bearer token.

Generation (automatic, no operator action):

- If `HOOSHIX_BOOTSTRAP_TOKEN` is set, it must be at least 32 UTF-8 bytes or startup fails.
- Otherwise the server loads `HOOSHIX_BOOTSTRAP_TOKEN_FILE` (default `.token` in the
  service working directory; container default `/app/data/.token`). The file must be a
  regular file (symlinks are rejected), readable only by its owner (`0600` on POSIX) and
  contain at least 32 bytes; any violation aborts startup with a named error.
- If the file does not exist, the server generates a fresh 32-byte cryptographically
  random `base64url` token and writes it with mode `0600` and exclusive-create (`wx`),
  so an existing file is never silently clobbered.

Rotation procedure (execute against the target environment only; do NOT rotate the
active production credential without an authorized change window):

1. Stop the service through the mechanism that owns the process (the planned Windows
   service / Scheduled Task stop, or the operator process stop the watchdog performs
   via its internal `Stop-NodeProcesses` path). Confirm the process and its lock on the
   SQLite database are gone before proceeding; do not rotate while a writer is active.
2. Replace the token file content — write the new value into the same path with `0600`
   permissions, or set a new `HOOSHIX_BOOTSTRAP_TOKEN` (>= 32 bytes) in the service
   environment and remove the file variable. On POSIX use `install -m 600` or
   `chmod 600` after writing; never leave the secret world-readable.
3. Restart the service. Only the NEW credential is accepted from that point on.
   `tests/security/r7-bootstrap-secret-lifecycle.test.ts` proves this contract: after the
   file is replaced and the process restarts, the old secret is rejected (HTTP 403) and
   the new one is accepted.
4. Re-issue the credential to the operator and confirm the old copy is destroyed.
   Existing MCP client sessions are unaffected: MCP clients use OAuth
   authorization-code/PKCE grants, not the bootstrap secret.

Historical secret disposition:

- The retired static bootstrap credential that earlier setup guidance contained was
  removed from every active deployment surface (Dockerfile, Compose, watchdog,
  `start_nodejs_mcp.bat`, SETUP guide, runbook). It remains only as quoted historical
  evidence inside the consolidated audit document, which is deliberately not rewritten.
  If any environment ever used that retired literal as a real credential, it MUST be
  rotated using the procedure above before that environment is considered trusted; no
  automated code change can substitute for operator rotation.
- `scripts/r7-secret-policy-check.mjs` fail-closes CI on any reintroduction of the
  retired literal, any `MCP_API_KEY`/`MCP_ACCESS_TOKEN` assignment, query-string
  credential guidance, or a tracked `.token`/`.env`/`.db`/`.pem`/`.key` file.
- The bootstrap secret is never written to logs, command arguments, or health responses;
  the error handler logs only the error name, and `/health/live` returns only
  `{"status":"ok"}` (verified by the lifecycle test above).


## Validation and boundary

## Reference startup methods (one canonical path each)

- **stdio (default for local/MCP client integration):** `node dist/index.js`. This is
  the transport MCP clients use when they spawn the agent as a subprocess. There is no
  HTTP listener in this mode; the bootstrap/HTTP endpoints are irrelevant.
- **HTTP (local operator and remote client integration):** `node dist/index-http.js`.
  This is the only mode that exposes `/mcp`, `/health/*`, `/operator/login`,
  `/dashboard` and `/metrics`. Bind is loopback by default; an external endpoint REQUIRES
  a trusted HTTPS edge and `HOOSHIX_PUBLIC_BASE_URL`.
- Do not mix the two: choose the transport at startup via the entry point. Both load the
  same immutable `loadAppConfig()` contract, so no environment variable differs between
  them except transport-specific ones (`HOOSHIX_HTTP_*` are ignored by stdio).

## Outcome unknown recovery

A step is marked `outcome_unknown` when the process died or timed out mid-mutation and
the side effect may or may not have happened (crash recovery, timeout finalization and
package snapshot uncertainty all use this state). The original tool result stays unknown
and is never automatically replayed.

Resolution path (operator action required):

1. Inspect the task: `task_get` / `task_report` show which steps are unresolved and the
   recorded execution receipt (`termination: unknown`, `reconciliation: unresolved`).
2. Verify the real world effect independently (read the file, query the package, run a
   read-only command). Do not assume the step completed or failed.
3. Call `task_reconcile` with the step id and an explicit operator decision:
   `confirmed_succeeded` or `confirmed_failed` both require an independently completed
   read-only verification Task with the same owner; `safe_to_retry` additionally requires
   a durable idempotent `create_file` receipt.
4. Until reconciled, the task is frozen: `task_run`/`task_resume` refuse to proceed
   (`outcome_unknown_requires_reconciliation`) and `task_append_steps` is rejected.
   This is deliberate — replaying an uncertain mutation risks a duplicate side effect.

## Authentication, workspace and access troubleshooting

| Symptom | Meaning | Correct response |
|---|---|---|
| Startup fails `MCP_API_KEY is unsupported` / `MCP_ACCESS_TOKEN is deprecated` | A retired credential name is still in the host/service environment | Remove it; supply `HOOSHIX_BOOTSTRAP_TOKEN` (>= 32 bytes) or a token file |
| Startup fails `conflicting environment names` | A canonical name and its alias are both set with different values | Keep only the `HOOSHIX_*` canonical name |
| Startup fails `MCP_PUBLIC_BASE_URL required for external HTTP binding` | External bind without a trusted public origin | Set `HOOSHIX_PUBLIC_BASE_URL` to the exact HTTPS origin, or bind loopback |
| MCP client gets 401 `invalid_token` / 403 `insufficient_scope` | OAuth token missing, expired, wrong resource or insufficient scope | Re-run OAuth authorization-code/PKCE flow against `/mcp` resource; the bootstrap secret is NOT a client bearer and never goes in `Authorization` |
| MCP client gets 403 on a file/command tool | Path outside allowed roots, sensitive file, or an operation that needs approval | Add the root via `add_workspace_roots`, or create a task step and approve it (`task_approve` then `task_resume`) |
| `SECURITY_POLICY` / `blocked` status, `recoverable: false` | Denylist, workspace boundary or approval gate | Not retryable; change the request, not the retry count |
| HTTP 429 with `Retry-After` | Rate limit hit (public, principal or login limiter) | Back off by the header value; raise the `HOOSHIX_*_RATE_LIMIT` budgets only with justification |
| `/health` returns 401/403 but `/health/live` is 200 | Expected — `/health` is protected monitoring (operator session cookie or `hooshix:monitoring:read` scope) | Use `/health/live` for probes; authenticate via operator login or an OAuth token with the monitoring scope for `/health`, `/metrics`, `/dashboard` |

## Data backup, integrity check and restore

The authoritative state is the SQLite database at `HOOSHIX_DB_PATH` plus the audit JSONL
under `HOOSHIX_LOG_DIR`. Treat both as the unit of backup.

- **Backup (online-safe):** copy the database while the service is stopped, or use a
  filesystem snapshot. If the service must stay up, prefer a SQLite `VACUUM INTO` or an
  OS-level snapshot; a plain file copy of a WAL database may capture a torn state.
  Include the whole `HOOSHIX_LOG_DIR` and the bootstrap token file in the same backup set.
- **Integrity check:** `sqlite3 <db> "PRAGMA integrity_check;"` and `PRAGMA quick_check;`
  against the copied database before trusting any backup. The R0 release preflight
  (`pnpm run release:preflight`) performs the non-destructive source/build checks and
  `pnpm run release:db-rehearsal` rehearses migration **only on a backup copy**.
- **Restore:** stop the service, move the current database and logs aside (never delete),
  place the verified backup at `HOOSHIX_DB_PATH`, then start. Confirm task/step records
  and the tool catalog with `task_list`/`task_report` and `/tools` before resuming work.
- **Rehearse on a copy first:** never restore or migrate against the operational database
  to validate a change. The G10 migration exercise requires a copy of the current data.

## Public deployment boundary

This repository delivers the agent runtime only. TLS termination, the external tunnel and
any edge proxy belong to a SEPARATE deployment project and must NOT be added to this
repository or this branch without their own review:

- The in-repo HTTP listener binds loopback by default. Publishing `-p 3001:3001` does NOT
  create a secure public interface; the Compose example publishes only host
  `127.0.0.1:3001` for a separately managed TLS edge.
- `HOOSHIX_PUBLIC_BASE_URL` must be the exact trusted HTTPS origin of that edge; an
  external bind without it is a hard startup error, and a credential-bearing or
  non-HTTPS public origin is rejected.
- Public exposure, TLS, authorization policy, capacity and rollback qualification remain
  open release gates tracked in the audit matrix; none of them is satisfied by the
  container or CI work in this branch.
