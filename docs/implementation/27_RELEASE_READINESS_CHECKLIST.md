# Release Readiness Checklist

**Purpose:** final owner-facing checklist before a release candidate can be considered for network-exposed HTTP deployment (public exposure itself is handled by the external deployment project).
**Authority:** all R10 gates + finding matrix.  
**Rule:** unchecked release blockers mean **NO public production deployment**.

---

## 1. Audit findings

- [ ] HIGH-01 through HIGH-13 are `VERIFIED_CLOSED`.
- [ ] MED-01 through MED-29 are `VERIFIED_CLOSED`.
- [ ] LOW-01 through LOW-12 are `VERIFIED_CLOSED` per owner mandate.
- [ ] No finding was silently reclassified/removed because old file paths changed.
- [ ] Residual risks are explicitly documented and do not contradict closure evidence.

---

## 2. Architecture

- [ ] Domain/Application dependency rules pass with zero production exceptions.
- [ ] Direct MCP and Task execution meet at one `ExecuteToolUseCase` before side effects.
- [ ] One canonical OperationCatalog defines policy metadata.
- [ ] No production global mutable workspace authorization state.
- [ ] No inbound adapter imports concrete outbound adapter.
- [ ] No raw SQL outside SQLite adapter/migrations.
- [ ] No `process.env` outside config/bootstrap.
- [ ] No concrete persistence/FS/process/Git/package imports in Application/Domain.
- [ ] Composition root owns concrete construction.
- [ ] Legacy duplicate tool/policy paths removed.

---

## 3. MCP protocol / SDK

- [ ] Production code uses MCP TypeScript SDK v2 split packages.
- [ ] Monolithic `@modelcontextprotocol/sdk` v1 has zero remaining production/test/script imports after final migration.
- [ ] Modern MCP 2026-07-28 HTTP E2E passes.
- [ ] Modern stdio serving E2E passes.
- [ ] Legacy 2025 protocol support matches ADR-009 and is explicitly tested/documented or intentionally disabled.
- [ ] Modern HTTP does not depend on `Mcp-Session-Id` for application correctness.
- [ ] Current official MCP auth opt-ins (issuer/scope/credential hardening) re-verified and enabled.
- [ ] `docs/PROTOCOL_COMPATIBILITY.md` matches exact shipped SDK/protocol versions.

---

## 4. Authorization & filesystem security

- [ ] Workspace root mutation cannot bypass authorization.
- [ ] Unrestricted scope requires server allow flag + ADMIN + exact human approval.
- [ ] Task workspace scope is persisted/immutable and independent of direct context changes.
- [ ] HTTP logical context is principal/application scoped, not transport-session authority.
- [ ] Sensitive files/dirs are never read by search.
- [ ] `git diff --no-index` external disclosure regression passes.
- [ ] Shell CWD and path-bearing safe-command args are scope-authorized.
- [ ] Unknown command shapes fail closed to approval/block.
- [ ] Child process environment excludes unrelated sensitive credentials.
- [ ] Direct and Task file CAS/idempotency behavior is identical.

---

## 5. OAuth / HTTP security

- [ ] Bootstrap/operator secret is distinct from access/refresh tokens.
- [ ] Access tokens stored hashed and enforce expiry/resource/scopes/revocation.
- [ ] Refresh tokens rotate atomically and replay is detected.
- [ ] Authorization code PKCE + exact redirect/client/resource/expiry/single-use tests green.
- [ ] RFC 9207 issuer behavior/current MCP auth requirements green.
- [ ] Query-string bearer token rejected.
- [ ] Public base URL required/fail-closed in public mode.
- [ ] Host/origin/CORS tests green.
- [ ] Rate limits/concurrency budgets green.
- [ ] Dashboard session separate from MCP bearer; cookie/session hardening green if dashboard retained.
- [ ] `/health/live` and `/health/ready` expose no sensitive data and work as documented.
- [ ] Token/bootstrap file permission behavior verified on relevant OS.

---

## 6. Task execution / recovery / concurrency

- [ ] Timeout cancellation waits for termination/grace result.
- [ ] Non-idempotent `outcome_unknown` never auto-retries.
- [ ] Crash-after-effect test does not duplicate side effect.
- [ ] Canonical Task hydration preserves every semantic field.
- [ ] Reconciliation use case handles automatic/manual paths explicitly.
- [ ] Durable execution lease two-process test has exactly one winner.
- [ ] Expired lease takeover does not bypass unknown-outcome safety.
- [ ] Task idempotency same-key/different-payload returns conflict.
- [ ] Tool idempotency binds args/scope/operation.
- [ ] Audit sink failure after effect does not make Task falsely retryable.
- [ ] Terminal append semantics truthful.
- [ ] Approval exact fingerprint invalidates on operation/arg mutation.

---

## 7. Data integrity / compensation

