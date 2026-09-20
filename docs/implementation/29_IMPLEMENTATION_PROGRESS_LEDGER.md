# Implementation Progress Ledger

**Project:** `D:/workspace/hooshix-agent`  
**Program:** Full Hexagonal/Clean redesign + complete consolidated-audit remediation  
**Status:** R0 GATE_PASSED; R1 GATE_PASSED — G1 PASS (architecture boundary); R2 IN_PROGRESS (R2.01 VERIFIED; R2.02/03/05/09 not yet complete; G2 OPEN)
**Owner directive:** all 13 HIGH, 29 MEDIUM, 12 LOW findings must be fixed and verified.

This file is intentionally a live execution ledger. The implementing assistant updates it during implementation. Do not erase previous evidence; append/update status while preserving history.

---

## 1. Baseline

```text
Baseline captured: YES (pre-R0 snapshot only; full G0 not passed)
Date: 2026-09-19
Branch: release/hardening-2026-09-19
Commit/HEAD reference (informational only; dirty working tree is baseline): 8f43e5ba9d956fcc53b5b976663304aaa683fbe8
Git status artifact/summary: clean at pre-R0 baseline; 3 commits ahead of local main, 7 ahead of origin/main
Node: v24.18.0
pnpm: 11.24.0
MCP SDK current before migration: @modelcontextprotocol/sdk v1 1.30.0 (monolithic)
DB schema/version: 8, previous online-backup copy rehearsal only; live DB not modified in R0
Build result: PASS on clean hardening checkout before R0 source changes
Typecheck result: PASS on clean hardening checkout; new R0 helper/typecheck also PASS
Full test result: 92 files / 470 passing pre-R0; new R0 tests 12 PASS + 2 expected RED
Coverage: 86.35% statements, 76.93% branches, 87.35% functions, 89.88% lines
pnpm audit: production dependencies PASS in prior local release hardening; not independently rerun in R0
Notes on pre-existing dirty changes: none at R0 baseline; source hardening already committed on isolated release branch
```

---

## 2. Phase status

| Phase | Status | Gate | Started | Completed | Evidence summary |
|---|---|---|---|---|---|
| R0 Baseline + regressions | GATE_PASSED | G0 PASS — all HIGH pre-fix contracts encoded; none resolved | 2026-09-19 | 2026-09-19 | 103 files / 492 passing / 18 expected failures; real two-process lease fixture; see R0_G0_COMPLETION_2026-09-19.md |
| R1 Architecture + MCP v2 foundation | GATE_PASSED | G1 PASS — strict 166-source-file inventory zero candidates; new-tree dependency/in-memory adapter and composition tests pass; SDK v2 upgrade belongs to R5 | 2026-09-19 | 2026-09-20 | Full suite 119 files / 542 PASS + 18 expected RED; standalone/full typecheck and build PASS; see R1_G1_COMPLETION_2026-09-20.md |
| R2 Unified tool/auth/workspace | IN_PROGRESS | G2 OPEN — R2.01 VERIFIED; R2.04 session isolation tested; R2.06/07/08 security fixes validated; R2.02/03/05/09 runtime cutover outstanding | 2026-09-20 | | 128 files / 572 PASS + 15 expected RED; Typecheck, Build, G1 (168 files/0 candidates) PASS; HIGH-02/03, MED-04, LOW-01 VERIFIED_CLOSED; see latest R2 worklog below |
| R3 Task/recovery/idempotency/lease | NOT_STARTED | — | | | |
| R4 Data integrity/compensation | NOT_STARTED | — | | | |
| R5 HTTP/OAuth/MCP modern | NOT_STARTED | — | | | |
| R6 Persistence/perf/observability | NOT_STARTED | — | | | |
| R7 Config/deployment/CI | NOT_STARTED | — | | | |
| R8 Verification/parallel/fuzz | NOT_STARTED | — | | | |
| R9 Legacy deletion/docs/cutover | NOT_STARTED | — | | | |
| R10 Final release validation | NOT_STARTED | — | | | |

Allowed phase status: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `GATE_FAILED`, `GATE_PASSED`.

---

## 3. Finding closure summary

| Severity | Total | OPEN | TEST_ENCODED | IMPLEMENTING | IMPLEMENTED | VERIFIED_CLOSED | DEFERRED_BY_OWNER |
|---|---:|---:|---:|---:|---:|---:|---:|
| HIGH | 13 | 0 | 11 | 0 | 0 | 2 | 0 |
| MEDIUM | 29 | 19 | 9 | 0 | 0 | 1 | 0 |
| LOW | 12 | 11 | 0 | 0 | 0 | 1 | 0 |
| **TOTAL** | **54** | **30** | **20** | **0** | **0** | **4** | **0** |

The detailed source is `20_FINDINGS_TRACEABILITY_MATRIX.md`; keep totals consistent.

---

## 4. Current task

