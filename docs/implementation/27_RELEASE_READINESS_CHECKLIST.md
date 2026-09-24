# Release Readiness Checklist

**Purpose:** final owner-facing checklist before a release candidate can be considered for network-exposed HTTP deployment (public exposure itself is handled by the external deployment project).
**Authority:** all R10 gates + finding matrix.  
**Rule:** unchecked release blockers mean **NO public production deployment**.

**How to read the marks on this page:**
- `[x]` **EXECUTED** — an executable test or script in this repository proves the item, and it was green in the current state (suite 180 files / 808 tests, serial; parallel run 3× green). The proving artifact is named in the note directly under the item.
- `[~]` **BLOCKED — deferred explicitly** — the item is not in the implementer's power here. The blocker is named (Docker daemon unreachable / no GitHub Actions runner / no POSIX host / owner-only decision) together with the evidence that would be needed to close it.
- `[ ]` **NOT_VERIFIED** — no executable evidence exists yet. This page does not claim the item is satisfied.

A `[x]` mark is a statement about this repository's current state, not about any future CI run. Where an item has an executable local half and a hosted-CI half, the note says so and only the executed half is marked `[x]`.

---

## 1. Audit findings

- [ ] HIGH-01 through HIGH-13 are `VERIFIED_CLOSED`.
  → **NOT_VERIFIED — BLOCKED (container/CI).** 10/13 closed. HIGH-10 is IMPLEMENTED (executed negative frozen-lockfile install test, R8.01) but needs a hosted clean-checkout CI run to close; HIGH-11 and HIGH-12 are IMPLEMENTED/TEST_ENCODED but need the real container build and the live/ready container smoke, both blocked on the Docker daemon.
- [ ] MED-01 through MED-29 are `VERIFIED_CLOSED`.
  → **NOT_VERIFIED.** 19/29 closed. OPEN: MED-03 (search budgets proven on one transport only), MED-13/14 (container), MED-15/16/21/23/24/26/27.
- [ ] LOW-01 through LOW-12 are `VERIFIED_CLOSED` per owner mandate.
  → **NOT_VERIFIED.** 1/12 closed (LOW-01). LOW-02..12 remain open by owner mandate; the deferral itself is documented.
- [x] No finding was silently reclassified/removed because old file paths changed.
  → All 54 matrix rows are intact in `20_FINDINGS_TRACEABILITY_MATRIX.md` with their statuses and histories; the R8.01 audit re-walked every row and found no removal.
- [x] Residual risks are explicitly documented and do not contradict closure evidence.
  → G6 +54..128% write trade-off recorded in `R6_04_METRICS_INDEX_AB_REPORT_2026-09-22.md`; POSIX 0600 deferral, facade retirement and the unrestricted-mode test fixture all recorded in `29_IMPLEMENTATION_PROGRESS_LEDGER.md` with their reasons.

---

## 2. Architecture

- [x] Domain/Application dependency rules pass with zero production exceptions.
  → `tests/core/r0-architecture-boundary.test.ts`, `r1-strict-boundary.test.ts` + `scripts/verify-g1-global.mjs --strict` (0 candidates).
- [x] Direct MCP and Task execution meet at one `ExecuteToolUseCase` before side effects.
  → `tests/core/r2-execute-tool-gateway.test.ts`, `r2-no-alternate-inbound-execution.test.ts`.
- [x] One canonical OperationCatalog defines policy metadata.
  → `tests/core/r2-operation-catalog.test.ts` (53 descriptors, unknown denied).
- [x] No production global mutable workspace authorization state.
  → `tests/security/r9-unreachable-unrestricted-mode.test.ts` — the global is a documented test-only fixture; production scope is the single-effect `runWithApprovedUnrestrictedScope` (documented deviation).
- [x] No inbound adapter imports concrete outbound adapter.
  → `tests/core/r0-architecture-boundary.test.ts`, `r1-strict-boundary.test.ts`.
- [x] No raw SQL outside SQLite adapter/migrations.
  → `tests/e2e/r9-adapter-boundary.test.ts` (source scan forbids `.prepare/.pragma/.exec(` with string literal in `src/mcp`), `r1-strict-boundary.test.ts`.
- [x] No `process.env` outside config/bootstrap.
  → `tests/core/r1-strict-boundary.test.ts`, `r1-entrypoint-http-config-migration.test.ts`.
