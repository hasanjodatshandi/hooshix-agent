# Phased Execution Backlog — Executable Work Breakdown

**Authority:** `HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md` + implementation package documents 00–20.  
**Purpose:** turn the remediation/redesign program into an executable backlog for another engineering assistant.  
**Rule:** no phase may be marked complete without the corresponding acceptance gate in `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`.

---

## Operating rules

For every backlog item the implementer must record in `29_IMPLEMENTATION_PROGRESS_LEDGER.md`:

- task ID;
- affected audit finding IDs;
- files created/modified/deleted;
- regression test added first;
- commands run and results;
- schema/config migration impact;
- rollback/recovery note;
- residual risk.

Never combine unrelated security, architecture, formatting and documentation changes in one changeset.

---

# R0 — Baseline protection and regression capture

### R0.01 Repository baseline inventory
- capture `git status --short`, branch, Node/pnpm versions;
- capture current build/typecheck/test/coverage baseline;
- do not reset/revert dirty worktree;
- record all existing untracked/modified files.

### R0.02 Disposable test fixtures
Create reusable helpers for:
- temp workspace roots;
- temp SQLite DB per test/worker;
- disposable Git repository;
- fake package-manager environment;
- fake clock/random/token generator;
- ephemeral HTTP port;
- child-process termination harness;
- multi-process task lease fixture.

### R0.03 Security regressions — expected failing before fixes
Add focused tests for:
- HIGH-01 workspace mutations through actual MCP adapter and Task path;
- HIGH-02 `.env`, `.token`, `.ssh`, cloud credential search exclusion;
- HIGH-03 `git diff --no-index` outside path;
- HIGH-04 token expiry + refresh-token replay;
- MED-01 query-string token rejection;
- MED-02 separated argument secret redaction;
- MED-04 shell cwd escape.

### R0.04 Reliability/data-integrity regressions
Add tests for:
- HIGH-05 timeout waits for termination acknowledgement;
- HIGH-06 crash-after-effect does not auto-replay;
- HIGH-07 recovery hydration preserves all Task fields;
- HIGH-08 dirty Git snapshot behavior;
- HIGH-09 package rollback truthfulness;
- HIGH-13 cross-process lease;
- MED-05 audit sink failure after successful effect;
- MED-07 canonical project identity;
- MED-08 idempotency key + payload hash;
- MED-09 terminal append;
- MED-10 repeated absent backup restore;
- MED-11 revision guarded restore;
- MED-12 immutable restore target.

### R0.05 Architecture gate scaffold
Create import-boundary tests before moving behavior. Gate may initially fail on legacy code but must protect new tree immediately.

**Exit evidence:** baseline documented; every HIGH has a regression or safe fixture-based contract test.

---

# R1 — Hexagonal/Clean architecture skeleton

### R1.01 Create final directories
Create only the target directories specified in documents 02/03. Do not mass-move implementation yet.

### R1.02 Domain primitives
Implement pure types for:
- TaskId, StepId, ToolId, ApprovalId, ExecutionId;
- PermissionLevel, ToolRisk, ToolEffect;
- WorkspaceScope;
- StepOutcome / ReconciliationState;
- ExecutionReceipt;
- idempotency request identity;
- domain errors.

### R1.03 Application ports
Add the ports in document 06, initially backed by compatibility adapters where necessary.

### R1.04 Application use-case contracts
Create interface/classes for the use cases in document 05 without yet removing legacy runtime.

### R1.05 Composition root
Create one explicit composition module that wires use cases to adapters. No service locator or DI framework.

### R1.06 Dependency rule tests
Enforce:
- Domain imports Domain only;
- Application imports Domain/Application only;
- no Node/MCP/Zod/SQLite/execa in Domain/Application;
- no raw SQL outside SQLite adapter;
- no `process.env` outside config/bootstrap;
- no inbound -> outbound adapter imports.

**Exit evidence:** new architecture compiles independently with fake adapters.

---

# R2 — Unified Tool Gateway / authorization / workspace boundary

### R2.01 Canonical Tool Catalog
Implement one exhaustive catalog for all ToolIds with:
- risk;
- required permission;
- effect class;
- approval policy;
- workspace scope class;
- idempotency capability;
- capability tags.

### R2.02 Unified `ExecuteToolUseCase`
All direct MCP and durable Task tool execution must call this use case before any effect.