- [ ] Atomic file write/exclusive create controls preserved.
- [ ] Backup-before-mutation/displaced backup chain preserved.
- [ ] Backup state immutable (`absent|present`) separate from restore history.
- [ ] Repeated absent restore remains absent.
- [ ] Restore requires expected revision unless explicit approved historical restore.
- [ ] Restore uses persisted canonical absolute target and reauthorization.
- [ ] Dirty Git snapshot rejected.
- [ ] Clean Git rollback verifies exact resulting state.
- [ ] Package result says manifest restore unless environment reversal actually verified.
- [ ] Project canonical identity migration handles collisions safely.

---

## 8. Persistence / migrations

- [ ] Fresh DB -> latest schema passes.
- [ ] Representative current DB copy -> latest schema passes with semantic integrity.
- [ ] Pre-migration backup + integrity check procedure tested.
- [ ] Migration failure blocks startup; no silent catch-ignore drift.
- [ ] Canonical Task mapper is singular.
- [ ] Execution lease/idempotency/OAuth/backup/project migrations green.
- [ ] Per-call PRAGMA schema introspection removed.
- [ ] Periodic retention policy active and class-aware.
- [ ] Unresolved reconciliation/security evidence retention safe.
- [ ] Relevant indexes justified by actual query plan evidence.

---

## 9. Performance / scalability

- [ ] Redesign baseline benchmark recorded.
- [ ] No unexplained >2x core DB/metrics regression from audited baseline.
- [ ] Search aggregate byte cap regression green.
- [ ] Search/expensive-op concurrency cap regression green.
- [ ] 25k/250k actual metrics query benchmarks recorded.
- [ ] EXPLAIN plans for primary queries recorded.
- [ ] Session/context memory remains bounded under churn test.
- [ ] Retention large-fixture cleanup bounded.
- [ ] Event-loop delay captured under relevant load.
- [ ] SQLite/client-server DB decision remains evidence-backed/ADR documented.

---

## 10. Observability / logging

- [ ] Opaque separate secret args redacted.
- [ ] Raw access/refresh/bootstrap/auth-code/PKCE verifier values absent from logs.
- [ ] Business vs observability outcome separation test green.
- [ ] Prometheus output passes golden/parser and promtool where available.
- [ ] HELP/TYPE one per family; bounded labels only.
- [ ] HTTP auth/session failures logged safely without headers/cookies/tokens.
- [ ] Security events include scope expansion, sensitive denial, token replay, rate limits, reconciliation.
- [ ] Session metrics/history bounded.
- [ ] JSONL rotation/permissions/retention documented.
- [ ] Observability-degraded health/metric signal works.

---

## 11. Tests / static validation

- [ ] Build/typecheck green.
- [ ] Full unit/integration/security/E2E/property/failure-injection suite green.
- [ ] All 13 HIGH exploit regressions permanent/green.
- [ ] HTTP/OAuth modern E2E release-gated.
- [ ] Critical per-file/glob coverage thresholds green.
- [ ] Architecture tests green.
- [ ] Test fixtures isolated; configured multi-worker profile stable in repeated Windows/CI runs.
- [ ] No test uses real secrets or destructive user repository actions.
- [ ] `git diff --check`/format policy green on intended changes.
- [ ] Dependency audit green or owner-approved documented exception.

---

## 12. CI / supply chain / container

- [ ] Clean checkout frozen install green.
- [ ] No Docker unfrozen dependency fallback.
- [ ] GitHub Actions least privilege.
- [ ] Third-party actions pinned to full commit SHAs.
- [ ] Secret/config scans green.
- [ ] Runtime image non-root.
- [ ] No secret/test DB/log/local data baked into image.
- [ ] Image health smoke green.
- [ ] Authenticated MCP container smoke green.
- [ ] Base image tag/digest/update policy recorded.
- [ ] Release commit, lock hash, image digest, Node/pnpm and schema versions recorded.

---

## 13. Configuration / operations

- [ ] One typed `HOOSHIX_*` configuration contract.
- [ ] Stale `MCP_API_KEY` rejected; deprecated aliases bounded/documented.
- [ ] No literal `hooshix-v2-secret` remains.
- [ ] Non-interactive service/watchdog starts correct Node/pnpm/built artifact.
- [ ] One current production runbook (local stdio/HTTP; public exposure delegated to the external deployment project).
- [ ] Loopback-bind and public-base-URL contract documented and tested locally/fixture where possible.
- [ ] Token rotation/revocation operator procedure documented.
- [ ] DB backup/migration/restore procedure documented.
- [ ] `outcome_unknown` reconciliation procedure documented.
- [ ] Incident response quick procedures documented.

---

## 14. Documentation

- [ ] `README.md` updated and concise.
- [ ] `docs/ARCHITECTURE.md` current.
- [ ] `docs/SECURITY.md` current.
- [ ] `docs/OPERATIONS.md` current.
- [ ] `docs/TOOLS.md` generated/current.
- [ ] `docs/PROTOCOL_COMPATIBILITY.md` current.
- [ ] `docs/MIGRATIONS.md` current.
- [ ] `docs/RELEASE.md` current.
- [ ] Tool/config docs clean-diff generation gate green.
- [ ] Conflicting old runbooks removed/archived.
- [ ] Audit provenance retained.

---

## 15. Final sign-off

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