# Master Implementation Plan — Full Hexagonal/Clean Redesign + Complete Audit Remediation

**Input:** `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`  
**Architecture mandate:** full Hexagonal Architecture (Ports & Adapters) + Clean Architecture across the project.  
**Remediation mandate:** close every HIGH/MEDIUM/LOW finding; preserve validated controls; no architectural patchwork.

---

## 1. Program objective

Transform the current HooshiX runtime from a partially layered, partially hexagonal implementation into a codebase where:

- business/workflow policy is isolated from transports, databases, OS/filesystem/process APIs and framework types;
- every MCP invocation and durable task step enters the same application-level tool execution boundary;
- authorization, workspace/sensitive-path policy, side-effect classification, approvals, idempotency and reconciliation are unavoidable application rules;
- persistence is accessed only through application-owned repositories/ports;
- external side effects are represented honestly as succeeded/failed/unknown and are never blindly retried after uncertainty;
- deployment/auth/configuration becomes one executable contract;
- tests and CI prove both architectural boundaries and each audit remediation.

This is a restructuring program, not a collection of isolated fixes.

---

## 2. Implementation principles

### 2.1 Inside-out design

Implement in this dependency order:

1. Domain model and invariants.
2. Application ports/use cases/policies.
3. Outbound adapters.
4. Inbound MCP/HTTP adapters.
5. Infrastructure/bootstrap/composition.
6. Cutover and deletion of legacy duplicate paths.

Do not start by moving folders. Folder changes without dependency inversion do not satisfy the owner directive.

### 2.2 Test-first for confirmed defects

Before changing behavior for a finding:

1. reproduce the old defect with a focused test or failure-injection harness;
2. confirm the test fails against the old behavior;
3. implement through the target architecture;
4. confirm the regression passes;
5. run the phase gate;
6. update the finding matrix and progress ledger.

Where a safe PoC cannot be run destructively (for example dirty Git data loss), construct a disposable repository/environment fixture.

### 2.3 Strangler-style internal migration, final clean cutover

Even though the final architecture is a full redesign, migration should be incremental:

- build new Domain/Application/Ports alongside the old code;
- route one vertical slice at a time through the new application boundary;
- keep behavior tests green;
- delete the old duplicate path only when its replacement has passed the required gates;
- finish with zero forbidden legacy dependency edges.

The final state is not hybrid. Temporary coexistence is allowed only during migration.

---

## 3. Program phases

### Phase R0 — Baseline protection and executable regressions

**Goal:** make the dirty working tree safe to restructure and encode the audit as tests.

Deliverables:

- non-destructive baseline status/diff inventory;
- test fixture helpers for disposable workspaces, repositories, DBs, HTTP ports and child processes;
- failing regression tests for all HIGH findings that are behaviorally testable before architecture changes;
- architecture dependency-rule test scaffold;
- implementation progress ledger initialized.

Mandatory regressions include:

- workspace mutation authorization/unrestricted escalation;
- sensitive `.env/.token/.ssh` search;
- `git diff --no-index` external file read;
- OAuth token expiry and refresh rotation;
- timeout termination confirmation / no overlapping retry;
- crash-after-effect-before-persist -> no automatic replay;
- crash hydration preserves retry/runWhen/attempt/template/idempotency state;
- dirty Git snapshot rejected or fully captured;
- package restore never claims installed-state rollback unless verified;
- Docker frozen-lock fallback absent;
- auth variable/health contract tests;
- cross-process execution lease test.

**Gate:** no production behavior changes yet; baseline tests documented; all existing tests still pass except intentionally added known-defect regressions marked expected-failing during R0 only.

---

### Phase R1 — Architecture skeleton and dependency enforcement

**Goal:** establish the final dependency topology before migrating behavior.

Create:

- `src/domain/**`
- `src/application/**`
- `src/adapters/inbound/**`
- `src/adapters/outbound/**`
- `src/infrastructure/**`
- `src/bootstrap/**`

Create application-owned ports and the composition root described in documents 02–07.

Add architecture rules:

- Domain cannot import application/adapters/infrastructure/Node/external libs.
- Application cannot import adapters/infrastructure/Node/MCP SDK/Zod/execa/better-sqlite3.
- Inbound adapters cannot import outbound adapters.
- Raw SQL only under the SQLite outbound adapter/migrations.
- `process.env` only in infrastructure config/bootstrap.
- MCP SDK only under inbound MCP adapters.
- FS/path/execa/better-sqlite3 only in outbound/infrastructure code.

**Gate:** new skeleton compiles; architecture tests pass; no functional cutover required yet.

---