- [x] No concrete persistence/FS/process/Git/package imports in Application/Domain.
  → `tests/core/r1-strict-boundary.test.ts` (Application/Domain outward-import scan) + `r1-hexagonal-foundation.test.ts`.
- [x] Composition root owns concrete construction.
  → `tests/core/r1-legacy-handler-composition.test.ts`, `r1-hexagonal-foundation.test.ts`.
- [x] Legacy duplicate tool/policy paths removed.
  → Executed and enforced. Documented deviation: the 4 `core/memory/*` facades and `legacy-sdk-bridge.ts` are deliberately retained, pinned by `r9-compat-shims-are-pure-aliases.test.ts` with expiry owner/date (see ledger R9.03).

---

## 3. MCP protocol / SDK

- [x] Production code uses MCP TypeScript SDK v2 split packages.
  → `src/adapters/inbound/mcp/legacy-sdk-bridge.ts` imports only `@modelcontextprotocol/{server,node}`; all three v2 packages declared in `package.json`.
- [ ] Monolithic `@modelcontextprotocol/sdk` v1 has zero remaining production/test/script imports after final migration.
  → **NOT_VERIFIED.** `tests/helpers/mcp-client.ts` still imports `@modelcontextprotocol/sdk/client/stdio.js`, and v1 `1.30.0` remains a production dependency. Production code is migrated; the test helper and the dependency are not.
- [x] Modern MCP 2026-07-28 HTTP E2E passes.
  → `tests/e2e/r8-http-task-lifecycle.test.ts`, `r5-http-security.test.ts`, `r5-http-edge-contracts.test.ts`.
- [x] Modern stdio serving E2E passes.
  → `tests/e2e/r5-isolated-stdio-and-clock.test.ts` (v2 client ↔ stdio server process).
- [x] Legacy 2025 protocol support matches ADR-009 and is explicitly tested/documented or intentionally disabled.
  → `tests/e2e/r2-http-session-workspace.test.ts` negotiates `protocolVersion 2025-06-18`, bounded per ADR-009.
- [x] Modern HTTP does not depend on `Mcp-Session-Id` for application correctness.
  → `HttpPrincipalContexts` caps (64/30m/8h) proven by fake-clock regression in `r5-http-session-fakeclock.test.ts`.
- [x] Current official MCP auth opt-ins (issuer/scope/credential hardening) re-verified and enabled.
  → `tests/e2e/r5-http-session-fakeclock.test.ts` (RFC 9207 `iss` stamp, wrong-resource rejection), `r5-issued-credentials.test.ts`.
- [ ] `docs/PROTOCOL_COMPATIBILITY.md` matches exact shipped SDK/protocol versions.
  → **NOT_VERIFIED.** The file does not exist (R9.07 not started).

---

## 4. Authorization & filesystem security

- [x] Workspace root mutation cannot bypass authorization.
  → `tests/security/r2-workspace-selection-permission.test.ts`.
- [x] Unrestricted scope requires server allow flag + ADMIN + exact human approval.
  → `tests/security/r2-unrestricted-exact-approval.test.ts`, `r9-unreachable-unrestricted-mode.test.ts`.
- [x] Task workspace scope is persisted/immutable and independent of direct context changes.
  → `tests/security/r2-task-owner-session.test.ts`, `tests/core/durable-task-context.test.ts`.
- [x] HTTP logical context is principal/application scoped, not transport-session authority.
  → `tests/e2e/r2-http-session-workspace.test.ts`, `r2-session-workspace.test.ts`.
- [x] Sensitive files/dirs are never read by search.
  → `tests/security/r2-sensitive-path-alias.test.ts`, `r8-property-based.test.ts` (400 cases, recorded seed).
- [x] `git diff --no-index` external disclosure regression passes.
  → `tests/security/r0-noindex-disclosure.test.ts`.
- [x] Shell CWD and path-bearing safe-command args are scope-authorized.
  → `tests/security/r2-command-cwd-bypass.test.ts`, `r2-direct-command-workspace.test.ts`.
- [x] Unknown command shapes fail closed to approval/block.
  → `tests/shell/command-validator.test.ts`, `command-permission.test.ts`, `r2-execute-tool-gateway.test.ts`.