```text
Task ID (e.g. R2-07): R2.02 — shared ExecuteToolUseCase for direct MCP + Task (IN_PROGRESS)
Finding IDs: HIGH-01/MED-06/MED-28 remain dependent on complete common gateway; HIGH-02/03, MED-04, LOW-01 separately VERIFIED_CLOSED with direct/Task regressions
Status: IN_PROGRESS — R2.01 descriptor catalog VERIFIED; isolated R2.02 app-level direct/Task scope resolution and R2.03 pure authorization policy implemented and tested, but production runtime gateway and effective authorization wiring remain unimplemented and separately gated
Goal: implement and wire R2.02 shared MCP/Task gateway under G2 regression rules without breaking the R2.01 canonical catalog or G1 zero-candidate protection
Files/modules planned: src/application/use-cases/tools/**, src/domain/tool/**, src/adapters/inbound/mcp/** and legacy src/tools/**/src/core/** call paths; validate complete catalog and retain R1 boundaries
Architecture layer(s): R1 Domain/Application and global static G1 boundaries PASS; R2/G2 direct legacy tool/service paths remain and are not authorized by G1
Tests to add first: exhaustive catalog parity, direct MCP/Task shared authorization and R0 HIGH-01/02/03 regression conversion only after actual R2 fixes
External docs rechecked (if version-sensitive): SDK v2 NOT selected or migrated in R1; existing SDK v1 remains only in legacy inbound paths; verify actual v2 packages/spec before R5 migration
Start timestamp: 2026-09-20
Notes: R1 G1 PASSED; latest R2 run 15 expected failures; 4 findings VERIFIED_CLOSED; 50 unresolved. R2/G2 remains OPEN; no live gateway production cutover
```

---

## 5. Task completion record template

Copy this block for every leaf task:

```text
### <TASK ID> — <title>
Status: IMPLEMENTED | VERIFIED | BLOCKED
Findings:
Started:
Completed:

Changes:
- ...

Architecture impact:
- Domain:
- Application:
- Inbound adapters:
- Outbound adapters:
- Infrastructure/bootstrap:

Tests added/updated:
- ...

Validation commands/results:
- command -> PASS/FAIL, counts/duration if relevant

External references rechecked:
- URL/date/result

Migration/data notes:
- ...

Security/reliability residuals:
- ...

Docs updated:
- ...

Git/change isolation notes:
- pre-existing changes preserved: YES/NO
- unrelated files touched: ...

Next dependency:
- ...
```

---

## 6. Gate evidence template

```text
## Gate <name/phase>
Date:
Commit/working-tree reference:
Commands:
- ...
Results:
- ...
Coverage/benchmark:
- ...
Artifacts:
- ...
Open issues:
- ...
Decision: PASS | FAIL
Reason:
```

If FAIL, do not mark phase complete or start a dependent phase unless the master plan explicitly allows independent parallel work.

---

## 7. Architecture violation ledger

R1 may establish a temporary migration baseline of legacy violations. Every violation must have removal task/phase.

| Violation | Current file | Target removal phase | Status | Evidence |
|---|---|---|---|---|
| Legacy core handler -> concrete filesystem service | src/core/executor/handlers/file-handler.ts | R2/R9 | OPEN | R1 baseline: 44 candidate legacy concrete-import files; R1 new-tree static checks PASS |
| Raw SQL outside new SQLite adapter/migrations | historical: src/core/memory/task-repository.ts; src/tools/task/index.ts; src/security/workspace-policy-repository.ts | R1/R6/R9 | G1_CLEARED | Strict 2026-09-20 global scan: 0 SQL candidates; old compatibility facades remain for R9 retirement |
| process.env outside target config/bootstrap | historical: src/security/workspace-guard.ts; src/mcp/http-server.ts | R1/R5/R7/R9 | G1_CLEARED | Strict 2026-09-20 global scan: 0 env candidates; R5/R7 semantic auth/config hardening still required |
| Legacy MCP SDK imports outside new inbound MCP | historical: src/mcp/server.ts; src/tools/task/index.ts | R1/R5/R9 | G1_CLEARED | Strict 2026-09-20 global scan: 0 direct SDK candidates outside inbound bridge; runtime remains SDK v1 pending R5 |

No new violation may be added after R1.

---

## 8. Compatibility/deprecation ledger

| Legacy behavior | Replacement | Introduced | Removal deadline | Status |
|---|---|---|---|---|
| `MCP_ACCESS_TOKEN` legacy bootstrap alias if retained | `HOOSHIX_BOOTSTRAP_TOKEN` | R5/R7 | defined migration release | TBD |
| `MCP_API_KEY` | rejected with migration error | R7 | immediate | TBD |
| `package_restore` alias | `package_manifest_restore` truthful semantics | R4/R9 | bounded | TBD |
| MCP SDK v1 | SDK v2 | R1/R5 | R5/R9 | TBD |
| Legacy `src/core/runtime/template-resolver.ts` import facade | `src/application/services/template-resolver.ts` | R1 | R9 (after all legacy callers migrated) | ACTIVE: same exported implementations; regression tested |
| 2025 MCP legacy era | 2026 modern primary | R5 | per ADR-009 compatibility decision | TBD |

