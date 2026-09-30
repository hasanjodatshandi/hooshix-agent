# HooshiX Operations

Runbook for operating the service. The authoritative implementation runbook is `docs/implementation/R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md`; this file is the shipped operations guide.

## Requirements

- **Node 24** (pinned, verified by `scripts/verify-runtime-versions.mjs`), **pnpm 11.24.0** (pinned in `packageManager`).
- Install is frozen: `pnpm install --frozen-lockfile`. An outdated lockfile fails closed (`ERR_PNPM_OUTDATED_LOCKFILE`) — there is no fallback.

## Startup

| Mode | Command |
|---|---|
| stdio | `node dist/index.js` |
| HTTP | `node dist/index-http.js` (default `127.0.0.1:3001`) |
| dev stdio | `pnpm dev` (tsx src/index.ts) |
| dev HTTP | `pnpm dev:http` |

Build: `pnpm build` (tsc). Typecheck (both configs): `pnpm typecheck`.

The default bind is **loopback only**. External exposure requires `HOOSHIX_PUBLIC_BASE_URL` set to an exact trusted HTTPS origin — the service refuses untrusted public binding. External deployment itself is the owner's responsibility.

## Health endpoints

| Endpoint | Auth | Behavior |
|---|---|---|
| `/health/live` | none | 200 `{"status":"ok"}` — liveness |
| `/health/ready` | none | 200 `{"status":"ready"}`, or **503** `{"status":"not_ready"}` when the database is unopenable (never a crash) |
| `/health` | operator session / monitoring scope | protected |

`/health/ready` probes via `isDatabaseReady()` and is the readiness signal for container orchestration.

## Bootstrap secret

`HOOSHIX_BOOTSTRAP_TOKEN` (≥32 UTF-8 bytes) or a token file (`.token`; container `/app/data/.token`), mode `0600`, symlink-rejected, exclusive `wx` creation.

**Rotation:** stop the service → replace the file or env var → restart. The old secret immediately returns 403. `MCP_API_KEY` / `MCP_ACCESS_TOKEN` are hard-rejected with an explicit migration error.

## Configuration

All configuration is one typed, deeply frozen contract: `loadAppConfig()` in `src/infrastructure/config/app-config.ts`. There is no second reader of `process.env` outside that file (enforced by the G1 gate).

| Variable | Default | Meaning |
|---|---|---|
| `HOOSHIX_BOOTSTRAP_TOKEN` | — | Operator secret (≥32 bytes) |
| `HOOSHIX_BOOTSTRAP_TOKEN_FILE` | — | Token file path |
| `HOOSHIX_HTTP_PORT` | 3001 | HTTP listen port (alias `MCP_PORT`) |
| `HOOSHIX_HTTP_HOST` | 127.0.0.1 | Bind host (alias `MCP_BIND_HOST`) |
| `HOOSHIX_PUBLIC_BASE_URL` | — | Required for external HTTPS binding |
| `HOOSHIX_ALLOWED_ORIGINS` | — | Comma-separated explicit origins |
| `HOOSHIX_DB_PATH` | `./data/agent-memory.db` | SQLite path |
| `HOOSHIX_LOG_DIR` | `./logs` | JSONL audit log directory |
| `HOOSHIX_PERMISSION_LEVEL` | `READ_ONLY` | One of `READ_ONLY`, `PROJECT_ACCESS`, `DEVELOPER_MODE`, `ADMIN_MODE` (full names only; startup fails otherwise). Effective ceiling at runtime: READ / PROJECT_ACCESS / DEVELOPER / ADMIN |
| `HOOSHIX_WORKSPACE` | — | Bootstrap candidate roots (comma-separated) |
| `HOOSHIX_UNRESTRICTED` | — | Server allow ceiling; never an implicit grant |
| `HOOSHIX_DIRECT_AUTO_APPROVE` | — | `1` allows direct high-risk calls outside a task step |
| `HOOSHIX_RETENTION_DAYS` | 90 | Retention window; `0` disables |
| `HOOSHIX_TERMINATION_GRACE_MS` | 5000 | Grace period before force-killing a step |
| `HOOSHIX_OAUTH_*` (7) | — | OAuth client/resource/token settings |
| `HOOSHIX_RATE_LIMIT_*` (6) | — | Rate budgets |
| `HOOSHIX_SESSION_*` (7) | — | Session caps |
| `HOOSHIX_LEASE_*` (4) | — | Execution lease settings |
| `HOOSHIX_SEARCH_*` (5) | — | Search byte/result/time/concurrency caps |

## Logging

JSONL append files under `HOOSHIX_LOG_DIR`: `command-actions.log` and `file-actions.log`. Secret-bearing and opaque arguments are redacted (see `docs/SECURITY.md`).

## outcome_unknown reconciliation

When a step's real-world effect is unknown (crash after effect, timeout mid-write):

1. Inspect the task (`task_get` / `task_report`).
2. Verify the real-world effect **read-only** — never retry blindly.
3. `task_reconcile` with `confirmed_succeeded`, `confirmed_failed`, or `safe_to_retry`.

The task stays frozen until reconciled. Non-idempotent `outcome_unknown` never auto-retries.

## Backup and restore

1. Stop the service, or use `VACUUM INTO` / a filesystem snapshot.
2. Back up: the DB file, `HOOSHIX_LOG_DIR`, and the token file.
3. Verify with `PRAGMA integrity_check`.
4. Restore by moving the current DB aside and replacing it.

The executed migration/restore drill is `scripts/release-db-rehearsal.mjs`.

## Incident response

These are the operator procedures to run first when something goes wrong. Each one names the tool or command that resolves it, and the invariant that procedure protects.

### Bootstrap token leaked

**Invariant:** the operator credential never becomes an MCP bearer.

1. Revoke nothing yet — the token file is the only recovery path if the leak is only suspected.
2. Rotate: stop the service, replace `HOOSHIX_BOOTSTRAP_TOKEN` or the token file, restart. The old secret returns 403 immediately.
3. Check the audit logs under `HOOSHIX_LOG_DIR` for any `command-actions.log` line written while the leaked token was valid — a bearer-shaped string in a redacted argument field means the leak reached a command author.
4. The bootstrap secret is never accepted as `Authorization: Bearer`, so a leaked token cannot be replayed as an MCP credential. It can only read `/health/monitoring`.

### Unknown task outcome (`outcome_unknown`)

**Invariant:** a non-idempotent effect is never retried blindly.

1. `task_get` / `task_report` — read the step state and the execution/recovery timeline.
2. Verify the real-world effect **read-only**. Do not re-run the step.
3. `task_reconcile` with `confirmed_succeeded`, `confirmed_failed`, or `safe_to_retry`.
4. The task stays frozen until reconciled. This is the freeze, not a bug.

### Database issue

**Invariant:** the database is the source of truth for tasks, approvals, snapshots and OAuth credentials.

1. `PRAGMA integrity_check` and `PRAGMA foreign_key_check` (the release rehearsal runs both).
2. If either fails: stop the service, restore from the backup procedure above.
3. If the service cannot open the database at startup, `/health/ready` returns 503 rather than crashing — that is the degradation signal, not the failure.

### Edge / exposure outage

**Invariant:** the service never serves on a misconfigured public bind.

1. Check `/health/live`. A 200 with the service unreachable from the edge means the edge is the problem, not this service.
2. `HOOSHIX_PUBLIC_BASE_URL` must be an exact trusted HTTPS origin; anything else is refused at startup.
3. A 503 from `/health/ready` with `/health/live` at 200 means the database is the problem — see above.
