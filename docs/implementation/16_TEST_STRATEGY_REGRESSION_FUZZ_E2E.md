# Test Strategy — Regression, Architecture, Property/Fuzz, Failure Injection & E2E

**Primary findings:** MED-21, MED-22, MED-23, MED-24, LOW-08/09/10; verification vehicle for every HIGH/MEDIUM finding.  
**Runner:** retain Vitest.  
**Rule:** confirmed exploit regressions are written before corresponding behavior changes.

---

## 1. Test pyramid for the redesigned architecture

### Domain tests
Pure, fast, no I/O:
- task state transitions;
- retry/effect classification;
- reconciliation rules;
- permission/risk policy value objects;
- idempotency hashing/semantic normalization;
- template resolution invariants.

### Application tests
Use fake/in-memory ports:
- every use case;
- centralized authorization;
- workspace policy;
- task runner/reconciliation;
- OAuth token lifecycle with fake clock/token generator;
- audit-degradation semantics.

### Adapter contract tests
Real technology against disposable fixtures:
- SQLite repositories/migrations;
- Node FS atomic writes/backup;
- execa process termination;
- Git adapter;
- package adapters where safe;
- JSONL audit;
- Prometheus renderer.

### Process-level E2E
- stdio MCP process;
- HTTP MCP modern + transitional legacy support;
- OAuth authorization/token/refresh;
- container smoke/health.

### Failure-injection tests
- crash between effect and persistence;
- telemetry sink failure;
- DB busy/transaction rollback;
- process ignores cancellation;
- concurrent lease/refresh/idempotency races.

---

## 2. Mandatory exploit regression suite

Create `tests/security/regressions/` with one test file per audit finding class. At minimum:

1. HIGH-01 actual MCP workspace handler cannot expand scope without canonical authorization; unrestricted requires exact elevated approval.
2. HIGH-02 `.env`, `.token`, `.ssh/id_rsa` search never reads/returns contents.
3. HIGH-03 `git diff --no-index` outside paths blocked/approval-required with zero content disclosure.
4. HIGH-04 issued access token differs from bootstrap secret and expires by fake clock; refresh rotates.
5. HIGH-05 retry cannot overlap timed-out process awaiting termination.
6. HIGH-06 crash-after-marker-before-persist -> restart marks unknown; marker not executed twice.
7. HIGH-07 persistence round-trip preserves every Task field.
8. HIGH-08 dirty Git snapshot rejected before reset/clean possible.
9. HIGH-09 package manifest compensation cannot report environment rollback without verification evidence.
10. HIGH-10 Dockerfile contains no unfrozen fallback.
11. HIGH-11 stale auth variable/static secret rejected by config tests and secret scan.
12. HIGH-12 production health probe reaches final unauthenticated liveness endpoint successfully.
13. HIGH-13 two OS processes race same Task lease -> exactly one external marker.

These tests are release-blocking.

---

## 3. HTTP/OAuth E2E suite

Create disposable server fixture:
- free local port;
- temp SQLite DB;
- temp workspace;
- generated fake bootstrap token;
- fixed public base URL for local fixture;
- fake/controllable clock at application layer where possible.

Cases:
- unauthorized MCP -> 401 + correct challenge metadata;
- wrong scope -> 403;
- valid token -> allowed operation;
- expired/revoked/wrong-resource token -> rejected;
- query-token rejected;
- PKCE S256 valid/invalid;
- authorization code single-use;
- issuer/resource/client/redirect validation;
- refresh rotation, concurrent refresh one winner, replay detection;
- rate limiting;
- host/origin validation;
- `/health/live` and `/health/ready` contract;
- metrics auth and Prometheus format;
- modern MCP 2026 protocol negotiation/serving; legacy behavior only if explicitly supported.

---

## 4. Architecture tests

Create static import/dependency tests. CI fails when:

- `src/domain/**` imports anything outside domain or external/Node modules;
- `src/application/**` imports adapters/infrastructure/Node/MCP/Zod/execa/better-sqlite3;
- inbound adapters import outbound adapters;
- raw SQL exists outside SQLite adapter/migrations;
- `process.env` exists outside configuration/bootstrap;
- MCP SDK packages imported outside MCP inbound/infrastructure serving adapters;
- execa imported outside process/Git/package outbound adapters;
- better-sqlite3 imported outside SQLite adapter;
- legacy `withAgentDatabase`, global workspace guard, duplicate authorization maps survive after cutover;
- every operation descriptor lacks exactly one external schema/handler mapping.

Prefer AST/static-import parsing over fragile substring checks where feasible; a simple controlled scanner is acceptable initially if tested.

---

## 5. Coverage policy

Do not chase global 100%.