No compatibility shim is indefinite without an ADR.

---

## 9. Database migration ledger

| Migration | Purpose | Fixture upgrade PASS | Current-copy PASS | Backup/restore PASS | Applied to real local DB | Notes |
|---|---|---|---|---|---|---|
| TBD | | | | | NO | |

Applying to the user's real DB requires the phase/runbook procedure and must be recorded explicitly.

---

## 10. Benchmark ledger

| Benchmark | Pre-redesign | Current | Delta | Gate |
|---|---:|---:|---:|---|
| 1000 simple/audit writes | 101–136 ms audit reference | | | |
| 1000 metric query sets | 170–211 ms audit reference | | | |
| agent metrics ~2.5k rows | ~4 ms audit observation | | | |
| actual metrics 25k rows | not measured | | | |
| actual metrics 250k rows | not measured | | | |
| search aggregate budget fixture | not available | | | |
| HTTP lightweight modern request | not measured | | | |
| event-loop delay under DB/metrics load | not measured | | | |

Record machine/runtime fixture metadata for comparisons.

---

## 11. Test/coverage ledger

```text
Current build: PASS after final R1 legacy handler composition compatibility; live service has not been restarted
Current typecheck: PASS — standalone Domain/Application plus whole-project on final R1 changeset
Unit/domain/application: 119 files / 542 PASS + 18 expected pre-fix failures (560 total); no unexpected failures; see final R1 G1 report
Architecture: R1 G1 PASS (166 scanned source files / 0 static global candidates, separate new-tree and composition tests); R2/G2 unified runtime gateway and R9 legacy deletion remain OPEN
Security regressions:
Integration/adapters:
Failure injection:
Property/fuzz:
Stdio E2E:
HTTP/OAuth modern E2E:
Coverage global: statements 86.83%, branches 77.44%, functions 87.35%, lines 90.41% (full R0)
Critical branch thresholds: NOT PASSED/NOT ESTABLISHED; G8 remains OPEN (global coverage is not per-file approval)
Workers/profile:
Prometheus validation:
Container smoke:
```

---

## 12. MCP protocol migration ledger

```text
SDK v2 package versions selected:
Official docs rechecked date:
Codemod run/reviewed:
@mcp-codemod-error count remaining:
v1 imports remaining:
Modern HTTP E2E:
Modern stdio E2E:
Legacy era support decision:
RFC9207/current auth opt-ins:
Protocol compatibility doc generated:
```

---

## 13. Current blockers

```text
Code/security: HIGH-03 git diff --no-index currently auto-allowed (intentionally RED test); HIGH-10 Dockerfile falls back to non-frozen install (intentionally RED test).
Testing: G0 needs remaining HIGH direct-entrypoint/fixture regressions; actual multi-process lease and high-load verification remain unperformed. No finding is marked deferred or closed.
Architecture: R1 G1 PASS for measured architecture-boundary criteria; G2/G9 runtime shortcuts and MCP SDK v2 upgrade remain for R2/R5/R9.
Operational: public HTTP and R10 blocked. No push, merge, tag, deployment or live DB migration authorized by R0.
```

For each blocker specify whether it is:
- code defect;
- environment/tooling;
- unclear external protocol behavior;
- data migration ambiguity;
- owner decision required;
- safety restriction.

Do not hide a blocker by changing acceptance criteria silently.

---

## 14. Final completion block

Populate at R10 only:

```text
R10 Gate: PASS/FAIL
Findings VERIFIED_CLOSED: __ / 54
Architecture gate: PASS/FAIL
Security gate: PASS/FAIL
Reliability gate: PASS/FAIL
Data integrity gate: PASS/FAIL
MCP/HTTP gate: PASS/FAIL
Performance gate: PASS/FAIL
CI/container gate: PASS/FAIL
Testing gate: PASS/FAIL
Documentation gate: PASS/FAIL

Release candidate recommendation:
Residual limitations:
Owner deployment decision: PENDING
Final implementation report path:
```

Do not mark public production approved automatically.

---

## R0 evidence entry — 2026-09-19