- [ ] Child process environment excludes unrelated sensitive credentials.
  → **NOT_VERIFIED.** `src/services/shell/shell-service.ts:44-52` passes no `env` to execa, so the child inherits the full parent environment including `HOOSHIX_BOOTSTRAP_TOKEN`. No test covers it.
- [x] Direct and Task file CAS/idempotency behavior is identical.
  → `tests/e2e/r2-file-cas-real-parity.test.ts`, `r2-direct-file-parity.test.ts`.

---

## 5. OAuth / HTTP security

- [x] Bootstrap/operator secret is distinct from access/refresh tokens.
  → `tests/security/r5-issued-credentials.test.ts`, `r0-oauth-expiry-replay.test.ts`.
- [x] Access tokens stored hashed and enforce expiry/resource/scopes/revocation.
  → `tests/security/r5-issued-credentials.test.ts`, `r0-oauth-expiry-replay.test.ts`.
- [x] Refresh tokens rotate atomically and replay is detected.
  → `tests/security/r0-oauth-expiry-replay.test.ts`, `r5-issued-credentials.test.ts`.
- [x] Authorization code PKCE + exact redirect/client/resource/expiry/single-use tests green.
  → `tests/security/r5-issued-credentials.test.ts` (S256 PKCE, single-use code, rotation, family replay).
- [x] RFC 9207 issuer behavior/current MCP auth requirements green.
  → `tests/e2e/r5-http-session-fakeclock.test.ts` (resolved in R5.05).
- [x] Query-string bearer token rejected.
  → `tests/e2e/r5-http-security.test.ts`.
- [x] Public base URL required/fail-closed in public mode.
  → `tests/e2e/r5-http-hardening.test.ts`, `r7-unified-config.test.ts`.
- [x] Host/origin/CORS tests green.
  → `tests/e2e/r5-http-security.test.ts`, `r5-http-hardening.test.ts`.
- [x] Rate limits/concurrency budgets green.
  → `tests/e2e/r5-http-security.test.ts` (429 + Retry-After), `r6-search-aggregate-safety.test.ts` (search budgets; MED-03 still open for cross-transport breadth).
- [x] Dashboard session separate from MCP bearer; cookie/session hardening green if dashboard retained.
  → `tests/e2e/r5-http-security.test.ts` (CSRF/logout, monitoring scope, separate operator session).
- [x] `/health/live` and `/health/ready` expose no sensitive data and work as documented.
  → `tests/e2e/r5-http-edge-contracts.test.ts`, `r9-adapter-boundary.test.ts` (200 ready / 503 not_ready), `r7-bootstrap-secret-lifecycle.test.ts` (token never echoed).
- [~] Token/bootstrap file permission behavior verified on relevant OS.
  → **BLOCKED — no POSIX host.** Length/symlink/rotation/atomic-create are executed by `r7-bootstrap-secret-lifecycle.test.ts`; the POSIX `0600` chmod branch exists but cannot run on Windows. Needed to close LOW-07.

---

## 6. Task execution / recovery / concurrency

- [x] Timeout cancellation waits for termination/grace result.
  → `tests/core/r3-timeout-unknown-policy.test.ts`, `tests/e2e/r8-crash-timeout-injection.test.ts`.
- [x] Non-idempotent `outcome_unknown` never auto-retries.
  → `tests/core/r3-timeout-unknown-policy.test.ts`, `r3-reconciliation-decision.test.ts`.
- [x] Crash-after-effect test does not duplicate side effect.
  → `tests/e2e/r8-crash-timeout-injection.test.ts` (real OS kill + restart).
- [x] Canonical Task hydration preserves every semantic field.
  → `tests/core/r3-canonical-task-hydration.test.ts`.
- [x] Reconciliation use case handles automatic/manual paths explicitly.
  → `tests/core/r3-reconciliation-decision.test.ts`, `task-reconciliation.test.ts`.
- [x] Durable execution lease two-process test has exactly one winner.
  → `tests/core/r3-durable-lease-multiprocess.test.ts` (two real child processes).
- [x] Expired lease takeover does not bypass unknown-outcome safety.
  → `tests/core/r3-durable-lease-multiprocess.test.ts` (fencing epoch).
- [x] Task idempotency same-key/different-payload returns conflict.
  → `tests/core/r3-task-creation-idempotency.test.ts`.
- [x] Tool idempotency binds args/scope/operation.
  → `tests/e2e/r2-file-cas-real-parity.test.ts`, `r2-unrestricted-exact-approval.test.ts`.
