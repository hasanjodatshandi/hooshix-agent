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
| Windows, delivered | the `HooshiX MCP` service — see below |

Build: `pnpm build` (tsc). Typecheck (both configs): `pnpm typecheck`.

The default bind is **loopback only**. External exposure requires `HOOSHIX_PUBLIC_BASE_URL` set to an exact trusted HTTPS origin — the service refuses untrusted public binding. External deployment itself is the owner's responsibility.

## Windows service

On a Windows machine the connector runs as the **`HooshiX MCP` SCM service** (`start=auto`, LocalSystem), supervised by the Go host in `deploy/windows` — see `deploy/windows/README.md` for the module and the settings document. It answers right after a reboot, before anybody signs in.

| Action | How |
|---|---|
| Install on a new machine | `pnpm run installer:windows`, then double-click `deploy/windows/build/HooshiX-MCP-Setup-<version>.exe` |
| Upgrade after a code change | `pnpm build`, then run Setup.exe again — it replaces the program files and keeps `%ProgramData%\HooshiXMCP\settings.json` |
| Start / stop / restart | the tray icon menu, or `hooshix-mcp-service service start\|stop\|restart` (unelevated: the service DACL grants exactly query, start, stop) |
| Status | `hooshix-mcp-service status` — the SCM state plus what the server published |
| Host log | `%ProgramData%\HooshiXMCP\service.log` (rotated), or `Open logs` in the tray menu |
| Audit log | `HOOSHIX_LOG_DIR` (`command-actions.log`, `file-actions.log`) |

The tray icon colour is the operator-facing health signal: green means ChatGPT can reach it, yellow means it is starting or degraded, red means it is not usable.

There is **no logon scheduled task and no watchdog script**. `tests/release-startup-safety.test.ts` keeps the retired launcher stack retired and holds the two rules it used to enforce inside the service: a process the supervisor did not spawn is never terminated, and a port owned by an unknown listener is refused rather than competed with.

A machine that *develops* the connector usually points its settings document at the checkout (`entry`, `workingDirectory`, and the `HOOSHIX_DB_PATH` / `HOOSHIX_LOG_DIR` / `HOOSHIX_BOOTSTRAP_TOKEN_FILE` env entries), so the loop is `pnpm build` then `service restart` with no reinstall. `pnpm run service:build` compiles that control CLI into the gitignored `build/bin` once, after which `pnpm run service:status` and `pnpm run service:restart` work from an ordinary unelevated shell. The delivered install under `C:\Program Files` is the one that ships to other people.

**Workspace roots must be reachable by the account the service runs under.** A client cannot grant a path the service cannot stat. `\\wsl.localhost\...` and `\\wsl$\...` need two things at once, and the order matters:

1. **The service must run as a real user account.** Windows refuses WSL to a local system (`Wsl/WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED`), so while `HooshiXMCP` is LocalSystem no distribution path is grantable, no matter how many times the Task is approved. Set the account in `services.msc` → *HooshiX MCP* → Log On; the password is typed there and never reaches a file or a command line. The same applies to any network share needing a user token.
2. **The distribution has to be asked for by name.** Windows publishes a distribution's file view in a logon session only once something in that session has spoken to the subsystem — measured here: the first `existsSync` of a distribution path returns false, waiting fifteen seconds changes nothing, and the very next call after one launcher run resolves it. Since that registration belongs to the logon session, every service start begins cold. Name the distributions in `settings.json` and the host asks before each spawn:

```json
{ "wslDistros": ["Ubuntu"] }
```

Each call is logged with the launcher's own message, so a service that is still on LocalSystem says `WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED` in `service.log` at boot rather than leaving the operator to meet an unexplained refusal weeks later. A name that could be read as a launcher option is refused when the settings document loads. An empty or absent `wslDistros` means the host never touches the subsystem, which is the default.

Any other failure still surfaces as `workspace_path_not_found`, and `service.log` carries the thrown message on a `hooshix_tool_failure` line, which the client never sees. Put such a project on a local volume, or run the connector inside the Linux environment where the path is local.

**Everything that runs a command needs the service's own search path.** The host hands the server `PATH`, `PATHEXT` and `COMSPEC` out of the environment block the service control manager built, matched without regard to case because that block spells them `Path` and `ComSpec` — reading those names exactly is what once made every shell tool fail as `spawn cmd.exe ENOENT` while the service looked healthy. Two consequences an operator owns:

- A program has to be reachable by the **machine** `PATH`, not a user's. `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` → `Path` is what the service sees; a tool installed only into a user profile is not on it. Measured on this host, that value carries `C:\Program Files\Git\cmd`, so `git` resolves for the service, and the Node runtime is started by absolute path anyway.
- If the search path is missing altogether, the service still starts and answers `/health/live`. The condition is named once at boot in `service.log` as `server environment incomplete`, because the alternative is a client conversation meeting a command failure with nothing in the log to explain it.

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
4. The bootstrap secret is never accepted as `Authorization: Bearer`, so a leaked token cannot be replayed as an MCP credential. It can only read the historical protected `/health` summary (use `/health/live` for probes).

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