- Pre-R0 clean baseline commit: `8f43e5ba9d956fcc53b5b976663304aaa683fbe8`; exact measurements and per-HIGH coverage inventory: `R0_BASELINE_2026-09-19.md`.
- `pnpm exec vitest run --coverage` (pre-R0): PASS 92 files/470 tests; 86.35% statements, 76.93% branches, 87.35% functions, 89.88% lines.
- R0 fixtures and new-tree architecture scanner: 12 PASS. HIGH-03/HIGH-10: 2 expected-RED contracts; these are NOT security passes or finding closures.
- `pnpm run typecheck` after new fixtures, architecture and RED tests: PASS.
- New files: `tests/helpers/r0-disposable-fixtures.ts`, `tests/core/r0-disposable-fixtures.test.ts`, `tests/core/r0-architecture-boundary.test.ts`, `tests/core/r0-known-defects.test.ts`, `docs/implementation/R0_BASELINE_2026-09-19.md`.
- R0 status IN_PROGRESS; Gate G0 NOT PASSED. No edits to the 54-row finding status matrix; no source implementation, server restart or production change.

## R0 G0 sign-off — 2026-09-19

- R0.01–R0.05 complete as **baseline and contract-capture** phase, Gate G0 **PASS**. Detailed 13-HIGH mapping and 10-MED test references: `R0_G0_COMPLETION_2026-09-19.md`.
- Full suite: 103 files / 492 passing / 18 expected failing pre-fix contracts (510 total), exit 0. Typecheck and build PASS; no production behavior change.
- REAL two-OS-process SQLite race fixture verifies one atomic disposable row winner; production fenced Task lease HIGH-13 remains RED/unimplemented.
- Finding state: HIGH 13 TEST_ENCODED, MEDIUM 10 TEST_ENCODED and 19 OPEN, LOW 12 OPEN. **No finding VERIFIED_CLOSED or deferred.** G1–G10 NOT PASSED; R1 NOT_STARTED.
- Change scope: test fixtures + evidence docs on isolated `audit/r0-baseline-2026-09-19` branch. No push, merge, release tag, service restart or primary DB alteration.

## R1 implementation record — 2026-09-19

Task IDs: R1.01–R1.06. Baseline: R0 G0 commit `24f09e0`.
Branch: `feature/r1-hexagonal-foundation-2026-09-19`.
Finding IDs: architectural G1; no HIGH/MED/LOW finding independently closed.

- R1.01 directories created; empty future adapter/handler directories tracked by .gitkeep; no legacy source moved.
- R1.02 pure Domain primitives, Task dependency-cycle/terminal policy, copy-on-create workspace, typed identifiers and receipt/outcome.
- R1.03 Application-owned ports covering Task/Approval/Lease/Workspace/Filesystem/Process/Git/Package/Clock/IDs/Tokens/OAuth/Telemetry.
- R1.04 runnable read-only ExecuteTool/CreateTask/GetTask/GetWorkspace use cases plus typed contracts for remaining cases; no live MCP/Task dispatch rewiring.
- R1.05 test-only in-memory adapters and explicit Composition Root; inbound mapper calls application use case, not outbound adapter.
- R1.06 independent Domain/Application compilation and new-target-tree boundary tests PASS. G1 *global* NOT PASSED because unchanged legacy modules retain forbidden SQL/config/concrete imports. Static candidate counts: 20 SQL, nine env, 44 concrete imports, 19 MCP SDK source files; categories overlap. See `R1_FOUNDATION_AND_G1_ASSESSMENT_2026-09-19.md` for paths/removal ownership.
- Validation before final script wiring: `pnpm exec tsc -p tsconfig.r1.json` PASS; focused 14 PASS; full `pnpm exec vitest run` PASS: 105 files, 502 successful plus 18 expected pre-fix failures. Whole-source typecheck and production build PASS.
- Schema/config: no new DB migration, no production deployment; `package.json` updates `typecheck` to always include standalone R1 compile and adds `typecheck:r1`. SDK v1 remains in legacy transport; SDK v2 selection/migration not claimed.
- Risk: test-only R1 dispatcher does not implement production approval, canonical OS path security, task lease or end-to-end shared gateway; continue to R2/R3/R5/R9 only under the official phase/gate rules.
- Git safety: isolated feature branch; no main/release reset, push, merge, tag, service restart or primary DB modification.

## R1 pure Template Resolver migration — 2026-09-19

- **Status:** VERIFIED as a bounded R1 vertical slice. Overall R1 remains
  `IN_PROGRESS`; G1 global remains `NOT PASSED` due to legacy SQL,
  configuration, and adapter/transport dependencies.
- **Source migration:** `src/core/runtime/template-resolver.ts` pure
  implementation -> `src/application/services/template-resolver.ts`.
  Original path is an exact re-export facade only; removal owner R9.
- **Application boundary:** structural `TemplateStep`, no import of legacy
  planner, Node filesystem, SQL, MCP SDK, or production process.
- **Tests:** `tests/core/r1-template-migration.test.ts` verifies old/new
  symbol identity and legacy TaskStep input compatibility; focused 59 PASS;
  full suite 106 files / 504 PASS + 18 expected RED; independent/full
  TypeScript compilation and Build PASS.