### Phase R2 — Unified Tool Gateway + Authorization + Workspace Security

**Findings:** HIGH-01, HIGH-02, HIGH-03, MED-04, MED-06, MED-28, plus related LOW items.

Implement:

- canonical `ToolDescriptor` registry;
- `ExecuteToolUseCase` as the sole execution entry point;
- application `AuthorizationService` and `WorkspaceAccessPolicy`;
- principal/session-scoped direct workspace context;
- immutable persisted task execution scope;
- explicit ADMIN + approval requirement for scope expansion/unrestricted mode;
- sensitive-path policy applied to all file-reading/search paths;
- strict safe-command patterns; `git diff --no-index` blocked/approval-gated;
- generic shell cwd and path-bearing args validated;
- direct file schemas expose existing CAS/idempotency options;
- direct MCP and task executor routed through the same use case.

Remove old direct-to-service execution once migrated.

**Gate:** all R2 exploit tests pass; no path exists from inbound adapter to filesystem/process/Git/package adapter except through application use cases.

---

### Phase R3 — Task Execution Reality, Recovery, Idempotency and Lease

**Findings:** HIGH-05, HIGH-06, HIGH-07, HIGH-13, MED-05, MED-08, MED-09.

Implement:

- domain `StepOutcome` / `ExecutionReceipt` / `ReconciliationState`;
- timeout abort + bounded termination acknowledgement;
- no retry of side-effecting `outcome_unknown` steps;
- explicit reconciliation use case;
- canonical Task aggregate hydration;
- persisted task execution lease with owner/token/heartbeat/expiry;
- request-hash task idempotency;
- audit failure cannot rewrite a completed external effect as failed;
- terminal task append contract fixed: reject by default or explicit revision/reopen use case.

**Gate:** crash/timeout/multi-process tests pass; task state equals known execution reality; uncertainty is explicit and blocks unsafe retry.

---

### Phase R4 — Data Integrity, Backup, Git and Package Compensation

**Findings:** HIGH-08, HIGH-09, MED-07, MED-10, MED-11, MED-12.

Implement:

- canonical project path identity persisted and uniquely indexed;
- immutable file backup snapshot state (`previous_state`), absolute target, pre/post revisions;
- restore revision precondition;
- repeated restore semantics defined and idempotent/truthful;
- Git snapshot requires clean tree unless a future complete dirty snapshot implementation is supplied;
- rollback uses a `GitCompensationPort` and cannot claim restoration of unrecorded dirty state;
- package operation uses `PackageManifestSnapshot` and response/status wording that explicitly means manifest restore; full environment rollback only if manager-specific verification proves it.

**Gate:** disposable Git/package/file fixtures prove every contract; schema migration tests pass.

---

### Phase R5 — HTTP, OAuth, Token, Session and Monitoring Security

**Findings:** HIGH-04, MED-01, MED-03, MED-29, LOW token-file hardening.

Implement:

- bootstrap/operator secret separated from OAuth access tokens;
- random access token records with issued/expiry/resource/client/scopes;
- hashed token storage;
- rotating refresh tokens with replay detection/invalidation;
- RFC-aligned resource/audience validation;
- no access token in query string;
- monitoring/browser auth separated from MCP bearer usage;
- rate limiter and session idle/absolute TTL;
- mandatory trusted public base URL for public HTTP mode;
- restricted CORS;
- minimal unauthenticated liveness/readiness endpoints with no sensitive data;
- `.token`/bootstrap secret file owner-only mode on POSIX.

**Gate:** process-level OAuth/HTTP E2E passes using a fake clock; expired/replayed/wrong-audience tokens receive correct 401/403; query token rejected.

---

### Phase R6 — Persistence Lifecycle, Performance and Observability

**Findings:** MED-17, MED-18, MED-19, MED-20, MED-25 and search performance aspect of MED-03/HIGH-02.

Implement:

- schema access solely through migrations/adapters;
- remove per-call PRAGMA schema checks;
- periodic table-aware retention service;
- session metric pruning;
- aggregate search byte budget + search concurrency limiter;
- production-query benchmark dataset and EXPLAIN validation;
- evidence-backed time/order indexes only after benchmark;
- Prometheus HELP/TYPE compliant output;
- audit logging redaction fix for separated flag values;
- telemetry degradation signal without changing business outcome.

**Gate:** performance/retention/metrics tests pass; no significant unexplained regression against baseline; Prometheus format validator passes.

---

### Phase R7 — Deployment, Configuration, Supply Chain and CI

**Findings:** HIGH-10, HIGH-11, HIGH-12, MED-13, MED-14, MED-15, MED-16.

