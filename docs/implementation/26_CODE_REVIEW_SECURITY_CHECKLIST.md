# Code Review & Security Checklist

Use this checklist on every implementation changeset/PR. For a phase gate, all applicable items must be checked with evidence. “N/A” requires a short reason.

---

## 1. Finding / scope traceability

- [ ] Change cites one or more audit finding IDs or an explicit architecture/migration task ID.
- [ ] `20_FINDINGS_TRACEABILITY_MATRIX.md` row is updated or linked in progress ledger.
- [ ] No unrelated pre-existing dirty-tree changes were reverted/staged accidentally.
- [ ] Change stays inside current R-phase scope or explicitly documents a dependency-crossing reason.
- [ ] User-facing behavior changes are reflected in the appropriate spec/docs.

---

## 2. Hexagonal / Clean dependency review

- [ ] Domain imports no Node/external/framework/application/adapters/infrastructure modules.
- [ ] Application imports only Domain/Application contracts.
- [ ] Inbound adapter calls application use cases only.
- [ ] Inbound adapter does not import concrete outbound adapter.
- [ ] Outbound adapter implements an application-owned port.
- [ ] Concrete construction occurs in composition/bootstrap only.
- [ ] No new global mutable authorization/workspace state.
- [ ] No raw SQL outside SQLite adapter/migrations.
- [ ] No `process.env` outside config/bootstrap.
- [ ] No MCP SDK type leaks into Domain/Application.
- [ ] No duplicate tool/security policy map was introduced.

---

## 3. Operation authorization review

For any externally callable operation:

- [ ] OperationId/descriptor exists in canonical catalog.
- [ ] Permission, OAuth scope, risk, effect class, approval policy and workspace behavior are defined once.
- [ ] Unknown/default path denies or requires approval, never implicitly allows.
- [ ] Server permission ceiling enforced.
- [ ] Principal scopes can only reduce authority.
- [ ] Exact workspace scope used (task persisted scope or current application context).
- [ ] Scope expansion is recognized; unrestricted requires server allow flag + ADMIN + exact approval.
- [ ] Approval binds exact task/step/operation/argument fingerprint/scope mutation as applicable.
- [ ] Direct and Task paths reach same application authorization before side effect.

---

## 4. Filesystem/path review

- [ ] Raw user path canonicalized through PathCanonicalizerPort.
- [ ] Realpath/symlink/junction containment considered.
- [ ] Sensitive path policy checked before reading/writing/deleting/restoring.
- [ ] Search skips sensitive target before I/O.
- [ ] Search/file size/result/aggregate byte budgets enforced.
- [ ] File mutation preserves backup-before-effect and atomic write/exclusive create controls.
- [ ] CAS/revision preconditions preserved where required.
- [ ] Restore uses stored absolute target and revision guard.
- [ ] Historical restore is explicit/approved.
- [ ] Path returned externally is safe/relative where appropriate; host absolute path disclosure justified if retained.

---

## 5. Process/Git/package review

- [ ] Process execution is argv-separated, `shell:false` equivalent.
- [ ] Executable allowed by canonical policy.
- [ ] CWD authorized.
- [ ] Environment sanitized and excludes bootstrap/access/refresh/other unrelated secrets.
- [ ] Path-bearing arguments of auto-approved commands validated.
- [ ] `git diff --no-index` cannot auto-read outside scope.
- [ ] Unknown flags/forms default to approval or block.
- [ ] Timeout/output limits present.
- [ ] Cancellation/termination result explicit.
- [ ] Git rollback only uses clean-snapshot contract.
- [ ] Package compensation wording/result does not imply unverified environment rollback.

---

## 6. Task execution / recovery review

- [ ] No non-idempotent unknown outcome auto-retries.
- [ ] ExecutionReceipt persisted/used where side-effect identity matters.
- [ ] Timeout waits for bounded termination acknowledgement/result.
- [ ] Crash recovery loads full canonical Task aggregate.
- [ ] Running mutating legacy/current step becomes unknown unless replay-safe proof exists.
- [ ] Durable execution lease acquired/renewed/released correctly.
- [ ] Lease does not override reconciliation requirement after crash.
- [ ] Task idempotency compares canonical payload/scope identity.
- [ ] Tool idempotency key binds args/scope/operation.
- [ ] Terminal Task plan mutation semantics are explicit.
- [ ] Approval cannot be reused after argument/plan change.

---

## 7. OAuth / HTTP / MCP review