- **Data/config/security:** no new DB migrations, production workspace
  change, tool authorization rewiring, service restart or release actions.
  All 54 original audit findings retain existing statuses.
- **Residual:** existing live loop still calls the old facade; removal of that
  import belongs to R9 after migrating all callers. No G1/global gate waiver.

## R1 execution-context/config boundary migration — 2026-09-19

- **Status:** VERIFIED bounded migration; overall R1 remains `IN_PROGRESS`, G1 global remains `NOT PASSED`.
- Execution context DTO now belongs to Application; UUID/system time creation belongs to Infrastructure composition. Legacy core path is compatibility-only.
- Permission ranking/policy is application-owned; legacy env reads for permission level and direct auto-approval are isolated in `src/infrastructure/config/**`.
- Focused regressions: 40 PASS; combined standalone/full Typecheck PASS; production Build PASS.
- Current literal `process.env` path inventory: nine source paths total, two correctly under target config; seven legacy paths remain and are explicitly owned by later R2/R5/R6/R7/R9 migrations.
- No original finding marked VERIFIED_CLOSED by this refactor; no live DB/service/deployment mutation.

## R1 pure Task State Machine migration — 2026-09-19

- **Status:** VERIFIED bounded R1 migration; overall R1 remains `IN_PROGRESS`, global G1 remains `NOT PASSED`.
- Pure transition behavior moved from legacy Core into Domain; old Core path is compatibility-only.
- Current shipped transition semantics are frozen during R1; final state-model convergence is assigned to R3 so this refactor does not alter durable Task behavior.
- Focused tests: 21 PASS. Full suite: 107 files / 506 PASS + 18 expected RED; Typecheck and Build PASS.
- No finding was closed and no runtime/deployment/database mutation occurred.

## R1 Task Planner and Tool Orchestrator migration — 2026-09-19

- Status: VERIFIED bounded R1 vertical slice; R1 `IN_PROGRESS`, global G1 `NOT PASSED` due to remaining legacy architecture exceptions.
- Moved legacy TaskPlan DTO and validation to Application, TaskPlan UUID factory to Infrastructure composition. Old `core/planner/task-planner.ts` is an exact compatibility facade; no persisted Task schema changes.
- Moved the existing legacy selection/metadata orchestration logic to `application/services/legacy-tool-orchestrator.ts`; old Core path is a compatibility facade. No R2 security gateway/canonical catalog or production authorization behavior has been replaced.
- Evidence: independent Domain/Application compile PASS; focused migration/boundary 8 PASS; full Typecheck and Build PASS; full regression 110 test files, 515 PASS + 18 expected pre-fix failures; `git diff --check` PASS.
- Paths/tests: `tests/core/r1-task-planner-migration.test.ts`, `tests/core/r1-tool-orchestrator-migration.test.ts`, complete changed-path inventory from the isolated R1 commit, `R1_FOUNDATION_AND_G1_ASSESSMENT_2026-09-19.md`.
- No HIGH/MED/LOW finding marked closed; no live DB migration, process restart, push, merge or deployment. Removal of old import facades remains R9; global SQL/config/MCP boundary debt remains with mapped later phases.

## R1 bounded migration — runtime path + Workspace bootstrap configuration (2026-09-19)

- Task: R1.06 legacy environment-boundary reduction. R1 remains IN_PROGRESS;
  new tree remains clean, **global G1 NOT PASSED**. No finding closure.
- `src/infrastructure/config/legacy-runtime-paths.ts`: lazy read of
  `HOOSHIX_DB_PATH` and `HOOSHIX_LOG_DIR`, keeping the original defaults.
  `src/core/memory/database/connection.ts`, `src/memory/command-audit.ts`
  and `src/memory/file-audit.ts` now receive those values through the config
  boundary without changing persistence, redaction or audit output semantics.
- `src/infrastructure/config/legacy-workspace-bootstrap.ts`: lazy read of
  `HOOSHIX_WORKSPACE` and the exact existing unrestricted opt-in values.
  `src/security/workspace-guard.ts` no longer reads `process.env`
  directly; principal-scoped privilege redesign remains R2.
- Tests first: `tests/core/r1-runtime-path-config-migration.test.ts`
  and `tests/core/r1-workspace-bootstrap-config-migration.test.ts`,
  covering dynamic test env overrides, no live database creation, disposable
  audit log destinations, and existing strict bootstrap flag behavior.
- Focused config/DB/audit regression: 5 files / 18 PASS; focused
  Workspace+MCP/Task regressions: 6 files / 16 PASS + one expected
  pre-remediation RED. Combined independent and project Typecheck PASS.
- Complete post-migration regression:
  `pnpm exec vitest run` -> 112 files / **521 PASS + 18 expected RED**
  (539 total); `pnpm run typecheck` PASS; `pnpm run build` PASS;
  `git diff --check` PASS.
