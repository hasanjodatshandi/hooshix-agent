# Copy/Paste Prompt for the Implementing Assistant

این متن را می‌توانی مستقیماً به دستیار/Agent بعدی بدهی. مسیر پروژه و اسناد بخشی از قرارداد اجرای کار هستند.

---

## PROMPT START

You are the implementation engineer responsible for a **full remediation and full architectural redesign** of the HooshiX Agent repository.

### Repository
`D:\workspace\hooshix-agent`

### Authoritative audit
`D:\workspace\hooshix-agent\docs\HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`

### Normative implementation package
`D:\workspace\hooshix-agent\docs\implementation\`

The project owner explicitly requires:

1. **Full Hexagonal Architecture (Ports & Adapters) across the entire project.**
2. **Full Clean Architecture dependency direction across the entire project.**
3. It is acceptable to substantially restructure/redesign the project to achieve this final architecture.
4. **All audit findings must be fixed:** 13 HIGH, 29 MEDIUM, 12 LOW. Do not stop after P0/high findings.
5. Preserve every validated positive control listed in the audit and implementation package.
6. Use the **latest authoritative external documentation**, especially for MCP, OAuth, Node, Docker, SQLite, GitHub Actions, Vitest and security standards. Do not rely on model memory for version-sensitive behavior.
7. The target MCP runtime is the current **TypeScript SDK v2 / MCP 2026-07-28 modern protocol**, with compatibility decisions implemented according to ADR-009 and current official docs.

---

# A. Mandatory reading before modifying source

Read the documents in this order **completely**. Do not start coding from this prompt alone.

1. `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`
2. `docs/implementation/00_IMPLEMENTATION_PACKAGE_INDEX.md`
3. `docs/implementation/01_MASTER_IMPLEMENTATION_PLAN.md`
4. `docs/implementation/02_TARGET_HEXAGONAL_CLEAN_ARCHITECTURE.md`
5. `docs/implementation/03_TARGET_SOURCE_TREE_AND_MIGRATION_MAP.md`
6. `docs/implementation/04_DOMAIN_MODEL_SPEC.md`
7. `docs/implementation/05_APPLICATION_USE_CASES_SPEC.md`
8. `docs/implementation/06_PORTS_CONTRACTS_SPEC.md`
9. `docs/implementation/07_ADAPTERS_TECHNICAL_SPEC.md`
10. `docs/implementation/08_UNIFIED_TOOL_CATALOG_AND_AUTHORIZATION_SPEC.md`
11. `docs/implementation/09_SECURITY_THREAT_MODEL_AND_REMEDIATION_SPEC.md`
12. `docs/implementation/10_HTTP_OAUTH_SECURITY_SPEC.md`
13. `docs/implementation/11_TASK_EXECUTION_RECOVERY_IDEMPOTENCY_SPEC.md`
14. `docs/implementation/12_DATA_INTEGRITY_BACKUP_ROLLBACK_SPEC.md`
15. `docs/implementation/13_PERSISTENCE_SCHEMA_MIGRATION_SPEC.md`
16. `docs/implementation/14_PERFORMANCE_SCALABILITY_CAPACITY_SPEC.md`
17. `docs/implementation/15_OBSERVABILITY_AUDIT_LOGGING_METRICS_SPEC.md`
18. `docs/implementation/16_TEST_STRATEGY_REGRESSION_FUZZ_E2E.md`
19. `docs/implementation/17_CI_CD_SUPPLY_CHAIN_CONTAINER_SPEC.md`
20. `docs/implementation/18_CONFIGURATION_OPERATIONS_RUNBOOK_SPEC.md`
21. `docs/implementation/19_DOCUMENTATION_SOURCE_OF_TRUTH_PLAN.md`
22. `docs/implementation/20_FINDINGS_TRACEABILITY_MATRIX.md`
23. `docs/implementation/21_PHASED_EXECUTION_BACKLOG.md`
24. `docs/implementation/22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`
25. `docs/implementation/23_MIGRATION_CUTOVER_ROLLBACK_STRATEGY.md`
26. `docs/implementation/25_ARCHITECTURE_DECISION_RECORDS.md`
27. every file under `docs/implementation/adrs/`
28. `docs/implementation/26_CODE_REVIEW_SECURITY_CHECKLIST.md`
29. `docs/implementation/27_RELEASE_READINESS_CHECKLIST.md`
30. `docs/implementation/28_REFERENCE_STANDARDS.md`
31. `docs/implementation/29_IMPLEMENTATION_PROGRESS_LEDGER.md`
32. `docs/implementation/30_CHANGESET_AND_PR_STRATEGY.md`
33. `docs/implementation/31_MCP_2026_PROTOCOL_AND_SDK_MIGRATION_SPEC.md`
34. `docs/implementation/32_FINAL_IMPLEMENTATION_REPORT_TEMPLATE.md` if present.

After reading, inspect the **current working-tree source**. The repository is known to be heavily dirty and the current working tree—not branch HEAD—is the implementation baseline.

---

# B. External documentation rule

Before each version-sensitive phase, re-open current official sources referenced in `28_REFERENCE_STANDARDS.md`.

Mandatory before R1/R5:
- MCP 2026-07-28 official release/spec material;
- TypeScript SDK v2 home;
- v1 -> v2 migration guide;
- current `support-2026-07-28` guide;
- current protocol versions page.

Mandatory before OAuth work:
- current MCP authorization documentation/SDK requirements;
- RFC 9700;
- RFC 9207;
- RFC 8707;
- RFC 9728;
- RFC 10017 if browser dashboard flow is involved.

If current official docs conflict with an implementation-package detail:
1. do not guess;
2. document the new evidence;
3. update the relevant spec;
4. create/supersede an ADR if the design decision changes;
5. then implement.

Do not use unofficial blog posts when an official spec/RFC/SDK document exists.

---

# C. Absolute architecture rules

These are non-negotiable unless the owner explicitly approves a superseding ADR:

1. Domain has zero infrastructure/framework/Node dependencies.
2. Application depends only on Domain + application-owned ports/contracts.
3. Inbound adapters call application use cases only.
4. Outbound adapters implement application-owned ports.
5. Concrete construction belongs in infrastructure/composition/bootstrap.
6. Direct MCP and durable Task tool execution must converge on **one `ExecuteToolUseCase` before any side effect**.
7. One canonical OperationCatalog defines operation ID, permission, scopes, risk, effect, approval and workspace behavior.
8. No global mutable workspace authorization state.
9. Durable Tasks use immutable persisted WorkspaceScope.
10. No raw SQL outside the SQLite outbound adapter/migrations.
11. No `process.env` outside configuration/bootstrap.
12. No MCP SDK types in Domain/Application.
13. No `execa`, Node FS/path/process or `better-sqlite3` in Domain/Application.
14. One canonical Task aggregate mapper/hydration path.
15. No exactly-once claim for external side effects; use receipts, idempotency, `outcome_unknown`, reconciliation and lease semantics.
16. Compensation/rollback names must match provable guarantees.
17. OAuth access tokens are issued expiring credentials, never aliases of the bootstrap/master secret.
18. Architecture rules must be executable CI tests, not only folder conventions.

Do not solve this by only moving files into new folders while keeping old dependency edges.

---

# D. Controls that MUST be preserved

Do not regress:
- argv-separated process execution with `shell:false` equivalent;
- executable allowlist and control-character rejection;
- SQL-atomic single-use approvals bound to exact task/step/action and validated before consume;
- PKCE S256 and one-time authorization-code semantics;
- static single-pass no-eval template resolution;
- atomic temp+fsync+rename writes and exclusive create;
- backup-before-mutation and displaced-backup undo chain;
- explicit Task state machine including `outcome_unknown`;
- SQLite WAL, foreign keys, busy timeout and short transactions while SQLite remains the adapter;
- input/result/file/task bounds;
- exact dependency/lockfile/build-script allowlist discipline;
- Vitest as primary runner;
- correlation IDs/timeline/structured observability concepts.

A phase is not complete if it fixes a finding by removing one of these protections.

---

# E. Execution method

Implement **R0 through R10** from `21_PHASED_EXECUTION_BACKLOG.md` in dependency order.

For each phase:
1. update `29_IMPLEMENTATION_PROGRESS_LEDGER.md` to `IN_PROGRESS`;
2. execute leaf tasks in the documented order;
3. for confirmed defects, write the regression test **before** changing behavior;
4. implement only through the target architecture;
5. run the phase-specific tests and broader affected suite;
6. run architecture gates;
7. update `20_FINDINGS_TRACEABILITY_MATRIX.md` statuses;
8. use `26_CODE_REVIEW_SECURITY_CHECKLIST.md` on the changeset;
9. evaluate the phase gate in `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`;
10. record exact commands/results/evidence in the ledger;
11. only then start the next dependent phase.

If a gate fails, fix the current phase. Do not declare PASS, skip the test, lower the acceptance criteria, or silently advance.

Parallel development is allowed only where the master plan explicitly permits it and shared contracts are stable.

---

# F. Dirty working-tree safety

This is critical.

- Treat current working tree as user baseline.
- Never run `git reset --hard`, `git clean -fd`, mass checkout/revert, or destructive cleanup.
- Never read or expose real `.token`, `.env`, private keys or credentials for testing.
- Use fake temp fixtures.
- Never run destructive Git/package tests against the actual repository/environment; use disposable fixtures.
- Do not blindly `git add -A` or commit unrelated pre-existing changes.
- Before each phase/changeset, record status/diff scope.
- Follow `23_MIGRATION_CUTOVER_ROLLBACK_STRATEGY.md` and `30_CHANGESET_AND_PR_STRATEGY.md`.

If a safe automatic rollback would overwrite concurrent/pre-existing user changes, do not perform it; document the conflict.

---

# G. Do not redesign outside the approved architecture

The owner approves a full structural redesign to achieve Hexagonal/Clean architecture, but that does **not** authorize unrelated infrastructure bloat.

Do not introduce without evidence/ADR:
- microservices;
- Redis/message broker;
- PostgreSQL solely because SQLite has one writer;
- CQRS/event sourcing;
- Kubernetes;
- generic repository per table;
- DI container framework for its own sake;
- one interface per function;
- container-per-command sandbox;
- replacement test framework.

SQLite remains the target adapter for current scale; correctness across processes is solved with a durable execution lease. Database replacement requires measured need and ADR.

---

# H. MCP v2 / protocol migration requirements

Follow `31_MCP_2026_PROTOCOL_AND_SDK_MIGRATION_SPEC.md` and ADR-009.

- Target MCP TypeScript SDK v2 split packages.
- Target protocol revision 2026-07-28 modern behavior.
- Use current official v2 server patterns (`createMcpHandler`, `serveStdio` or the current superseding APIs).
- Modern HTTP application correctness must not rely on transport session IDs.
- Keep workspace/application state behind explicit application repositories/principal context; Tasks persist scope.
- HooshiX durable Tasks remain application workflows, not automatically coupled to deprecated MCP task wire types.
- Enable current 2026 auth issuer/scope/credential protections as documented by SDK.
- Staged v1+v2 migration is allowed; never mix v1 object instances into v2 APIs.
- Remove v1 only after zero-import proof and E2E.
- Decide any temporary legacy 2025 compatibility through ADR-009 + interoperability tests.

---

# I. Security/reliability completion rules

Do not mark findings closed without the exact acceptance evidence in `20_FINDINGS_TRACEABILITY_MATRIX.md`.

Particularly:
- HIGH-01/02/03 must have real exploit-path regressions.
- HIGH-04 requires real enforced expiry and refresh rotation, not response metadata only.
- HIGH-05/06 require no unsafe overlapping/blind retry.
- HIGH-07 requires full canonical persistence round-trip.
- HIGH-08 requires dirty Git safety.
- HIGH-09 requires truthful manifest/environment semantics.
- HIGH-10/11/12 require real build/config/container tests.
- HIGH-13 requires two OS processes and exactly one lease winner.

All 54 findings must finish `VERIFIED_CLOSED`, unless the owner explicitly marks a finding `DEFERRED_BY_OWNER`. Do not self-defer.

---

# J. Testing requirements

Keep/add:
- domain/application unit tests;
- adapter contract/integration tests;
- exploit regressions;
- failure injection;
- property-based/deterministic fuzz tests;
- stdio E2E;
- HTTP/OAuth modern MCP E2E;
- migration tests;
- two-process lease tests;
- performance/query benchmarks;
- architecture boundary tests;
- container/config/health tests.

Do not chase blanket 100% coverage. Enforce stronger branch thresholds on security/recovery/application critical files.

Fix parallel fixture isolation before increasing worker count. Final owner mandate expects MED-24 closure, not permanent reliance on shared fixed test DB state.

---

# K. Documentation during implementation

As code becomes the shipping implementation, create/update the final current docs according to `19_DOCUMENTATION_SOURCE_OF_TRUTH_PLAN.md`:
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/OPERATIONS.md`
- generated `docs/TOOLS.md`
- `docs/PROTOCOL_COMPATIBILITY.md`
- `docs/MIGRATIONS.md`
- `docs/RELEASE.md`
- README.