- [ ] Current official MCP v2/2026 docs were rechecked if protocol/auth code changed.
- [ ] Production path uses supported SDK v2 APIs after migration.
- [ ] Modern HTTP correctness does not depend on transport session ID.
- [ ] Bootstrap secret is not returned/accepted as OAuth client access token.
- [ ] Access token hash persisted, expiry/resource/scope/revocation enforced.
- [ ] Refresh token rotates atomically; replay behavior tested.
- [ ] Authorization code PKCE/client/redirect/resource/expiry/single-use preserved.
- [ ] RFC 9207 issuer handling enabled as required by current MCP SDK/profile.
- [ ] Protected resource/auth metadata current and canonical public URL configured.
- [ ] No bearer token in query string.
- [ ] Public base URL not derived from attacker-controlled Host when production public mode.
- [ ] CORS origin allowlist explicit.
- [ ] Public OAuth/MCP rate/concurrency limits applied.
- [ ] Liveness/readiness contain no sensitive diagnostics.
- [ ] Dashboard browser session is separate from MCP bearer and has secure cookie/CSRF properties where applicable.

---

## 8. Persistence/migration review

- [ ] Schema change has a versioned migration.
- [ ] No catch-ignore schema evolution.
- [ ] Migration tested from empty + representative current DB copy.
- [ ] Migration backup/integrity procedure exists for risky transform.
- [ ] Task mapper remains singular/canonical.
- [ ] New uniqueness/canonicalization migration detects collisions before enforcing.
- [ ] Tokens stored hashed, not raw.
- [ ] Lease/idempotency operations atomic.
- [ ] New index justified by actual query plan/benchmark.
- [ ] Retention classification specified for new table/record.
- [ ] Unresolved reconciliation/security evidence is not accidentally aged out.

---

## 9. Observability / secrets review

- [ ] Post-effect telemetry failure cannot change known effect result to failure.
- [ ] Raw file content not logged.
- [ ] Access/refresh/bootstrap tokens, authorization codes, PKCE verifiers not logged.
- [ ] Separate secret flag values redacted.
- [ ] HTTP Authorization/Cookie/query/body sensitive data excluded from logs.
- [ ] Metric labels bounded; no path/task/correlation/user arbitrary cardinality.
- [ ] Prometheus HELP/TYPE format valid.
- [ ] Security-relevant deny/approval/reconciliation events emitted.
- [ ] Observability degradation visible without recursive failure.

---

## 10. Performance / resource review

- [ ] Client-controlled loops/I/O have explicit budgets.
- [ ] Search aggregate byte and concurrency limit considered.
- [ ] Child process/concurrent expensive-op limit considered.
- [ ] Synchronous SQLite request-path work remains short.
- [ ] No new unbounded in-memory map/history.
- [ ] Retention/TTL supplied for new cache/session/state.
- [ ] Benchmark run if hot query/path materially changed.
- [ ] Performance optimization does not weaken security/path validation.

---

## 11. Test review

- [ ] Confirmed defect regression written before/with fix.
- [ ] Test hits externally meaningful behavior, not only private implementation detail.
- [ ] Fake secrets only.
- [ ] Destructive Git/package operations use disposable fixture.
- [ ] Test DB/workspace/log/port isolated.
- [ ] Failure-path/edge behavior tested, not only happy path.
- [ ] Architecture test updated for new boundary.
- [ ] Coverage for critical branch adequate.
- [ ] Property/fuzz target updated if parser/policy/state surface changed.
- [ ] Broader affected profile/full suite run before phase closure.

---

## 12. Supply-chain/config/docs review

- [ ] No unfrozen dependency fallback.
- [ ] New dependency exact-pinned/reviewed and lockfile intentional.
- [ ] Build scripts/postinstall impact reviewed.
- [ ] No real secret/example default committed.
- [ ] Canonical config schema updated; no scattered env read.
- [ ] Node/runtime compatibility checked.
- [ ] Tool/config generated docs stay in sync.
- [ ] Deprecated legacy docs/variables updated according to migration plan.

---

## 13. Reviewer sign-off template

```text
Changeset/PR:
Findings/tasks:
Architecture review: PASS/FAIL
Security review: PASS/FAIL
Data integrity/recovery review: PASS/FAIL/N/A
Protocol/OAuth review: PASS/FAIL/N/A
Performance review: PASS/FAIL/N/A
Tests/commands reviewed:
Residual risks:
Required follow-up:
Reviewer decision:
```

A failed critical section blocks merge into the redesign/release branch.