- Residuals: legacy SQL, concrete imports, MCP/HTTP and entrypoint settings
  remain for assigned R2–R9 migration phases. Merely relocating the Workspace
  bootstrap environment read does **not** repair HIGH-01 or permit unrestricted
  privilege expansion. R1/G1 not complete; dependent R2 not started.
- Change isolation: source/test/docs only in the isolated R1 branch.
  No server restart, primary DB migration, push, merge, tag, or deployment.

## R1 configuration-boundary continuation (2026-09-20)

- Stdio/HTTP retention and HTTP bootstrap environment accesses now reside in `src/infrastructure/config/**`; global source scan reports zero remaining direct `process.env` usage outside configuration/bootstrap.
- Added entrypoint/HTTP compatibility and global environment-boundary regression tests. Updated HIGH-11 expected-RED test to assert the credential behavior, not a source-code string; HIGH-11 remains unresolved.
- Full regression: 113 files, 525 PASS plus 18 expected RED; Typecheck, Build and diff whitespace PASS.
- Strict global G1 inventory script: 145 source files, 19 legacy SQL candidate files and 19 legacy MCP SDK-import candidate files, with paths and failure on `--strict`.
- R1 skeleton and bounded leaf work complete; formal G1 remains NOT PASSED pending R2/R5/R6/R9 legacy execution/transport/persistence migrations. No finding closure or dependent phase claimed.
- No service restart, live DB migration, push, merge, release tag or deployment.

## R1 bounded migration — seven SQLite repository modules (2026-09-20)

- Moved the real SQL implementations of workspace roots, approval requests, checkpoints,
  recovery events, resumable tasks, execution memory and execution trace to
  `src/adapters/outbound/persistence/sqlite/repositories/*.adapter.ts`.
- The seven legacy source paths now re-export the *same* implementation objects;
  no duplicate database state, SQL reimplementation or changed public signatures.
- Added `tests/core/r1-sqlite-repository-migration.test.ts`: seven exact
  export-identity checks PASS; existing six focused Workspace/approval/recovery
  test files: 72 tests PASS.
- Complete regression: **114 files, 532 PASS + 18 expected pre-fix failures**
  (550 cases); combined independent/project Typecheck PASS; production Build PASS.
- The strict global G1 scanner reported **152 source files, 12 residual SQL
  candidate files and 19 residual legacy SDK import files**, with zero
  environment-access violations outside config/bootstrap. It remains
  `NOT_PASSED`; these are not severity-finding closure claims.
- SQL extraction in the remaining large cross-cutting modules is assigned to
  R2/R6/R9; SDK inbound migration and shared execution gateway belong to
  R2/R5/R9. The seven facades remain compatibility paths until R9.
- Work isolated on `feature/r1-hexagonal-foundation-2026-09-19`; no live
  SQLite migration, runtime service restart, main/release merge, push or deploy.

## R1/R6 bounded SQLite architecture extraction — 2026-09-20

- Additional actual SQL moved to outbound persistence: shared connection/schema
  bootstrap (`src/adapters/outbound/persistence/sqlite/connection.adapter.ts`),
  retention cleanup (`cleanup.adapter.ts`), audit-log inserts, reflection
  execution-row lookup and Git task-snapshot storage/lookup.
- Old imports retain compatibility exports or call typed data-only adapter
  functions. Git rollback and Reflection interpretation stay in their legacy
  services; this relocation does not revise HIGH-08 or mutate the live DB.
- Added shared connection export-identity regression to the seven repository
  reference checks. Focused post-extraction tests: five files / 69 PASS.
- Full `pnpm exec vitest run`: **114 files / 533 PASS + 18 expected RED**
  (551 total), no unexpected failures. `pnpm run typecheck` and
  `pnpm run build` PASS. Git CRLF conversion warnings require exit-code and
  stdout-based `git diff --check` verification; they are not by themselves
  whitespace errors.
- Strict G1 inventory after these changes: 9 SQL candidate files outside the
  target SQLite adapter and 19 MCP SDK import files outside inbound; G1 remains
  **NOT PASSED**. The `tools/system/workspace.ts` SQL candidate may be
  natural-language documentation detected by the conservative text scanner:
  do not silently waive or alter the G1 gate without evidence.
- Remaining critical work is real R2 unified authorization gateway plus
  R5/R9 MCP registration cutover and R6/R9 cross-cutting SQL extraction.
  No direct MCP/Task tool executor was replaced in this slice.
- No finding marked `VERIFIED_CLOSED`, no public deployment, live schema
  migration, force-kill, push, merge or release tag.

## R1 G1 final gate record — 2026-09-20

- R1.01–R1.06: GATE_PASSED; definitive architecture evidence in
  `R1_G1_COMPLETION_2026-09-20.md`. Older ledger blocks above are dated
  intermediate NOT_PASSED snapshots and are superseded by this final record.