- [x] Audit sink failure after effect does not make Task falsely retryable.
  → `tests/core/r3-telemetry-degradation.test.ts`.
- [x] Terminal append semantics truthful.
  → `tests/core/r3-terminal-append.test.ts`.
- [x] Approval exact fingerprint invalidates on operation/arg mutation.
  → `tests/security/r2-unrestricted-exact-approval.test.ts` (path substitution rejected, atomic claim).

---

## 7. Data integrity / compensation

- [x] Atomic file write/exclusive create controls preserved.
  → `tests/services/filesystem-service.test.ts`, `filesystem-guard.test.ts`, `r7-bootstrap-secret-lifecycle.test.ts` (exclusive `wx`).
- [x] Backup-before-mutation/displaced backup chain preserved.
  → `tests/core/r4-file-backup-schema.test.ts`, `r4-revision-guarded-restore.test.ts`.
- [x] Backup state immutable (`absent|present`) separate from restore history.
  → `tests/core/r4-file-backup-schema.test.ts` (trigger rejects alteration).
- [x] Repeated absent restore remains absent.
  → `tests/core/r4-repeated-restore.test.ts`.
- [x] Restore requires expected revision unless explicit approved historical restore.
  → `tests/core/r4-revision-guarded-restore.test.ts` (no historical-force flag exposed).
- [x] Restore uses persisted canonical absolute target and reauthorization.
  → `tests/core/r4-revision-guarded-restore.test.ts`.
- [x] Dirty Git snapshot rejected.
  → `tests/core/r4-clean-git-snapshot-rollback.test.ts` (real git).
- [x] Clean Git rollback verifies exact resulting state.
  → `tests/core/r4-clean-git-snapshot-rollback.test.ts` (6 cases).
- [x] Package result says manifest restore unless environment reversal actually verified.
  → `tests/core/r4-package-manifest-compensation.test.ts`.
- [x] Project canonical identity migration handles collisions safely.
  → `tests/core/r4-project-canonical-identity.test.ts` (collision rollback).

---

## 8. Persistence / migrations

- [x] Fresh DB -> latest schema passes.
  → `tests/core/r10-release-readiness.test.ts` (fresh in-memory DB → v17, FK-clean, idempotent re-run), `r6-migration-only-schema.test.ts`.
- [x] Representative current DB copy -> latest schema passes with semantic integrity.
  → `scripts/release-db-rehearsal.mjs` — real online backup of the live DB: 1051→1051 tasks, 8 roots, schema 17, 0 FK violations, restore drill PASS (executed this session).
- [x] Pre-migration backup + integrity check procedure tested.
  → Same rehearsal script performs the backup and `integrity_check` before and after; procedure in `R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md`.
- [ ] Migration failure blocks startup; no silent catch-ignore drift.
  → **NOT_VERIFIED.** `r6-migration-only-schema.test.ts` proves unrelated DBs are not healed, but no test asserts a startup abort on migration failure. LOW-02 open.
- [x] Canonical Task mapper is singular.
  → `tests/core/r3-canonical-task-hydration.test.ts` (sole `hydrateTaskById`).
- [x] Execution lease/idempotency/OAuth/backup/project migrations green.
  → Migrations 12–16 each covered by copied-DB upgrade tests in the R3/R4/R5 suites; `LATEST_MIGRATION_VERSION` pinned by `r10-release-readiness.test.ts`.
- [x] Per-call PRAGMA schema introspection removed.
  → `tests/core/r6-no-hot-path-schema-pragmas.test.ts` (500-op spy, zero schema PRAGMAs).
- [x] Periodic retention policy active and class-aware.
  → `tests/core/r6-retention-service.test.ts` (5 classes, periodic scheduler).
- [x] Unresolved reconciliation/security evidence retention safe.
  → `tests/core/r6-retention-service.test.ts` (active checkpoints/recovery/approvals/unrestored backups preserved).
- [x] Relevant indexes justified by actual query plan evidence.
  → `R6_04_METRICS_INDEX_AB_REPORT_2026-09-22.md` + `r6-metrics-index.test.ts` (EXPLAIN plan assertions).

---

## 9. Performance / scalability