### R2.03 Authorization service
Implement effective authority computation from:
- server ceiling;
- principal/token scopes;
- ToolDescriptor;
- exact requested arguments;
- workspace scope;
- task/approval context.

### R2.04 Workspace context model
Replace global mutable workspace authority with:
- session/principal-scoped direct context;
- immutable persisted Task scope.

### R2.05 Scope expansion control
`unrestricted` requires:
- production config explicitly allowing it;
- ADMIN effective permission;
- explicit human approval bound to exact scope mutation;
- security audit event.

### R2.06 Sensitive path policy
Apply the same policy to every read path including search/traversal.

### R2.07 Generic command policy
- reject/approval-gate `git diff --no-index`;
- validate cwd;
- validate path-bearing args for auto-approved Git/GH operations;
- default unknown forms to approval or block.

### R2.08 Direct file API parity
Expose SHA/idempotency capabilities already required by application contracts.

### R2.09 Remove alternate execution paths
After parity tests pass, delete direct adapter -> concrete service shortcuts and legacy executor authorization duplication.

**Exit evidence:** there is exactly one application authorization/tool gateway.

---

# R3 — Durable execution, recovery, idempotency, lease

### R3.01 Canonical Task aggregate mapper
Normal reads, reports, recovery and resume use the same mapper.

### R3.02 Execution receipt model
Every mutation receives an execution receipt containing effect identity, timing and reconciliation metadata where possible.

### R3.03 Timeout handshake
Abort is a request, not termination proof. Implement bounded wait for child termination/adapter acknowledgement.

### R3.04 Unknown-outcome policy
Non-idempotent mutations in unknown state cannot auto-retry.

### R3.05 Reconciliation use case
Provide explicit operator/application action to classify unknown outcome as succeeded/failed/retry-safe.

### R3.06 Crash recovery
`running` mutation -> `outcome_unknown`; read-only/proven-idempotent steps may be safely resumed according to descriptor policy.

### R3.07 Durable task lease
Atomic acquire/renew/release with owner ID, fencing token/epoch, expiry and heartbeat.

### R3.08 Task idempotency
Canonical request hash stored with key; same key/different payload is conflict.

### R3.09 Terminal append
Default: reject append to completed/cancelled tasks. If reopen is required, implement explicit revision use case/state transition.

### R3.10 Telemetry failure separation
Audit/metrics errors must never turn a known-success external effect into `failed`.

**Exit evidence:** crash/timeout/multiprocess failure-injection suites pass.

---

# R4 — Backup/restore/Git/package truthfulness

### R4.01 File backup schema
Persist immutable:
- absolute target;
- previous state present/absent;
- pre-revision;
- expected post-revision;
- backup content reference;
- created/restored timestamps separately.

### R4.02 Revision-guarded restore
Default restore checks current revision. Historical/force mode must be explicit and approval-gated where destructive.

### R4.03 Repeated restore semantics
Define idempotent result or explicit already-restored result; never mutate snapshot type.

### R4.04 Canonical project identity
Persist normalized identity and enforce unique index.

### R4.05 Git snapshot contract
Require clean repository. Record commit/branch and reject dirty snapshots unless a future complete dirty-state snapshot implementation is added.

### R4.06 Git rollback adapter
Use exact snapshot, workspace authorization and destructive approval. Do not claim restoration of state never captured.

### R4.07 Package compensation
Rename current contract to manifest snapshot/restore. Manager-specific full environment rollback is a separate capability and may be `unsupported`.

**Exit evidence:** disposable fixtures verify actual documented guarantees.

---

# R5 — HTTP/OAuth/session security

### R5.01 Separate bootstrap secret from issued credentials
Never return the master/bootstrap secret as client access token.

### R5.02 Token repository
Persist hashed access/refresh tokens with principal/client/resource/scopes, issuance, expiry, revocation, refresh family and replay state.

### R5.03 Access token issuance/validation
Use random opaque tokens or another explicitly documented secure format; enforce expiry/resource/client/scopes.

### R5.04 Refresh rotation
One-time refresh token semantics with family replay detection and invalidation.

### R5.05 MCP protected-resource metadata and current auth discovery
Implement current MCP-required discovery behavior compatible with the targeted spec version.

### R5.06 Remove query bearer
Monitoring routes reject master/access credentials in query string.

### R5.07 Browser/monitoring authentication
Use separate short-lived session/scoped credential model if browser dashboard remains.

### R5.08 Rate limiting
Per principal/IP budgets and separate expensive-operation concurrency budgets.