- Strict `node scripts/verify-g1-global.mjs --strict`: PASS; **166 source files,
  zero reported global architecture candidates**, including SQL, env, direct
  SDK import and target-layer import checks. Added permanent test
  `tests/core/r1-global-architecture-gate.test.ts`.
- Concrete legacy handler objects now construct in the explicit infrastructure
  composition module, with a pure dispatcher factory and unchanged legacy
  exported entry point. Fake-handler construction and behavior are tested in
  `tests/core/r1-legacy-handler-composition.test.ts`.
- Final `pnpm exec vitest run`: **119 files / 542 PASS + 18 expected RED**;
  `pnpm run typecheck` (standalone Domain/Application and whole project) PASS;
  `pnpm run build` PASS. No unexpected failures. 18 known R0 contracts remain
  pre-fix and block later security/release gates, not the G1 boundary gate.
- **Do not mark any of the 54 findings VERIFIED_CLOSED** merely because the
  architecture scanner is zero; especially HIGH-01/03/05/10/11/12/13 remain
  open/test-encoded. G2–G10, SDK v2 migration and production release are NOT
  approved by the R1 gate. The old direct MCP/Task gateway is still present
  and its removal remains planned for R2/G2 and R9/G9.
- R2 is NOT_STARTED at this handoff. No merge, push, tag, service restart,
  primary SQLite migration or public deployment was performed in R1.
---

## R2.01 verified leaf — 2026-09-20

- Task: R2.01 Canonical Tool Catalog. Status: **VERIFIED** as a bounded leaf; overall R2 **IN_PROGRESS**, G2 **OPEN**.
- Independent branch: `feature/r2-unified-tool-gateway-2026-09-20`, branched from clean R1 G1 commit `b452683`. No merge, push, tag, service restart, deployment or live SQLite migration.
- Scope: a single application-owned `operation-catalog.ts` containing 53 exhaustive metadata descriptors (28 step-executable and 25 control-plane/management operations). Each descriptor specifies permission, risk, approval policy, effect class, workspace scope behavior, security class, capabilities and idempotency availability. Unknown names are denied by catalog lookup.
- The prior legacy orchestrator exports now project the canonical catalog. The legacy four-level permission adapter reads the same descriptors, preserving unknown-operation ADMIN fail-closed behavior and package-manage compatibility until R2 runtime cutover. The pure R1 principal/authorization type now models PROJECT_ACCESS explicitly.
- Tests: `tests/core/r2-operation-catalog.test.ts`, five PASS. Fake MCP registration inventory proves exactly 53 unique descriptor/registration names, with no unknown/prototype-key fallback; old exports are identical projections; four-level permission smoke tests pass.
- `pnpm run typecheck`: PASS (standalone Domain/Application and full project). `pnpm run build`: PASS. Full `pnpm exec vitest run`: **120 files / 547 PASS + 18 expected pre-fix RED** (565 total), no unexpected failures. `node scripts/verify-g1-global.mjs --strict`: PASS, 167 source files, zero candidates. `git diff --check`: exit code 0; Windows LF/CRLF warnings are not whitespace failures.
- Recovery: one intermediate combined diagnostic task used the Task engine's default 30s step timeout, returning outcome_unknown during a long test run; it was not treated as a PASS. The full suite was independently re-executed with explicit 115s step timeout and completed successfully. No side-effecting step was retried or reconciled as succeeded without evidence.
- Critical residual: production MCP callbacks and durable Task handlers still execute via old distinct routes. Descriptor presence is not authorization/cutover proof. No HIGH/MED/LOW finding was marked VERIFIED_CLOSED; no G2 pass or R2.02–R2.09 implementation claimed.
- Next dependent work: complete **R2.02** live MCP/Task gateway wiring and **R2.03** real principal/server-ceiling authorization integration; then R2.04–R2.09 according to the unchanged backlog.
---

## R2.02/R2.03 isolated application foundation — 2026-09-20