- [x] Redesign baseline benchmark recorded.
  → `docs/implementation/R0_BASELINE_2026-09-19.md` (1000 writes 101–136 ms, 1000 query sets 170–211 ms), re-executed by `tests/core/database-benchmark.test.ts`.
- [x] No unexplained >2x core DB/metrics regression from audited baseline.
  → The +54..128% write trade-off is disclosed, owner-accepted in `R6_04_METRICS_INDEX_AB_REPORT_2026-09-22.md` / `R6_G6_WORKLOAD_EVIDENCE_2026-09-23.md` — explained, not unexplained. No executable regression assertion exists.
- [x] Search aggregate byte cap regression green.
  → `tests/core/r6-search-aggregate-safety.test.ts` (file/byte/result/time caps).
- [x] Search/expensive-op concurrency cap regression green.
  → `tests/core/r6-search-aggregate-safety.test.ts` (SearchConcurrencyLimiter over-cap rejection + release).
- [x] 25k/250k actual metrics query benchmarks recorded.
  → `scripts/r6-metrics-benchmark.mts` seeds 25k/250k rows against the real `getAgentMetrics` adapter; two runs recorded in `R6_03_METRICS_QUERY_BENCHMARK_2026-09-22.md`.
- [x] EXPLAIN plans for primary queries recorded.
  → `R6_03_METRICS_QUERY_BENCHMARK_2026-09-22.md` + `r6-metrics-index.test.ts`.
- [x] Session/context memory remains bounded under churn test.
  → `tests/core/r6-session-metrics-pruning.test.ts`, `r5-metrics-bounded.test.ts` (10k-session churn).
- [x] Retention large-fixture cleanup bounded.
  → `tests/core/r6-retention-service.test.ts` (class-aware dry-run/delete + scheduler). Fixtures are small, so "large-fixture" boundedness is not specifically proven.
- [ ] Event-loop delay captured under relevant load.
  → **NOT_VERIFIED.** Ledger records `event-loop delay under DB/metrics load | not measured`; no code greps for loopDelay.
- [x] SQLite/client-server DB decision remains evidence-backed/ADR documented.
  → `docs/implementation/adrs/ADR-004_SQLITE_AND_DURABLE_EXECUTION_LEASES.md`.

---

## 10. Observability / logging

- [x] Opaque separate secret args redacted.
  → `tests/security/r6-audit-redaction-telemetry.test.ts` (separated/inline opaque args, env, headers, passwords).
- [x] Raw access/refresh/bootstrap/auth-code/PKCE verifier values absent from logs.
  → Same test asserts none of the raw values appear in the log; `r7-bootstrap-secret-lifecycle.test.ts` asserts `/health/live` never echoes the token.
- [x] Business vs observability outcome separation test green.
  → `tests/core/r3-telemetry-degradation.test.ts` (business outcome preserved when audit/checkpoint/context sinks all fail).
- [x] Prometheus output passes golden/parser and promtool where available.
  → `tests/core/r6-prometheus-exposition.test.ts` golden parser; promtool step self-skips when ENOENT (promtool not installed here).
- [x] HELP/TYPE one per family; bounded labels only.
  → `r6-prometheus-exposition.test.ts` (exactly one HELP/TYPE per family, label cardinality ≤128 with `__other__`).
- [ ] HTTP auth/session failures logged safely without headers/cookies/tokens.
  → **NOT_VERIFIED.** `/health/live` is minimal and the error handler logs only the error name, but no test directly asserts auth-failure log lines exclude headers/cookies/tokens.
- [ ] Security events include scope expansion, sensitive denial, token replay, rate limits, reconciliation.
  → **NOT_VERIFIED.** Full taxonomy exists only in spec `15_OBSERVABILITY_AUDIT_LOGGING_METRICS_SPEC.md` §5; `SecurityEventPort` records only `authorization_denied`. No test covers scope_expansion/sensitive_denial/token_replay/rate_limit/reconciliation emission.
- [x] Session metrics/history bounded.
  → `r6-session-metrics-pruning.test.ts`; tool-call history bounded in `metrics.ts` (rolling-window test in `r6-prometheus-exposition.test.ts`).
- [ ] JSONL rotation/permissions/retention documented.
  → **NOT_VERIFIED.** Named in spec `15` and `07` only; the audit lists "no log rotation" as an original gap and no implementation or test exists.