Maintain global minimum at least current gate while adding critical per-file/glob thresholds.

Target after redesign:
- Domain: branches >= 90%; statements/functions/lines >= 95% where pure.
- Application security/recovery/task runner/OAuth: branches >= 85% initially, raise toward 90% based on feasibility.
- Critical adapters (auth/token, SQLite mapper/migrations, FS restore/process terminate): branches >= 80% plus scenario tests.
- UI/HTML/static rendering may use lower thresholds if behavior E2E covers them.

Coverage exclusions require explicit rationale in config/comment/ADR; HTTP/OAuth cannot be excluded merely because child-process coverage is hard. Behavioral E2E remains mandatory even if coverage merge remains imperfect.

---

## 6. Property-based / fuzz strategy

Keep it targeted and deterministic.

Recommended framework: evaluate a current maintained TS property library during implementation; adding `fast-check` is acceptable if current compatibility/security review passes. If no library is chosen, deterministic generators may be implemented locally.

Targets:
- path canonicalization variants, separators, traversal, symlink/junction fixtures;
- sensitive path patterns/casing;
- command argv/flag combinations, especially safe-list escapes;
- template resolver strings/no recursive evaluation;
- task plan dependency/runWhen validation;
- idempotency canonical serialization stability;
- OAuth expiry/scope/resource token records;
- refresh generation/replay state machine;
- state-machine transitions;
- operation catalog/schema completeness.

Properties must have fixed seeds logged on failure and minimal reproducible counterexample output without secrets.

---

## 7. Parallel test isolation

Current `maxWorkers:1` remains until isolation is complete.

Refactor fixtures so every worker/test file receives unique:
- SQLite DB/WAL/SHM path;
- workspace root;
- log directory;
- server port;
- bootstrap token/session store;
- Git repository.

Global singletons must be removed or composition-scoped.

After isolation:
1. run full suite at 2 workers;
2. run at 4 workers;
3. repeat multiple times on Windows CI;
4. only then raise default `maxWorkers`.

If product runtime intentionally contains process-local singleton adapter state, tests instantiate composition roots independently rather than mutating shared module globals.

---

## 8. Failure injection catalog

### Persistence
- transaction throws mid-save -> rollback;
- migration fails -> startup blocks;
- audit DB write fails after known effect -> outcome preserved.

### Process
- ignores cancellation;
- exits during cancel race;
- produces oversized output;
- times out after external marker.

### Filesystem
- backup succeeds, write fails;
- write succeeds, audit fails;
- restore revision conflict;
- repeated absent restore.

### Recovery
- process killed after effect before completed persistence;
- expired lease takeover;
- incomplete/corrupt persisted task rejected, not silently defaulted.

### OAuth
- clock crosses expiry boundary;
- concurrent refresh race;
- consumed refresh replay;
- wrong issuer/resource/scope.

---

## 9. Test fixture policy

- never read real `.token`, `.env`, keys or user secrets;
- fake credentials only;
- destructive Git/package tests only in disposable temp directories/environments;
- no `git reset --hard` in the working repository;
- generated DBs/logs under OS temp/test paths and cleaned after tests;
- fixtures include Windows path behavior because production/dev is Windows-relevant;
- no test depends on Internet access except optional isolated integration tests explicitly tagged.

---

## 10. Test command profiles

Define scripts such as:

```text
pnpm test:unit
pnpm test:architecture
pnpm test:security
pnpm test:integration
pnpm test:e2e:stdio
pnpm test:e2e:http
pnpm test:failure-injection
pnpm test:property
pnpm test:coverage
pnpm test:all
```

Actual script names may vary but CI stages must be separable for diagnosis.

---

## 11. Mutation/security-static consideration

Do not add heavy tooling by default. After deterministic regressions exist, consider:
- ESLint rules for banned imports/no-floating promises/security patterns;
- Semgrep/custom rules for raw SQL/env/MCP SDK boundaries;
- mutation testing only for critical pure policy modules if value justifies runtime.

Minimum required: architecture tests + TypeScript strict + `git diff --check` + secret scan + dependency audit.

---

## 12. Definition of done

- all 13 HIGH regressions permanent and green;
- every MED finding with behavior impact has acceptance coverage;
- HTTP/OAuth modern transport E2E is release-gated;
- architecture dependency tests enforce Clean/Hexagonal rules;
- critical branch thresholds prevent global coverage masking;
- test fixtures are isolated enough for multi-worker validation, or single-worker remains explicitly justified until completed;
- property tests cover policy/parser/path/token/state boundaries;
- failure-injection tests cover timeout/crash/audit/lease/restore scenarios;
- no tests use real secrets or destructive user repository operations.