- **Status: IN_PROGRESS, not VERIFIED as the whole leaf, G2 OPEN.** The application gateway now accepts exactly one trusted direct-session, captured Task, or R1 test-only scope input. A direct call resolves scope by principal/session via a repository port; Task mode uses the supplied immutable captured scope. Unknown tool, forged session, missing/mismatched principal and invalid arguments fail before invoking the injected fake tool port. Effectful operations remain `approval_required`, not dispatched.
- Introduced `createAuthorizationService` as a separately wired R2 policy with explicit local_stdio/http_oauth principal origin, four-level principal/server ceiling, OAuth scope reduction, workspace root checks, and fail-closed unrestricted (ADMIN + server flag) check. Existing R1 fake policy remains for compatibility. No caller may create a verified approval by supplying an arbitrary fingerprint. **Exact, persisted task-bound approval verification and runtime composition are not implemented in this slice.**
- Regression first: `tests/core/r2-execute-tool-gateway.test.ts` was run RED (3 contract failures before gateway implementation); `tests/core/r2-effective-authorization.test.ts` was run RED (5 failures before the new policy existed). These are now green in isolated fake-adapter tests; no live end-to-end authorization assertion is made.
- Focused R2.01/R2.02/R2.03 tests: 3 files / 16 PASS on current code. Standalone Domain/Application and complete-project TypeScript PASS; production build PASS; strict G1 source scanner PASS (167 files, zero candidates). Full new combined regression results to be recorded after final run.
- Residual: inbound MCP callbacks and legacy Task executor still call their own concrete execution paths; HTTP does not yet construct and pass an authenticated scoped Principal into this new service; Task approval consumption is still legacy; authorization and Workspace root state remain distributed. Until actual source cutover and G2 tests pass, **no HIGH/MED/LOW finding may be called closed, no actual unified live gateway may be claimed, and R2.02/R2.03 remain incomplete.**
- No database schema migration, live service restart, push, merge, tag, deployment or real user-file mutation.
---

## R2 security remediation evidence and remaining G2 boundary — 2026-09-20

- **Status:** R2 IN_PROGRESS; G2 OPEN. This record supersedes the older R2 test-count/closure snapshots above without changing the planned R0–R10 phase count or declaring gateway cutover.
- **HIGH-02 VERIFIED_CLOSED (limited to sensitive read/search disclosure):** `src/application/services/sensitive-path-policy.ts` and `src/services/filesystem/filesystem-service.ts` block sensitive direct reads and prune sensitive files and directories before traversal/read. Nearest-existing realpath and alias checks reject symlink/junction indirection. Actual direct in-process MCP and durable Task search regressions remain green; `tests/security/r2-sensitive-path-alias.test.ts` spies on filesystem reads and proves no secret or aliased secret was read in the disposable fixture. Sensitive search root paths are rejected. Remaining full unified authorization cutover is a separate G2 condition.
- **MED-04 VERIFIED_CLOSED (cwd authorization):** Generic read-classified git command forms including `git diff --no-index` are restricted, with HIGH-03 separately VERIFIED_CLOSED. In `src/core/governance/policy-decision-point.ts`, `HOOSHIX_DIRECT_AUTO_APPROVE=1` cannot authorize a direct subprocess with an out-of-workspace cwd. `tests/security/r2-command-cwd-bypass.test.ts` demonstrated the bypass RED before the fix and two tests GREEN after, including legitimate explicitly approved Task behavior. `tests/security/r0-medium-boundary-contracts.test.ts`, shell and workspace tests remain green.
- **LOW-01 VERIFIED_CLOSED:** `searchWorkspaceFiles` no longer serializes match `absolutePath` nor an absolute search `root`: root is now relative to the effective workspace (or `.` when out of scope). `tests/search-files.test.ts` and direct MCP + Task search assertions verify that neither response exposes the underlying host path. The pre-existing `matches[].path` remains relative to the search root.
- **R2.04 partial safety fix:** Both direct MCP `set_workspace` and durable Task system-handler selection now enforce the server's configured permission ceiling before changing the active selection. `tests/security/r2-workspace-selection-permission.test.ts` was RED before fix (READ_ONLY switched to another pre-authorized root) and GREEN afterward with no selection side effect. HTTP per-session workspace isolation continues to pass process-level E2E tests. Complete principal-bound, persistent Task-scope and operation authorization cutover is still outstanding.
- **R2.01/R2.02/R2.03 status unchanged:** exhaustive 53-entry catalog and isolated, fail-closed application use-case/policy tests are green. The use case now rejects ad-hoc caller-supplied workspace scopes; descriptor metadata forgery is denied. However production MCP and durable Task still execute through separate legacy dispatch paths. No claim that an exhaustive shared runtime gateway, exact persisted Task approval binding, or unrestricted ADMIN+approval workflow exists.
- **Full validation:** `pnpm exec vitest run` 128 test files / 572 PASS / 15 expected pre-fix RED (587 total); no unexpected failure. `pnpm run typecheck` PASS (standalone and complete TypeScript); `pnpm run build` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (168 source files, zero candidates). Task evidence ID: `8b831f1c-3404-43b2-9471-c37d044dc512`. Focused coverage additionally includes direct-file schema parity and fake gateway/authorization tests.
- **Migration/rollback:** no SQL migration, deployment, service restart, push, merge, live user-file mutation, or destructive Git cleanup. Changes remain on `feature/r2-unified-tool-gateway-2026-09-20`; no production cutover implied.
- **Remaining leaf dependency:** R2.02 real direct MCP + durable Task shared gateway, R2.03 actual authenticated principal/server-ceiling/scope/request authorization, R2.05 exact approval and unrestricted-capability controls, R2.09 remove alternate execution paths, then run the complete G2 matrix. Do not mark G2 passed or begin R3 on the basis of this bounded remediation.