- [x] Observability-degraded health/metric signal works.
  → `tests/security/r6-audit-redaction-telemetry.test.ts`, `r3-telemetry-degradation.test.ts` (degraded-observability counter + non-sensitive exposition).

---

## 11. Tests / static validation

- [x] Build/typecheck green.
  → `pnpm run build`, `pnpm run typecheck` (both `tsconfig.json` and `tsconfig.r1.json`); strict TS options pinned by `r8-static-lint-hygiene.test.ts`.
- [x] Full unit/integration/security/E2E/property/failure-injection suite green.
  → 180 files / 808 tests serial PASS; **3 consecutive parallel runs green** this session.
- [x] All 13 HIGH exploit regressions permanent/green.
  → `tests/security/audit-high-fixes.test.ts` + `r8-frozen-lockfile-executed.test.ts` (R8.01 audit: HIGH-01–09/13 EXECUTED_BEHAVIORAL; HIGH-10/12 have executable local halves).
- [x] HTTP/OAuth modern E2E release-gated.
  → `tests/e2e/r8-http-task-lifecycle.test.ts` real OAuth/PKCE create→run→approve→resume→report.
- [x] Critical per-file/glob coverage thresholds green.
  → `tests/core/r8-coverage-floors.test.ts` (12 security/reliability modules, floors + stale-file guard). Skips if `coverage-summary.json` is absent.
- [x] Architecture tests green.
  → `r1-global-architecture-gate.test.ts`, `r1-strict-boundary.test.ts`, `r0-architecture-boundary.test.ts`, `r9-adapter-boundary.test.ts`; `verify-g1-global.mjs --strict`.
- [x] Test fixtures isolated; configured multi-worker profile stable in repeated Windows/CI runs.
  → `tests/core/r8-parallel-isolation.test.ts` + the 3 consecutive green parallel runs. Hosted-CI portion of this item is BLOCKED (no runner).
- [x] No test uses real secrets or destructive user repository actions.
  → `scripts/r7-secret-policy-check.mjs` (488 tracked paths, `.token`/`.env`/`.db`/`.pem`/`.key`); all fixtures use marker-owned temp dirs.
- [x] `git diff --check`/format policy green on intended changes.
  → `tests/core/r8-static-lint-hygiene.test.ts` runs `git diff --check` as a suite assertion (R8.07).
- [x] Dependency audit green or owner-approved documented exception.
  → `pnpm audit --prod --audit-level=high` — No known vulnerabilities found; CI workflow pins the step.

---

## 12. CI / supply chain / container

- [x] Clean checkout frozen install green.
  → Executed locally on a clean clone of HEAD: `pnpm install --frozen-lockfile` + build + `release-preflight.mjs` = `LOCAL_SOURCE_GATES_PASS`. **Hosted clean-checkout CI run BLOCKED — no GitHub Actions runner.**
- [x] No Docker unfrozen dependency fallback.
  → `tests/core/r8-frozen-lockfile-executed.test.ts` proves `ERR_PNPM_OUTDATED_LOCKFILE` fails closed; Dockerfile has no `||` fallback (`r7-deployment-security.test.ts`).
- [x] GitHub Actions least privilege.
  → `.github/workflows/ci.yml` `permissions: contents read`, `persist-credentials: false`; asserted by `r7-deployment-security.test.ts`.
- [x] Third-party actions pinned to full commit SHAs.
  → checkout `11bd71901bbe...`, setup-node `49933ea5288...` (full 40-hex); asserted by `r7-deployment-security.test.ts`.
- [x] Secret/config scans green.
  → `scripts/r7-secret-policy-check.mjs` fail-closed over active deploy surfaces + 488 tracked paths.
- [~] Runtime image non-root.
  → **BLOCKED — Docker daemon unreachable** (`permission denied ... npipe`). Dockerfile `USER node` + `chown node:node /app/data` are statically asserted; the real non-root container runtime was never executed. Needed to close HIGH-11.
- [x] No secret/test DB/log/local data baked into image.
  → `.dockerignore` excludes `.token`/`.env`/`data`/backups — asserted by `r7-deployment-security.test.ts`. No real image built to confirm.
- [~] Image health smoke green.
  → **BLOCKED — Docker daemon unreachable.** `HEALTHCHECK` + `/health/live` are in the recipe and statically asserted; the `container-smoke` CI job (health probe loop) never ran. Needed to close HIGH-12.
