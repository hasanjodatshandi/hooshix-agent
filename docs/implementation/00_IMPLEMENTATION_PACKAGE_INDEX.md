# HooshiX Remediation & Full Architecture Redesign — Implementation Documentation Package

**Project:** `D:/workspace/hooshix-agent`  
**Authoritative audit input:** `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`  
**Owner directive:** full Hexagonal Architecture + Clean Architecture restructuring, with all HIGH/MEDIUM/LOW findings resolved and the validated controls preserved.  
**Status:** implementation blueprint; code implementation has not been performed by this documentation package.

---

## 1. Purpose

This package is the normative implementation handoff for the next engineering assistant. It is intentionally more detailed than a normal remediation plan. It defines:

- the required target architecture;
- the new source tree and dependency rules;
- domain/application boundaries;
- inbound/outbound ports;
- adapter responsibilities;
- a single authorization/tool execution path;
- OAuth/HTTP security redesign;
- task execution, reconciliation, idempotency and durable-lease semantics;
- file/Git/package compensation rules;
- SQLite schema changes and migration rules;
- performance budgets and benchmark gates;
- observability and audit requirements;
- regression, property, E2E and failure-injection testing;
- CI/CD, container and supply-chain gates;
- configuration and operations source of truth;
- exact finding-to-task-to-test traceability;
- phased execution sequence and release gates;
- a copy/paste implementation prompt for another assistant.

The next implementer MUST NOT replace this package with a shorter high-level plan and MUST NOT patch the findings while leaving the current architectural boundary defects intact.

---

## 2. Normative document order

The implementing assistant must read these documents in this order before changing source code:

1. `../HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`
2. `00_IMPLEMENTATION_PACKAGE_INDEX.md`
3. `01_MASTER_IMPLEMENTATION_PLAN.md`
4. `02_TARGET_HEXAGONAL_CLEAN_ARCHITECTURE.md`
5. `03_TARGET_SOURCE_TREE_AND_MIGRATION_MAP.md`
6. `04_DOMAIN_MODEL_SPEC.md`
7. `05_APPLICATION_USE_CASES_SPEC.md`
8. `06_PORTS_CONTRACTS_SPEC.md`
9. `07_ADAPTERS_TECHNICAL_SPEC.md`
10. `08_UNIFIED_TOOL_CATALOG_AND_AUTHORIZATION_SPEC.md`
11. `09_SECURITY_THREAT_MODEL_AND_REMEDIATION_SPEC.md`
12. `10_HTTP_OAUTH_SECURITY_SPEC.md`
13. `31_MCP_2026_PROTOCOL_AND_SDK_MIGRATION_SPEC.md`
14. `11_TASK_EXECUTION_RECOVERY_IDEMPOTENCY_SPEC.md`
15. `12_DATA_INTEGRITY_BACKUP_ROLLBACK_SPEC.md`
16. `13_PERSISTENCE_SCHEMA_MIGRATION_SPEC.md`
17. `14_PERFORMANCE_SCALABILITY_CAPACITY_SPEC.md`
18. `15_OBSERVABILITY_AUDIT_LOGGING_METRICS_SPEC.md`
19. `16_TEST_STRATEGY_REGRESSION_FUZZ_E2E.md`
20. `17_CI_CD_SUPPLY_CHAIN_CONTAINER_SPEC.md`
21. `18_CONFIGURATION_OPERATIONS_RUNBOOK_SPEC.md`
22. `19_DOCUMENTATION_SOURCE_OF_TRUTH_PLAN.md`
23. `20_FINDINGS_TRACEABILITY_MATRIX.md`
24. `21_PHASED_EXECUTION_BACKLOG.md`
25. `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`
26. `23_MIGRATION_CUTOVER_ROLLBACK_STRATEGY.md`
27. `25_ARCHITECTURE_DECISION_RECORDS.md`
28. `26_CODE_REVIEW_SECURITY_CHECKLIST.md`
29. `27_RELEASE_READINESS_CHECKLIST.md`
30. `28_REFERENCE_STANDARDS.md`
31. `29_IMPLEMENTATION_PROGRESS_LEDGER.md`
32. `30_CHANGESET_AND_PR_STRATEGY.md`
33. all ADRs under `adrs/` in numeric order.
34. **Only then:** `24_ASSISTANT_IMPLEMENTATION_PROMPT.md` and begin implementation.

The prompt file is placed numerically at 24 because it is the user-facing handoff artifact, but the assistant must read the technical package first.

---

## 3. Architectural non-negotiables

The following rules are mandatory for the final codebase:

1. **Domain has zero infrastructure dependencies.** No Node built-ins, MCP SDK, Zod, execa, better-sqlite3, HTTP, filesystem, environment variables, or global mutable process state.
2. **Application depends only on Domain + application-owned ports/contracts.** It may not import concrete adapters or infrastructure libraries.
3. **Inbound adapters call application use cases only.** MCP HTTP/stdio must never call filesystem/Git/package/SQLite adapters directly.
4. **Outbound adapters implement application-owned ports.** SQLite, Node FS, execa, Git, package managers, JSONL, Prometheus, token stores and clock/random adapters live outside application/domain.
5. **One tool execution gateway.** Both direct MCP tools and durable Task steps invoke the same `ExecuteToolUseCase`; authorization cannot be bypassed by choosing a different adapter path.
6. **One canonical tool metadata source.** Tool ID, risk, required permission, approval policy, side-effect class, scope behavior and capability metadata are defined once and checked exhaustively.
7. **One canonical task hydration path.** Normal reads, crash recovery and reporting must reconstruct Task aggregates through the same mapper/repository contract.
8. **No global workspace authorization state.** Workspace scope is session/principal-scoped for direct calls and immutable/persisted for tasks.
9. **No claim of exactly-once external effects.** Side-effecting steps use explicit execution receipts, idempotency where possible, `outcome_unknown`, reconciliation and durable execution leases.
10. **Compensation contracts must be truthful.** Git, package and file restore APIs may claim only guarantees they can prove.
11. **HTTP OAuth tokens are issued credentials, not aliases of the bootstrap/master secret.** Access tokens expire and are audience/resource/scope bound; refresh tokens rotate.
12. **Configuration is fail-fast and centralized.** No `process.env` reads outside the configuration adapter/bootstrap boundary.
13. **SQL is confined to SQLite outbound adapters/migrations.** No raw SQL in MCP tools, task use cases or domain/application services.
14. **Critical regressions are written before the corresponding fix.** A finding is not closed without an executable acceptance test.
15. **Architecture boundaries are executable gates.** Tests/CI must fail on forbidden imports or duplicated boundary paths.

---

## 4. Existing controls that must be preserved

The redesign must carry forward, not replace, the audit-validated strengths:

- `shell:false` argv-separated process execution;
- executable allowlist and control-character rejection;
- SQL-atomic approval create/approve/consume bound to task/step/action;
- PKCE S256 and one-time authorization-code behavior;
- static single-pass template resolution with no eval;
- atomic file write using temp + fsync + rename and exclusive create;
- backup-before-mutation / displaced-backup undo chain;
- explicit task state machine including `outcome_unknown`;
- SQLite WAL, foreign keys, busy timeout and short transactions for current scale;
- strict input/output/file/task bounds;
- exact dependency pins, pnpm lockfile and pnpm build-script allowlist;
- Vitest as the primary test runner;
- correlation IDs, execution timeline and structured observability concepts.

If the restructuring temporarily breaks one of these controls, the migration phase must not be considered complete.

---

## 5. Completion definition for the entire program

The program is complete only when all of the following are true:

- all 13 HIGH, 29 MEDIUM and 12 LOW audit findings are either fixed or explicitly resolved by a truthful contract change that passes its acceptance test;
- direct and Task tool execution share the same authorization and execution use case;
- the new architecture passes dependency-boundary tests;
- HTTP OAuth/resource-server behavior passes process-level E2E tests;
- crash/timeout tests prove uncertain mutations are not automatically replayed;
- Git/package/file compensation tests prove their documented guarantees;
- schema migrations upgrade a copy of the current database and pass rollback/backup validation;
- current green baseline is preserved or improved: build, typecheck, full suite, coverage and dependency audit;
- production container builds with frozen lockfile, runs non-root and passes the defined health contract;
- CI enforces architecture/security/test/container gates;
- one operations/configuration contract replaces incompatible launch paths;
- `docs/TOOLS.md`, `docs/SECURITY.md`, `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` represent the implementation that actually ships;
- `27_RELEASE_READINESS_CHECKLIST.md` is fully satisfied.

---

## 6. Editing policy for the implementing assistant

The repository is known to have a heavily dirty working tree. The implementation assistant must:

- treat the current working tree as the input baseline;
- never run `git reset --hard`, `git clean`, mass checkout/revert, or otherwise destroy pre-existing work;
- capture status/diffs before each phase;
- isolate changes by phase and file ownership;
- avoid staging/committing unrelated pre-existing changes;
- follow `23_MIGRATION_CUTOVER_ROLLBACK_STRATEGY.md` for safety;
- update `29_IMPLEMENTATION_PROGRESS_LEDGER.md` as each gate is completed.

---

## 7. Authority and conflict resolution

If implementation documents conflict:

1. Owner directive in `HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md` §31 wins for architecture scope.
2. Security/data-integrity acceptance criteria in this package win over convenience/backward compatibility.
3. `25_ARCHITECTURE_DECISION_RECORDS.md` resolves design choices.
4. `20_FINDINGS_TRACEABILITY_MATRIX.md` controls finding closure.
5. `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md` controls phase completion.
6. Existing source behavior is not normative when it is the behavior being remediated.

No finding may be silently dropped because the redesign makes its old file/location disappear.