### R5.09 Session lifecycle
Idle TTL, absolute TTL and bounded active sessions.

### R5.10 Public base URL / CORS
Public HTTP mode requires trusted configured base URL; restrict CORS.

### R5.11 Health endpoints
Unauthenticated minimal liveness; readiness may verify dependencies without leaking secrets.

### R5.12 Secret-file permissions
POSIX bootstrap token/secret file owner-only; validate existing mode.

**Exit evidence:** HTTP/OAuth process E2E passes with fake clock and token replay cases.

---

# R6 — Persistence/performance/observability

### R6.01 Migration-only schema evolution
Delete runtime `ALTER TABLE`/silent schema self-healing outside migrations.

### R6.02 Retention service
Explicit policy per table; periodic scheduler; dry-run/report capability.

### R6.03 Metrics query benchmark
Build 25k and 250k representative datasets; benchmark actual dashboard queries and inspect query plans.

### R6.04 Evidence-based indexes
Add indexes only after R6.03 proves need.

### R6.05 Search budgets
Aggregate bytes scanned + file count + result count + time budget + application concurrency limiter.

### R6.06 Session metrics pruning
Delete/age closed session records; keep aggregate counters separately.

### R6.07 Remove hot-path PRAGMA
Schema checks only migration/startup.

### R6.08 Prometheus format
Correct HELP/TYPE metadata and validate with parser/promtool where available.

### R6.09 Audit logging
Fix separated-arg redaction; sanitize environment/arguments; add telemetry-degraded metric.

**Exit evidence:** benchmark and observability gates pass without unexplained material regression.

---

# R7 — Configuration/deployment/supply chain/CI

### R7.01 Typed config schema
One loader for Node mode, transport, DB path, permission ceiling, token/bootstrap settings, public base URL, CORS, retention, rate limits and workspace policy.

### R7.02 Legacy env handling
`MCP_API_KEY` must fail with an explicit migration error, not silently act as if configured.

### R7.03 Remove static secret guidance
Delete `hooshix-v2-secret` from all executable/docs examples; rotate externally if ever used.

### R7.04 Docker frozen installs
No fallback from frozen lockfile.

### R7.05 Non-root image
Only required data directories writable.

### R7.06 Base image policy
Document digest pin/update strategy.

### R7.07 Healthcheck
Use new liveness endpoint.

### R7.08 Deterministic Node/pnpm bootstrap
Services/watchdogs validate versions before startup.

### R7.09 Single operations runbook
Deprecate obsolete launch scripts or turn them into wrappers around canonical config.

### R7.10 CI
Implement gates from doc 17 and doc 22.

**Exit evidence:** clean-checkout CI + container smoke green.

---

# R8 — Verification hardening

### R8.01 Architecture import gate
Permanent CI blocker.

### R8.02 Security regression suite
All HIGH and relevant MED tests permanent.

### R8.03 HTTP/OAuth E2E
Permanent process-level suite.

### R8.04 Property testing
Deterministic properties for paths, permission/catalog exhaustiveness, templates, state transitions, token rotation/idempotency.

### R8.05 Coverage policy
Per critical module/use-case threshold. Do not require blanket 100%.

### R8.06 Parallel isolation
Unique DB/log/workspace per worker. Raise workers only after green repeated runs.

### R8.07 Static/lint hygiene
Keep strict TS; add only useful rules; always include `git diff --check` and forbidden-import checks.

**Exit evidence:** verification gates in doc 22 pass repeatedly.

---

# R9 — Legacy deletion and documentation cutover

### R9.01 Delete legacy tool execution paths
### R9.02 Delete legacy global workspace guard authority
### R9.03 Delete raw SQL from inbound/application layers
### R9.04 Delete dead config and obsolete runbooks
### R9.05 Consolidate duplicate audit/recovery implementations
### R9.06 Generate `docs/TOOLS.md` from catalog
### R9.07 Write final `docs/ARCHITECTURE.md`, `SECURITY.md`, `OPERATIONS.md`
### R9.08 Update README to current supported behavior only

**Exit evidence:** no architecture-rule violations; no compatibility shim without explicit expiry owner/date.

---

# R10 — Final validation and release candidate

Run the complete checklist in `27_RELEASE_READINESS_CHECKLIST.md`. Public HTTP may only move from NOT READY to release candidate after every required gate is PASS and `20_FINDINGS_TRACEABILITY_MATRIX.md` has no unresolved finding.