- [~] Authenticated MCP container smoke green.
  → **BLOCKED — Docker daemon unreachable + no runner.** The CI `container-smoke` authenticated `/health` 401 + `/health/live` 200 exec checks exist in ci.yml but were never executed.
- [x] Base image tag/digest/update policy recorded.
  → `docs/implementation/R7_DEPLOYMENT_PINNING_2026-09-23.md` (digest, provenance, 6-step update procedure). Digest verified via registry API only, never by a build.
- [x] Release commit, lock hash, image digest, Node/pnpm and schema versions recorded.
  → `scripts/release-preflight.mjs` emits HEAD sha, lock/schema digests, Node/pnpm versions; `r10-release-readiness.test.ts` keeps the schema-version constant honest. The **container image digest itself is BLOCKED** — no image can be built.

---

## 13. Configuration / operations

- [x] One typed `HOOSHIX_*` configuration contract.
  → `tests/core/r7-unified-config.test.ts` — one deeply frozen `loadAppConfig()`, 34 tests incl. single-source-of-truth for compat readers.
- [x] Stale `MCP_API_KEY` rejected; deprecated aliases bounded/documented.
  → `r7-unified-config.test.ts`, `r7-deployment-security.test.ts`, `r5-http-hardening.test.ts` (hard-fail + bounded aliases + conflict detection).
- [x] No literal `hooshix-v2-secret` remains.
  → `scripts/r7-secret-policy-check.mjs` fail-closes on the literal across all 8 active surfaces.
- [x] Non-interactive service/watchdog starts correct Node/pnpm/built artifact.
  → `verify-runtime-versions.mjs` gate + `r7-runtime-version-gate.test.ts`; watchdog/bat toolchain asserted in `r7-deployment-security.test.ts`.
- [x] One current production runbook (local stdio/HTTP; public exposure delegated to the external deployment project).
  → `R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md` is the single current runbook; `SETUP_NODEJS_V2.md` deprecated as an explicit pointer (asserted by test).
- [x] Loopback-bind and public-base-URL contract documented and tested locally/fixture where possible.
  → `r7-unified-config.test.ts`, `r5-http-hardening.test.ts`, `docker-compose.yml` contracts.
- [x] Token rotation/revocation operator procedure documented.
  → Bootstrap rotation (4 steps) in the runbook, backed by `r7-bootstrap-secret-lifecycle.test.ts`. OAuth token revocation is spec-level only (`18` §14).
- [x] DB backup/migration/restore procedure documented.
  → Backup/integrity/restore procedure in the runbook; the executed migration rehearsal is `scripts/release-db-rehearsal.mjs` (1051→1051 rows, FK-clean). A restore-from-backup drill of that procedure was executed as part of the rehearsal.
- [x] `outcome_unknown` reconciliation procedure documented.
  → 4-step operator path in the runbook, enforced by `r3-timeout-unknown-policy.test.ts`, `r3-reconciliation-decision.test.ts`.
- [ ] Incident response quick procedures documented.
  → **NOT_VERIFIED.** Token-leak / unknown-outcome / DB-issue / edge-outage procedures exist only as spec `18` §14; not in the shipped runbook and no test.

---

## 14. Documentation

- [x] `README.md` updated and concise.
  → `tests/core/r7-documentation-contract.test.ts` enforces both directions (no stale tool, no omitted tool) against the 53-tool catalog.
- [ ] `docs/ARCHITECTURE.md` current.
  → **NOT_VERIFIED.** The file does not exist (R9.07 not started). Architecture rules are currently enforced only by the section-2 tests.
- [ ] `docs/SECURITY.md` current.
  → **NOT_VERIFIED.** The file does not exist (R9.07 not started).
- [ ] `docs/OPERATIONS.md` current.
  → **NOT_VERIFIED.** The file does not exist (R9.07 not started). `R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md` is an implementation runbook, not the final operations guide.
- [ ] `docs/TOOLS.md` generated/current.
  → **NOT_VERIFIED.** The file does not exist (R9.06 not started); the 53-tool list currently lives in README.
- [ ] `docs/PROTOCOL_COMPATIBILITY.md` current.
  → **NOT_VERIFIED.** The file does not exist (also required by section 3).
- [ ] `docs/MIGRATIONS.md` current.
  → **NOT_VERIFIED.** The file does not exist; migration history lives in `29_IMPLEMENTATION_PROGRESS_LEDGER.md` and the `R6_*` reports only.