Do not use audit reports as operational runbooks.

Tool and configuration inventories should be generated/verified from canonical code metadata so drift fails CI.

---

# L. Reporting cadence

Do not give me only intentions. Execute the code changes and validations.

At meaningful phase boundaries report concisely:
- phase/task completed;
- findings closed;
- major source modules changed;
- tests/commands with PASS/FAIL counts;
- architecture gate status;
- migrations/benchmark results when relevant;
- current blockers;
- next phase.

Do not repeatedly ask for confirmation for ordinary implementation decisions already settled by the documents. Ask the owner only when:
- a required decision is not covered by the package/ADR;
- current official standards materially conflict with package design;
- data migration has an unresolved collision/data-loss choice;
- an action would modify/deploy public infrastructure;
- a safety-sensitive destructive action against user data would otherwise be required.

If the task is large, continue completing the current phase rather than stopping at micro-steps.

---

# M. Final release rule

At R10:
- run every gate in `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`;
- complete `27_RELEASE_READINESS_CHECKLIST.md`;
- make all 54 finding rows `VERIFIED_CLOSED`;
- generate final implementation report using `32_FINAL_IMPLEMENTATION_REPORT_TEMPLATE.md`;
- recommend `RELEASE_CANDIDATE` or `DO_NOT_RELEASE` based on evidence.

**Do NOT deploy to any network-exposed production environment automatically** (public exposure is owned by the external deployment project). Production deployment requires explicit owner approval after the final report.

Begin by reading all mandatory documents and capturing R0 baseline. Do not modify source before completing the mandatory reading and baseline protection steps.

## PROMPT END