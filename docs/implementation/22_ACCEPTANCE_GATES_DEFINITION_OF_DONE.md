# Acceptance Gates & Definition of Done

**Purpose:** objective completion criteria for every remediation/redesign phase. A phase is not complete because code compiles; it is complete only when its behavioral, architectural, migration and operational gates pass.

---

## Global Definition of Done

A task/phase is DONE only when:

1. mapped finding IDs are listed in the traceability matrix;
2. a regression or contract test exists and demonstrates the intended behavior;
3. Domain/Application dependency rules remain clean;
4. no new direct adapter-to-adapter shortcut is introduced;
5. config/schema/documentation changes are migrated and documented;
6. build/typecheck/affected tests pass;
7. no pre-existing user changes are reverted;
8. the progress ledger contains commands and evidence;
9. review checklist passes;
10. residual risk is explicitly recorded as none/accepted/deferred with owner.

---

# Gate G0 — Baseline Integrity

PASS requires:
- repository baseline status captured;
- no destructive reset/clean/revert;
- Node/pnpm versions recorded;
- current full intended suite baseline recorded;
- disposable fixtures available;
- every HIGH has a failing-before-fix regression or safe contract fixture.

FAIL if implementation begins without exploit/recovery regression coverage.

---

# Gate G1 — Architecture Boundary

PASS requires automated checks proving:
- `src/domain/**` imports only Domain;
- `src/application/**` imports only Application/Domain;
- no `node:*`, MCP SDK, Zod, execa, better-sqlite3 in Domain/Application;
- inbound adapters never import outbound adapters;
- raw SQL exists only in SQLite adapter/migrations;
- `process.env` exists only in config/bootstrap;
- concrete adapter creation happens in composition/bootstrap;
- fake adapters can instantiate and run application use cases without filesystem, SQLite or MCP.

FAIL if architecture is only folder renaming.

---

# Gate G2 — Unified Tool Security Boundary

PASS requires:
- direct MCP and Task paths both call `ExecuteToolUseCase`;
- one exhaustive ToolDescriptor registry;
- no side effect before authorization decision;
- all workspace mutations authorized;
- unrestricted requires server allow flag + ADMIN + explicit approval;
- sensitive search regressions pass;
- `git diff --no-index` bypass regression passes;
- shell cwd/path-bearing safe commands constrained;
- direct file CAS/idempotency parity tests pass;
- catalog completeness test passes.

FAIL if any inbound adapter can call filesystem/process/Git/package implementation directly.

---

# Gate G3 — Execution Reality / Recovery

PASS requires:
- timeout test confirms no retry starts until termination known or grace expires into `outcome_unknown`;
- non-idempotent unknown outcomes cannot auto-retry;
- crash-after-effect fixture does not replay blindly;
- canonical hydration equality test passes for normal/recovery paths;
- durable execution lease blocks second process;
- lease fencing prevents stale owner commits;
- task idempotency key+hash behavior correct;
- audit sink failure cannot convert known effect result to failure;
- terminal append behavior is truthful and tested.

FAIL if persisted state can claim failure/success contrary to known external outcome without an explicit unknown state.

---

# Gate G4 — Compensation & Data Integrity

PASS requires:
- backup records contain immutable previous state + absolute target + revisions;
- repeated restore contract tested;
- restore revision conflict tested;
- project identity canonical uniqueness tested across slash/case forms supported by platform;
- dirty Git snapshot rejected unless complete dirty capture exists;
- Git rollback fixture proves exactly documented guarantee;
- package API wording/status matches manifest-only capability unless full reversal verified;
- migration from legacy backup/project rows tested on copied DB fixture.

FAIL if any API says `rolled_back`/`restored` beyond provable state.

---

# Gate G5 — HTTP/OAuth Security

PASS requires process-level tests for:
- authorization-code PKCE success/failure;
- access token issued separately from bootstrap secret;
- expiry enforced with fake clock;
- wrong audience/resource rejected;
- revoked token rejected;
- refresh rotation and replay detection;
- query-string bearer rejected;
- rate-limit response and retry semantics;
- session idle + absolute TTL;
- configured public base URL required in public mode;
- CORS origin allowlist;
- liveness endpoint no-auth/no-sensitive-content;
- monitoring/dashboard auth model;
- secret-file permission behavior where platform supports it.

FAIL if `expires_in` is not an enforced invariant.

---

# Gate G6 — Persistence / Performance / Observability

PASS requires:
- runtime schema self-healing/PRAGMA hot checks removed from normal tool path;
- migrations are authoritative;
- periodic retention tests cover configured tables;
- session metric records pruned;
- search aggregate byte/concurrency limits tested;
- 25k and 250k representative query benchmark results captured;
- query-plan assertions for selected indexes;
- no unexplained >20% regression in key local baseline unless justified;
- Prometheus output accepted by parser/promtool or equivalent golden parser;
- audit redaction opaque separated-value test passes;
- observability degradation does not alter business outcome.

---

# Gate G7 — Deployment / Supply Chain / CI

PASS requires:
- `pnpm install --frozen-lockfile` only; no fallback;
- canonical `MCP_ACCESS_TOKEN`/new bootstrap secret naming documented and tested;
- legacy `MCP_API_KEY` produces explicit migration error if encountered;
- no `hooshix-v2-secret` literal remains;
- production image runs non-root;
- healthcheck uses liveness contract;
- Node/pnpm versions deterministic in service/watchdog;
- CI runs architecture, security regressions, typecheck, tests, coverage, audit, container/config checks;
- secret scan passes;
- clean checkout build passes.

---

# Gate G8 — Verification Quality

PASS requires:
- all HIGH findings have permanent regressions;
- HTTP/OAuth transport E2E active;
- critical application/security/recovery modules meet agreed per-file branch thresholds;
- property tests deterministic and reproducible;
- parallel suite only enabled after isolated state; repeated parallel runs green;
- `git diff --check` clean for implementation changes;
- no flaky test tolerated by blind retry.

---

# Gate G9 — Legacy Cutover

PASS requires:
- no old direct tool-to-service path;
- no global mutable workspace authorization source;
- no raw SQL outside SQLite adapter/migrations;
- no dead config/runbook presented as supported;
- duplicate audit/recovery layers removed or explicitly retained with documented role;
- generated tool docs match catalog;
- ARCHITECTURE/SECURITY/OPERATIONS/README match shipped behavior;
- all temporary compatibility adapters have removal status resolved.

---

# Gate G10 — Release Candidate

PASS requires every prior gate PASS plus:
- complete traceability matrix: all HIGH/MED/LOW resolved;
- database migration rehearsal on a copy of current data;
- crash/timeout/failure injection full suite green;
- production container smoke green;
- final `pnpm audit` green or documented accepted advisory with owner decision;
- final source/runtime tool schema equivalence smoke green;
- no generated token/secret/database artifacts staged;
- release readiness checklist fully signed off.

Only G10 can authorize changing the public HTTP verdict from NOT PRODUCTION-READY to release candidate.