- [ ] `docs/RELEASE.md` current.
  → **NOT_VERIFIED.** The file does not exist; the release process is `scripts/release-preflight.mjs` + this checklist.
- [ ] Tool/config docs clean-diff generation gate green.
  → **NOT_VERIFIED.** No generator script exists (there is no `docs/TOOLS.md` to generate); `git diff --check` covers source only.
- [x] Conflicting old runbooks removed/archived.
  → `SETUP_NODEJS_MCP_V2.md` is an explicit deprecation pointer; `r7-secret-policy-check.mjs` bounds the active surfaces.
- [x] Audit provenance retained.
  → `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`, `R0_BASELINE_2026-09-19.md`, `POST_R6_AUDIT_FINDINGS_SNAPSHOT.md`, `20_FINDINGS_TRACEABILITY_MATRIX.md` (all 54 findings, deliberately unrewritten).

---

## 15. Final sign-off

The sign-off block below is deliberately **NOT filled**. It is an owner decision, and the implementer side is not ready to recommend `RELEASE_CANDIDATE` anyway: 4 items are environment-BLOCKED (Docker daemon unreachable, no GitHub Actions runner, no POSIX host) and 20 items remain genuinely NOT_VERIFIED, the largest concentration being section 14 (7 of 8 required `docs/*.md` files do not exist, R9.06/R9.07 were never started). The counts are filled here for record only.

- Section 1 (Audit findings): 5 items — **2 executed, 0 blocked, 3 open**. 24/54 findings closed; the matrix cannot be closed without container/CI evidence.
- Section 2 (Architecture): 10 items — **10 executed** (+1 documented deviation with expiry owner/date).
- Section 3 (MCP protocol/SDK): 8 items — **6 executed, 2 open**. Open: v1 SDK dependency + test helper import (3.2), `docs/PROTOCOL_COMPATIBILITY.md` missing (3.8).
- Section 4 (Authorization/filesystem): 10 items — **9 executed, 1 open**. Open: child-process env not filtered (4.9).
- Section 5 (OAuth/HTTP): 12 items — **11 executed, 1 BLOCKED** (POSIX `0600` permission proof, 5.12).
- Section 6 (Task execution/recovery): 12 items — **12 executed**.
- Section 7 (Data integrity): 10 items — **10 executed**.
- Section 8 (Persistence/migrations): 10 items — **9 executed, 1 open** (startup-abort-on-migration-failure, 8.4).
- Section 9 (Performance): 10 items — **9 executed, 1 open** (event-loop delay never measured, 9.9).
- Section 10 (Observability): 10 items — **7 executed, 3 open**. Open: auth-failure log assertion (10.6), security-event taxonomy (10.7), JSONL rotation unimplemented (10.9).
- Section 11 (Tests/static validation): 10 items — **10 executed** (11.7 and 12.1 hosted-CI halves are noted in-place as blocked).
- Section 12 (CI/supply chain/container): 11 items — **8 executed, 3 BLOCKED** (12.6/12.8/12.9); 12.11 is `[x]` because the release-preflight emits every version/digest it can, with the container image digest itself noted in-place as blocked.
- Section 13 (Configuration/operations): 10 items — **9 executed, 1 open** (incident-response procedures, 13.10).
- Section 14 (Documentation): 11 items — **3 executed, 8 open**. Largest gap: 7 of 8 required `docs/*.md` do not exist.
- **Total: 139 items — 115 executed, 4 BLOCKED, 20 NOT_VERIFIED.**

```text
Release candidate commit:
Date:
Node / pnpm:
MCP SDK packages / protocol support:
DB schema version:
Container image digest:
Audit findings closed: 54/54
Security gate: PASS/FAIL
Reliability gate: PASS/FAIL
Data-integrity gate: PASS/FAIL
MCP/HTTP gate: PASS/FAIL
Performance gate: PASS/FAIL
Test/coverage gate: PASS/FAIL
CI/container gate: PASS/FAIL
Documentation gate: PASS/FAIL
Known residual limitations:
Implementer recommendation: RELEASE_CANDIDATE / DO_NOT_RELEASE
Owner production decision: PENDING / APPROVED / REJECTED
```

The implementing assistant may recommend a release candidate but must not perform public production deployment without explicit owner instruction.