Implement:

- one typed configuration loader;
- explicit canonical auth/config variable names and deprecation behavior;
- fail on stale `MCP_API_KEY` rather than silently ignoring it;
- remove literal `hooshix-v2-secret`;
- Docker frozen install only, no fallback;
- production image non-root;
- base image digest policy and controlled update path;
- healthcheck uses the new liveness endpoint;
- deterministic Node/Corepack/pnpm bootstrap in services/watchdogs;
- one supported production runbook;
- GitHub Actions gates described in document 17;
- secret scan, architecture rules, security regressions, container/config tests and supply-chain checks.

**Gate:** CI is green from a clean checkout; container starts non-root and reports healthy; no legacy secret/env contract remains.

---

### Phase R8 — Verification Hardening, Fuzzing, Coverage and Parallel Isolation

**Findings:** MED-21, MED-22, MED-23, MED-24, LOW fuzz/lint/whitespace items.

Implement:

- permanent exploit regression suites;
- HTTP/OAuth/metrics E2E;
- per-file/glob coverage targets for security/recovery/application critical code;
- property tests for path canonicalization, command policy, template resolution, tool input validation, token rotation and state transitions;
- per-worker temp DB/workspace/log isolation; only then increase worker parallelism;
- separate lint/static rules if justified; at minimum architecture rule tests and `git diff --check`.

**Gate:** target test profiles pass; no test depends on shared fixed DB paths/global workspaces; critical branch coverage meets document 16 targets.

---

### Phase R9 — Legacy deletion, documentation source-of-truth and final cutover

Remove/migrate:

- old direct MCP handler-to-service paths;
- old core/service dependency shortcuts;
- raw SQL outside SQLite adapter;
- duplicate audit/recovery/config layers;
- dead `config/config.json`;
- stale runbooks/tool lists;
- any compatibility shim past its planned deprecation window.

Generate/update:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/OPERATIONS.md`
- generated `docs/TOOLS.md`
- README.

**Gate:** zero architecture-rule violations; zero open finding rows in the traceability matrix; release checklist complete.

---

### Phase R10 — Final release validation

Run from a clean, reproducible environment:

- frozen install;
- architecture tests;
- typecheck/build;
- unit/integration/security/property/E2E suites;
- coverage;
- full single-worker suite and parallel suite if isolation is complete;
- DB upgrade migration on a copy of current data;
- crash/timeout/failure-injection suites;
- production query benchmarks;
- container build/run/non-root/health/security contract;
- `pnpm audit` and secret checks;
- documentation/tool-catalog consistency smoke;
- Git status review ensuring no untracked generated secrets/data.

Only R10 completion can change the public HTTP verdict to release candidate.

---

## 4. Phase dependency graph

```text
R0 Baseline + regressions
 |
 v
R1 Architecture skeleton
 |
 v
R2 Unified tool/auth/workspace
 |
 +--------------------------+
 |                          |
 v                          v
R3 Task execution/recovery  R5 HTTP/OAuth
 |                          |
 v                          |
R4 Data integrity           |
 |                          |
 +------------+-------------+
              v
R6 Persistence/perf/observability
              |
              v
R7 Deployment/config/CI
              |
              v
R8 Verification hardening
              |
              v
R9 Legacy removal/docs/cutover
              |
              v
R10 Final release validation
```

R5 may be developed in parallel with R3/R4 only after R2's common authorization/principal contracts are stable. Schema changes must be coordinated through R13's migration register, not landed ad hoc.

---

## 5. Required change discipline

For every implementation task:

- cite the finding IDs from `20_FINDINGS_TRACEABILITY_MATRIX.md`;
- identify the Domain/Application/Adapter location;
- add or update tests before closure;
- never add a new concrete dependency from Domain/Application outward;
- never access `process.env` directly outside config/bootstrap;
- never add raw SQL outside SQLite adapter/migrations;
- never create another direct tool execution route;
- update `29_IMPLEMENTATION_PROGRESS_LEDGER.md` with evidence and command results.

---

## 6. Public release blocker set

At minimum, public HTTP remains blocked until all of the following are closed and green:

- HIGH-01 through HIGH-12;
- HIGH-13 if deployment can start more than one runtime over the same DB;
- MED-01, MED-02, MED-03, MED-04, MED-05, MED-14, MED-21, MED-22, MED-25, MED-29;
- architecture gate showing one tool authorization path;
- OAuth/HTTP E2E;
- crash/timeout/rollback acceptance tests;
- production container/config/health gates.

The owner directive requires the remaining findings to be fixed as part of the same program even if they are not immediate exposure blockers.