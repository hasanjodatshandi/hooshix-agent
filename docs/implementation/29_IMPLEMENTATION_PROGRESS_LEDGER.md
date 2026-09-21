# Implementation Progress Ledger

**Project:** `D:/workspace/hooshix-agent`  
**Program:** Full Hexagonal/Clean redesign + complete consolidated-audit remediation  
**Status:** R0 GATE_PASSED; R1 GATE_PASSED (G1 PASS); R2 GATE_PASSED (G2 PASS on isolated feature branch); R3 GATE_PASSED (G3 PASS on isolated feature branch, 2026-09-21). R4 IN_PROGRESS (R4.01–R4.03 VERIFIED; G4 OPEN). R5–R10 NOT_STARTED.
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
| R2 Unified tool/auth/workspace | GATE_PASSED | G2 PASS — shared Direct MCP/Task gateway, exact approval, scope controls and retired alternate inbound handlers | 2026-09-20 | 2026-09-20 | Commit e641b6d; 133 files / 589 PASS + 15 expected RED, Typecheck, Build, G1 PASS; R2 G2 closure worklog below |
| R3 Task/recovery/idempotency/lease | GATE_PASSED | G3 PASS — R3.01–R3.10 VERIFIED on isolated branch; no release/deployment claim | 2026-09-20 | 2026-09-21 | 142 files / 639 PASS + 11 expected RED; Typecheck, Build, strict G1 183/0 candidates, live-owner crash-recovery and real 2-process lease proofs PASS; see G3 completion record |
| R4 Data integrity/compensation | IN_PROGRESS | G4 OPEN — R4.01–R4.03 VERIFIED; R4.04–R4.07 outstanding | 2026-09-21 | | R4.03 145 files / 655 PASS + 9 expected RED; Typecheck, Build and G1 PASS |
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
| HIGH | 13 | 0 | 6 | 0 | 0 | 7 | 0 |
| MEDIUM | 29 | 17 | 3 | 0 | 0 | 9 | 0 |
| LOW | 12 | 11 | 0 | 0 | 0 | 1 | 0 |
| **TOTAL** | **54** | **28** | **9** | **0** | **0** | **17** | **0** |

The detailed source is `20_FINDINGS_TRACEABILITY_MATRIX.md`; keep totals consistent.

---

## 4. Current task

```text
Completed phase: R3.01–R3.10 (G3 VERIFIED PASS); completed leaves R4.01 immutable file backup schema and R4.02 revision-guarded restore (VERIFIED, feature branch)
Next pending leaf: R4.04 — canonical project identity (NOT_STARTED)
Findings: HIGH-05/06/07/13 and MED-05/08/09 VERIFIED_CLOSED with G3 evidence; MED-11/12 VERIFIED_CLOSED with R4.02, MED-10 with R4.03; 17/54 total closed. Other findings retain their statuses.
Gate: G3 PASS on isolated branch. R4 IN_PROGRESS, G4 OPEN; HooshiX is NOT release-ready.
Workspace: D:/workspace/hooshix-agent; isolated feature/r2-unified-tool-gateway-2026-09-20 branch.
No live database migration, deployment, restart, push, merge, reset or removal of unrelated user files.
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
Code/security: R4.03–R4.07 data-integrity contracts remain open (including MED-10, HIGH-08/09 and MED-07). HIGH-10 Docker frozen-lock fallback remains TEST_ENCODED for R7; HIGH-03 is VERIFIED_CLOSED under G2.
Testing: R4 G4 remains OPEN; no force-historical file restore has been exposed or approved. Final G8 performance/fuzz and G10 release verification have not been performed. R3 cross-process lease and recovery evidence is PASSED, not an outstanding blocker.
Architecture: G1–G3 PASS on isolated feature branch; MCP SDK v2 and HTTP/OAuth migration remain R5, production cutover and legacy retirement remain R9/R10.
Data-integrity concurrency: SHA-256 normal restore guard checks before and after displaced backup but cannot atomically exclude an external OS writer between last check and filesystem effect (residual TOCTOU).
Operational/safety: public HTTP and R10 remain blocked. Do not push, merge, tag, deploy, restart, apply live DB migrations, reset or delete unrelated user work as part of R4.02.
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

## R2.08 — direct MCP and durable Task CAS/idempotency verified — 2026-09-20

- **MED-06 VERIFIED_CLOSED:** actual MCP `read_file(includeSha256)`, `write_file(ifMatchSha256,idempotencyKey)` and `modify_file(ifMatchSha256)` operate on the same underlying file service as durable Task handlers, with identical revision checks and no stale overwrite. `tests/e2e/r2-file-cas-real-parity.test.ts` performs direct read/write/replay/stale rejection, Task read-to-write revision templates, direct modify/stale rejection and Task read-to-modify templates on a marker-protected disposable directory. Fake adapter/schema parity remains in `tests/core/r2-direct-file-parity.test.ts`. This closure is for exposed and enforced file CAS/idempotency parity, **not** approval binding or a common execution gateway.
- **Windows HTTP E2E fixture cleanup:** `tests/e2e/r2-http-session-workspace.test.ts` no longer starts its child with its disposable directory as cwd; test DB/log/roots remain explicitly isolated within the fixture. Child process close precedes protected fixture cleanup. Two separate runs pass; an earlier full-suite run failed with Windows EPERM during fixture teardown, without evidence of authorization behavior failure. This test-harness correction makes the subsequent complete suite green; no recursive cleanup outside the fixture namespace.
- **Full validated baseline:** `pnpm exec vitest run` 129 files / 573 PASS + 15 expected pre-fix RED (588 total), no unexpected test failures; `pnpm run typecheck` PASS, `pnpm run build` PASS, `node scripts/verify-g1-global.mjs --strict` PASS (168 files, zero candidates). Task evidence `f90ebae7-a168-46e6-9f2e-4ceb63a13726`.
- **Phase and release status:** R2.02/R2.03 runtime wiring, R2.05 scope elevation/verified approvals and R2.09 alternate execution-path retirement remain required. G2 OPEN; do not enter R3 or claim production security/release readiness. No merge, push, live data migration, runtime restart or deployment.
---

## R2 G2 runtime mediation WIP — verification blocked — 2026-09-20

- **Overall status:** R2 IN_PROGRESS; G2 OPEN. Do not begin R3 or report production readiness. This section supersedes older statements describing the pre-wiring source state, but does not supersede the verified five finding closures.
- **Uncommitted R2.02/R2.03/R2.04/R2.05 work in the isolated feature branch:** Added one application gateway entry point to the live direct MCP registration wrapper and durable Task executor; trusted session/principal binding for HTTP and Task context; Task owner/session checks; canonical argument/scope fingerprints for approvals; SQLite migration 9 adds nullable exact-action approval fields, and dispatch attempts atomically claim one consumed bound approval before effect. New and changed source/test files remain uncommitted. A source-level implementation is not a G2 gate pass.
- **Focused test evidence on this WIP:** 51 durable Task-context tests PASS (`04f913c6-25ff-40a4-83ab-a4618e4d8e53`); 68 compatibility/approval tests PASS (`3a0193d0-d773-42ba-84d6-2592dd74c4dc`); 59 principal/session and Task tests PASS plus standalone/full TypeScript PASS (`d19dc018-42a9-4c07-ae39-be90c33af2c0`); 30 control-plane/retry tests PASS (`3373f6aa-f79b-41f0-b561-25c3cd98b4c1`). These are separate focused passes, not evidence that the final current tree passed a complete suite.
- **Latest completed full suite:** `9b560747-ae75-422b-9de1-0e20ed7462aa` FAILED with one unexpected failure in `tests/core/task-reconciliation.test.ts` (legacy test fixture missing a trusted Task principal/session); 15 pre-existing expected RED cases remain. The manual reconciliation test builders have now been updated to store the trusted creator/session data instead of relaxing the production authority gate, but that final test change has **not** been rerun.
- **Validation blocked by tool safety:** Follow-up focused reconciliation/session tests plus final TypeScript were queued in task `4e1b5fb6-34dc-47ed-b3b1-ba0fa1d3298b`; the tool approval request 528 was blocked by the platform as its safety status could not be determined. No test step ran. This waiting task was explicitly cancelled with no test result; the block has not been bypassed. **Latest full-suite PASS, final typecheck/build/static G1 and G2 acceptance are NOT established for this WIP.**
- **G2 requirements still unmet independent of the final test result:** unrestricted capability lacks an explicit human approval bound to the exact scope expansion; alternate inbound adapter-to-concrete filesystem/process/Git/package paths remain and R2.09 path retirement has not been proven; exact approved control-plane mutation workflows are not complete for all necessary operations. Do not mark R2.02/R2.03/R2.04/R2.05/R2.09 COMPLETE or G2 PASS.
- **Safety of state:** The prior verified checkpoint on `feature/r2-unified-tool-gateway-2026-09-20` remains committed. Current gateway, approval, migration and fixture modifications remain unstaged/uncommitted. No push/merge/deployment/live-service restart/live user database migration, destructive Git reset or cleanup was performed. No additional finding changed from unresolved to VERIFIED_CLOSED.
---

## R2 — G2 VERIFIED PASS (feature-branch acceptance) — 2026-09-20

- **Phase decision:** R2.01–R2.09 COMPLETE for Gate G2. G2 VERIFIED PASS **on the isolated feature branch only**. The preceding R2 WIP / validation-blocked entries are preserved as historical evidence and are superseded by this dated gate result, not silently erased. **R3–R10, G3–G10 and public HTTP/release readiness remain OPEN; do not auto-advance or deploy.**
- **R2.01 catalog:** The sole canonical `OPERATION_CATALOG` covers exactly 53 real MCP operations (30 executable/service operations and 23 Task/project/memory controls); `tests/core/r2-operation-catalog.test.ts` checks exact registration parity, metadata and unknown-tool denial.
- **R2.02/R2.03 actual common authorization:** All 53 direct MCP entrypoints pass through `ExecuteToolUseCase`. The 30 concrete direct operations use `src/infrastructure/composition/r2-mcp-dispatch.ts` behind the authorized handler port; executable inbound registrars are schema-only. Durable Task execution calls the **same** application use case and concrete dispatcher before effect. No Task-loop ambient tool-name-only approval is installed before the gateway: the legacy service compatibility flag is applied only inside the approved handler after the exact persisted approval has been atomically claimed. Server ceiling, authenticated principal/origin, OAuth scopes, descriptor, exact arguments and workspace are checked; unknown operations or unbound approvals fail closed. Tests: `tests/core/r2-no-alternate-inbound-execution.test.ts`, `tests/core/r2-execute-tool-gateway.test.ts`, `tests/core/r2-effective-authorization.test.ts`, `tests/tools/in-process-tools.test.ts`, `tests/core/durable-task-context.test.ts`.
- **R2.04 session and immutable scope:** Real HTTP clients retain separate active workspaces; a persisted Task is bound to creator principal+session and its originally selected root. A colliding idempotency key does not disclose a foreign session's Task ID. Tests: `tests/e2e/r2-http-session-workspace.test.ts`, `tests/security/r2-task-owner-session.test.ts`, `tests/security/r2-workspace-selection-permission.test.ts`.
- **R2.05 approved scope mutation:** `HOOSHIX_UNRESTRICTED` is only a server opt-in ceiling and never automatically enables global file access. An out-of-root file **read or write** requires an ADMIN principal and exact, expiring, single-use human-approved Task request bound to tool, resolved args/path, principal, session, Task/step and captured workspace. SQLite migration 9 adds backward-compatible nullable binding and dispatch columns; old unbound approvals cannot grant an effect. An atomic pre-effect claim prevents replay of the same approval. The approved handler alone receives ephemeral unrestricted AsyncLocalStorage scope. A separate security event records successful elevated operations with Task/step/approval identifiers without recording file contents. Direct root-pool additions cannot bypass approval, while the identical approved Task root mutation succeeds. Tests: `tests/security/r2-unrestricted-exact-approval.test.ts` (including path substitution and persisted audit event), `tests/security/r2-workspace-selection-permission.test.ts`, `tests/security/r2-task-owner-session.test.ts`, `tests/core/persistence-hardening.test.ts`, `tests/core/resume-orchestrator.test.ts`. Approval workflow is security-scoped; this does **not** claim the later R3 crash/timeout/lease gate is complete.
- **R2.06–R2.08:** Sensitive aliased path/search rejection, command cwd/no-index restrictions and real Direct/Task revision/CAS/idempotency parity continue passing in the full suite. Tests include `tests/security/r2-sensitive-path-alias.test.ts`, `tests/security/r0-noindex-disclosure.test.ts`, `tests/security/r2-command-cwd-bypass.test.ts`, `tests/security/r2-direct-command-workspace.test.ts`, `tests/e2e/r2-file-cas-real-parity.test.ts`.
- **R2.09 alternate inbound execution retirement:** File, Git, shell, package, system and workspace executable MCP registrars no longer import/call concrete filesystem/process/Git/package implementations. Two Task snapshot/rollback inbound callbacks are also inert; their real execution passes through the common Task dispatcher. Control-plane Task/project/memory callbacks retain their DB/control operations only *after* the same application authorization boundary. Static and actual MCP/Task tests verify no alternate executable path.
- **Final complete validation on the current source tree:** `pnpm exec vitest run`: **133 files, 589 PASS + 15 expected pre-existing RED (604 total), zero unexpected failures**; `pnpm run typecheck` PASS (standalone+whole project), `pnpm run build` PASS, `node scripts/verify-g1-global.mjs --strict` PASS (**175 files, 0 candidates**), `git diff --check` PASS (Git's LF/CRLF normalization warnings are not whitespace errors). Task evidence: `a13b62d1-d892-4e66-80bb-4da499f8e92d`. Earlier full-suite failures during remediation were addressed and are not misrepresented as completed tests.
- **Finding closures on this gate:** HIGH-01 and MED-28 now VERIFIED_CLOSED based on executable evidence and the single gateway. Existing VERIFIED_CLOSED HIGH-02/HIGH-03/MED-04/MED-06/LOW-01 remain closed. **7 of 54 findings closed; 47 remain for their assigned later phases.** This finding count is not an R10 release verdict.
- **Change isolation:** Changes are local to `feature/r2-unified-tool-gateway-2026-09-20`; no push, main merge, tag, service restart, production database migration, external deployment or destructive cleanup. Migration 9 was checked only in disposable test databases. Future rollout/migration decisions remain separately gated.
---

## R3.01 — canonical persisted Task aggregate mapper — 2026-09-20

- **Status:** R3.01 VERIFIED within R3 IN_PROGRESS; G3 OPEN. No R3.02–R3.10 work claimed here. The R2 G2 decision remains PASS on feature branch e641b6d.
- **Findings:** HIGH-07 moved from TEST_ENCODED to IMPLEMENTING. Current Task/Step semantic hydration is repaired and former HIGH-07 expected-failing test is now green; do not mark the finding VERIFIED_CLOSED until future R3.02 receipts and R3.08 creation request hashes also round-trip through this mapper, as required by doc 11 §5. No other finding closure changed: 7 VERIFIED_CLOSED out of 54.
- **Source changes:** The sole Task aggregate row-to-DTO function `hydrateTaskById` now serves normal `getTaskPlan`, interrupted-task recovery discovery `findInterruptedTasks`, report, and canonical `getResumableTasks` / startup recovery. The recovery code cannot assemble a partial `TaskPlan` from a hand-selected SQL projection. Persisted Task idempotency key, retry policy, max recovery, total run count, execution scope, step template provenance/attempts/errors/outputs, pending approval, timestamps and stored revision are restored uniformly. A waiting Task only shows an unconsumed active approval in its derived pending-approval view.
- **Migration:** Versioned SQLite migration 10 adds `tasks.task_revision INTEGER NOT NULL DEFAULT 0` without changing existing Task records or applying an online migration to the user's live DB. A marker-protected disposable copy of a simulated version-9 DB is migrated to version 10; Task identity/title/description/status/idempotency key remain unchanged and legacy revision defaults to 0. Timestamp fields are read from existing Task rows. Effect receipts and creation-request payload hashes remain assigned to R3.02 and R3.08, not fabricated here.
- **Regression RED then GREEN:** `tests/core/r3-canonical-task-hydration.test.ts` originally failed both full-aggregate and pending-approval cross-path tests before implementation; after implementation all 3 tests (including the historical DB-copy migration case) pass. Existing `HIGH-07` contract in `tests/core/r0-reliability-contracts.test.ts` was converted from an expected failure to a normal passing assertion. Existing recovery/startup/resume and persistence fixtures also pass. RED evidence: task `9049dbfd-df54-45cf-b65e-9eca4e20d602`. Focused 20 PASS + 3 other expected RED: `ce83f627-f668-4d95-b8c5-e4b4801e223a`. Disposable legacy-copy verification 3 PASS + typecheck PASS: `a04f4b7f-5e8b-4a31-8f16-144c2320bd7c`.
- **Full validation before final copy-migration case:** Task `e9a3e873-372b-4d28-8ba3-f59690bcfe0a`: `pnpm exec vitest run` 134 files / 592 PASS + 14 expected RED (606 total), zero unexpected failures; `pnpm run typecheck` PASS; `pnpm run build` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (175 source files, zero candidates); `git diff --check` exit 0 (only Windows LF/CRLF normalization warnings). Migration-copy fixture was added after this full run, verified separately with passing typecheck; final full suite to be recorded separately if run again.
- **Final complete post-migration validation:** Task `fab11bc4-6220-4660-a6cb-226a200b8da1`: `pnpm exec vitest run` **134 files / 593 PASS + 14 expected pre-existing RED (607 total), zero unexpected failures**; `pnpm run typecheck` PASS (standalone+tests), `pnpm run build` PASS, `node scripts/verify-g1-global.mjs --strict` PASS (175 files, zero candidates), and `git diff --check` exit 0 (Git LF/CRLF warnings only). No source changes after this validation; only ledger evidence recorded.
- **Safety and scope:** Only R3.01 implementation, documentation and tests modified; pre-existing clean R2 checkpoint preserved, no external effects or production database writes. R3.02 execution receipt storage, R3.03 timeout handshake, R3.04–.06 unknown-outcome/reconciliation/crash policy, R3.07 durable lease, R3.08 idempotency and R3.09/.10 remain unresolved. G3 must not be closed early.
---

## R3.02 — durable execution receipt model — 2026-09-20

- **Status:** R3.02 VERIFIED on isolated feature branch; G3 OPEN. Next leaf: R3.03 timeout handshake, NOT_STARTED. No work on R4–R10.
- **Findings:** HIGH-07 remains IMPLEMENTING: canonical Task hydration now includes durable latest mutation receipt, but R3.08 must persist canonical creation request hash before closing the all-fields Task aggregate finding. HIGH-05/06/13 and MED-05/08/09 are NOT claimed closed. Audit matrix unchanged (7/54 VERIFIED_CLOSED).
- **Design and code:** Extended the pure Domain `ExecutionReceipt` to contain execution/effect ID, Task Step and canonical Tool ID, effect class, pre/post revision where adapter-provided valid SHA-256 metadata exists, started/finished timestamps, explicit `started|succeeded|failed_known|outcome_unknown` status, termination observation and reconciliation state. A receipt UUID is unique per effect attempt; it is NOT an exactly-once guarantee or an assertion that an external action definitely committed. Receipt construction in `src/core/loop/execution-receipt.ts` derives effects solely from the existing R2 catalog. It stores no raw tool arguments/output/secret values; supported idempotency-key metadata is SHA-256 hashed. Actual external effect references and revisions are omitted when not verified/available.
- **Atomic pre-dispatch intent:** `beginStepExecutionReceipt` writes the running Task Step and STARTED receipt together in one SQLite transaction immediately before mutating Task tool dispatch. No receipt is created for read-only actions, pre-approval pauses, rejected policy or failed template resolution. Each effect attempt is uniquely constrained by (task_id, step_id, attempt), and a failed receipt insertion rolls back the corresponding running Step write. `finishStepExecutionReceipt` permits a single transition from STARTED to observed success, known failure or unknown outcome; it rejects altered identity and duplicate finalization. `execution_receipts` retains every attempt independently, including retries, while `getTaskPlan` / reports / startup/resume/recovery hydrate each Step's latest receipt through the R3.01 canonical aggregate mapper.
- **Migration/data:** Versioned SQLite migration 11 creates `execution_receipts` and Task/Step indexes/constraints without rewriting historical Tasks. A disposable backed-up copy of a simulated v10 database was migrated to v11 and verified to preserve the Task row. Existing Tasks have no invented receipt: absent historical evidence remains absent. No user's live database was migrated or touched.
- **RED then GREEN:** New `tests/core/r3-execution-receipts.test.ts` initially had 6 failing pre-implementation tests (Task `242fb638-0d2b-4662-b4ed-c4eedb946573`). The expanded suite covers pre-effect durable intent, known success, known failure, timeout uncertainty, per-attempt history, absent read-only/preapproval/template-failure receipt, single finalization, same-attempt DB rollback, migration v10->v11, and legacy inferred-tool Task selection. Final focused suite: 11 tests PASS (Task `65a693ac-322d-4958-b856-ad3394c672aa`).
- **Full regression before the final inferred-tool fixture:** Task `1f58647e-2aee-4d7d-9a38-da89c0d7c35f`: `pnpm exec vitest run` 135 files / 603 PASS + 14 expected RED (617 total), zero unexpected failures; `pnpm run typecheck` PASS; `pnpm run build` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (176 files / 0 candidates); `git diff --check` exit 0 with only LF/CRLF normalization warnings. The inferred-tool fixture was added afterward and independently passed; final complete suite to be recorded in a subsequent ledger amendment after rerun.
- **Final complete post-inferred-tool validation:** Task `f7ff5bd8-a11d-459e-81ec-68dfc7d6b719`: `pnpm exec vitest run` **135 test files / 604 PASS + 14 expected RED (618 total), zero unexpected failures**; `pnpm run typecheck` PASS; `pnpm run build` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (176 source files, zero candidates); `git diff --check` exit 0 (Git LF/CRLF warnings only). No source changes after this validation; only ledger evidence amended.
- **Scope/residual risk:** Current Task loop's timeout request still does not wait for external termination acknowledgement (R3.03), and its pre-existing timed-out branch may attempt recovery before reconciliation (R3.04–R3.06). Durable receipt STARTED or OUTCOME_UNKNOWN does not prove external success or safe retry. Execution lease/fencing (R3.07), payload-hash idempotency (R3.08), terminal Task append (R3.09), and business-outcome versus telemetry-failure separation (R3.10) remain open. No push, merge, deployment, service restart, online DB migration or unrelated repository modification performed.
---

## R3 G3 — complete phase acceptance — 2026-09-21

- **Decision:** `GATE_PASSED` on isolated feature branch `feature/r2-unified-tool-gateway-2026-09-20`. All ten R3 leaves are implemented/tested; G3 applies to execution reality and recovery only, not the product release. Do not begin R4 without the next explicit user request.
- **R3.01–02 baseline:** Commit `7cc0b89` unified normal/recovery Task hydration; commit `41472b8` added durable per-mutation receipts and copied-DB migration 10/11. The R3.03–10 changes below extend, rather than rewrite, those accepted contracts.
- **R3.03 Timeout handshake:** `withStepTimeout` treats abort as a cancellation request and observes the exact tool promise for an independently bounded grace. A late returned value within grace is reported as observed success; rejection or no termination acknowledgement remains `outcome_unknown`, never invented as a known failed effect. Grace configuration validated before dispatch. Evidence: `tests/core/r3-timeout-unknown-policy.test.ts` (delayed acknowledgement, grace expiration, aborted rejection, config failure).
- **R3.04 Unknown-outcome policy:** Any unresolved mutation result blocks replay and *all* dependent/corrective execution, including when `maxRecovery>0` or a later pending step exists. Runtime and loop reject automatic retry pending independent reconciliation. The original effect ID and mutation receipt are retained.
- **R3.05 Reconciliation:** Explicit `task_reconcile` audit-only mode and operator decisions `confirmed_succeeded`, `confirmed_failed`, `safe_to_retry`, `still_unknown`, `manual_intervention_required`. Positive/negative classification requires a separate completed read-only verification Task with matching principal/session. The original interrupted tool result remains unknown, and unsupported non-idempotent/unkeyed retry requests fail closed. Reconciliation is not a synthetic retroactive tool success. Evidence: `tests/core/r3-reconciliation-decision.test.ts` (6 cases) and task-repository transactional decisions.
- **R3.06 Crash recovery:** A persisted running mutation/started receipt is treated as unknown; a completed external receipt without a Task commit does not silently re-execute the operation or forge a Task completion. Proven read-only interrupted steps can be resumed; historical missing Tool IDs fail closed. The startup recovery service now acquires the SAME cross-process Task lease before rehydration or any status/receipt write; when a live owner holds it, recovery skips the Task without changing its state. All recovery failures avoid unleased status writes. Evidence: `tests/core/r3-crash-recovery-receipts.test.ts` (4 tests including live-owner skip and subsequent post-release unknown outcome), existing crash-after-marker `HIGH-06`, recovery-coverage suite, focused acceptance Task `bebd4ca7-b704-4451-b84a-d863f4b2f3e5` (13 tests PASS), and final full suite.
- **R3.07 Durable lease:** SQLite migration 12, atomic cross-process acquire/renew/release with owner ID, unique token, monotonically increasing fencing epoch, expiry and heartbeat. Task runtime/resume wrap execution under the lease; Task row/step/receipt writes check the DB epoch/expiry, preventing stale owners from committing after takeover. Evidence: `tests/core/r3-durable-lease-multiprocess.test.ts` with **two independent child processes and exactly one lease winner**, stale-owner write denied, replacement-owner write succeeds. Acceptance Task `d430c953-9257-4c4f-a0aa-a41784965fe0` PASS for multiprocess fixture and source/test TypeScript.
- **R3.08 Idempotency:** Canonical request SHA-256 is stored with the Task creation key (migration 13); input steps/args, title, retry policy and captured principal/session/workspace/scope are included, while incidental correlation metadata is excluded. Same-key/same-request returns the original Task; same-key/different-payload conflicts; a legacy keyed row with no trustworthy original hash fails closed. SQLite unique index serializes competing creators. Evidence: `tests/core/r3-task-creation-idempotency.test.ts` (8 tests), `MED-08` exploit test and copied-v12-to-v13 migration preserving legacy Task records.
- **R3.09 Terminal append:** Completed/cancelled Tasks reject implicit append; a failed Task can receive a corrective append only when no unresolved/running/approval effect exists. Step insert, Task revision increment and transition are atomic and revision-checked; no stale plan overwrite. Evidence: `tests/core/r3-terminal-append.test.ts` (4 cases), updated MCP in-process tests and `MED-09` exploit test. A future explicit reopen use case, if required, is outside R3 and NOT assumed to exist.
- **R3.10 Telemetry separation:** Best-effort audit, metrics and checkpoint/timeline sinks increment degraded observability without changing a known tool result, converting success into failure or triggering a duplicate mutation; authoritative Task/receipt writes are NOT silently swallowed. Evidence: `tests/core/r3-telemetry-degradation.test.ts` (4 cases), existing audit-failure contract.
- **Final full regression:** Task `ea20d895-35e1-4c02-b423-44cf187ee213`: `pnpm exec vitest run` **142 test files / 639 PASS + 11 expected failures assigned to other phases (650 total), zero unexpected failures**; `pnpm run typecheck` PASS (source and tests); `pnpm run build` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (183 source files; 0 architecture candidates); `git diff --check` exit 0 (only Windows CRLF normalization warnings). Explicit R3 multiprocess/lease acceptance is recorded above; the full suite includes those tests. The first full run flagged two now-green MED-08/09 `it.fails` markers; converting those to normal assertions and rerunning yielded the stated final result.
- **Closure update:** `HIGH-05`, `HIGH-06`, `HIGH-07`, `HIGH-13`, `MED-05`, `MED-08`, `MED-09` changed to `VERIFIED_CLOSED` in `20_FINDINGS_TRACEABILITY_MATRIX.md`. Matrix count: 14/54 closed; 40 remaining (28 OPEN, 12 TEST_ENCODED). This does **not** imply authentication, compensation, deployment or release gates G4–G10 are passed.
- **Safety and isolation:** R3 source/tests/docs only; untracked `HooshiX_EAAP_Implementation_Package/` existed concurrently and is deliberately left untouched and **excluded from staging/commit**. No push, merge, deployment, service restart, user workspace cleanup or manually applied production DB migration. R4 NOT_STARTED.
---

## R4.01 — immutable file backup snapshots — 2026-09-21

- **Decision:** R4.01 VERIFIED on isolated feature branch. R4.02–R4.07 have NOT been accepted; G4 remains OPEN. The existing G3 PASS is unchanged.
- **Snapshot contract:** Newly stored file backups capture canonical absolute target, explicit prior existence (present/absent), SHA-256 of previously present bytes and immutable content reference, created and restored timestamps separately. A post-effect revision/state is recorded only upon observed successful completion; unknown outcomes are not manufactured. An SQLite trigger rejects alterations to historical immutable snapshot fields. An absence snapshot cannot be treated as a previously existing empty file.
- **Migration:** SQLite migration 14 evolves `file_backups` on versioned startup only. Legacy sentinel `restored_at='absent'` is classified as prior absent and cleared from the distinct restoration timestamp. Legacy present-file content is hashed when available; non-absolute legacy target is left unverified (not guessed) and no historical post-mutation revision is invented. The v13-to-v14 migration was rehearsed on a marker-protected disposable DB copy, not on the user's live DB.
- **Tests:** New `tests/core/r4-file-backup-schema.test.ts` covers present/absent snapshot and observed postcondition for write/create/modify/delete, immutable historical rows and copied-DB legacy migration. Existing now-green `MED-10` absent-state repeat restore assertion was converted from expected failure to ordinary passing regression in `tests/core/r0-data-integrity-contracts.test.ts`. The complete R4.03 repeated-restore contract and R4.02 revision-guarded restore remain pending; do not close those findings prematurely.
- **Final validation:** Task `6974855a-5ed2-4332-8b81-87ab00e9a8a4`: `pnpm exec vitest run` 143 files, **644 PASS + 10 expected failures assigned to other leaves (654 total), zero unexpected failures**; `pnpm run typecheck` PASS, `pnpm run build` PASS, `node scripts/verify-g1-global.mjs --strict` PASS (183 source files / 0 candidates), and `git diff --check` exit 0 (Windows newline warnings only). Earlier focused R4.01 + copied-migration fixtures 9 PASS in task `a8fb8228-0984-4b51-b7c0-377c7b43da23`.
- **Scope:** Only seven R4.01-related source, test and ledger files are eligible for this leaf's commit. Existing untracked `HooshiX_EAAP_Implementation_Package/` is unrelated and must remain untouched. No push, merge, production DB migration, deploy, service restart, destructive checkout or workspace cleanup.

---

## R4.02 — revision-guarded file restore — 2026-09-21

- **Decision:** R4.02 VERIFIED on isolated feature branch. The normal `restore_file` path now refuses stale revisions, unknown historical postconditions and unverifiable prior bytes; G4 remains OPEN. Next leaf: R4.03 repeated-restore semantics.
- **Restore contract:** Re-authorizes the exact stored canonical absolute target against the CURRENT active workspace and sensitivity policy, before access. For verified v14 backups, reads on-disk file state as an absent/present plus SHA-256 byte revision, verifies the observed post-mutation state, and fails with `RESTORE_REVISION_CONFLICT` before write/delete when an independent edit, deletion or recreation intervenes. A target already matching the immutable previous state is a safe no-op rather than another overwrite. Regular files only; directory/symlink substitution is rejected. A second state check after capturing the displaced backup detects intervening changes before restoration; final state is read and verified before recording restored status. The displaced backup records its actually observed post-restore state so undo-of-undo itself passes the normal revision guard.
- **Fail-closed historical handling:** Backups with missing/unknown post-mutation evidence, legacy unversioned rows or unverifiable previous content reject restore. No force/historical overwrite flag is exposed by this API; such a distinct operation requires explicit target-bound approval and displaced-state capture, and has not been implemented or claimed as supported.
- **Findings:** MED-11 and MED-12 moved from TEST_ENCODED to VERIFIED_CLOSED after targeted/full regression and pre-existing workspace reauthorization tests. MED-10 remains TEST_ENCODED pending the comprehensive R4.03 repeated-restore contract; R4.04–07 and G4 remain OPEN. Matrix: 16/54 closed, 28 OPEN, 10 TEST_ENCODED.
- **Focused validation:** Task `710a0423-dd85-4f22-b7b4-a01b5b848a7c`: four relevant files / **72 tests PASS**, including seven new revision-guard tests (stale content, recreated deleted target, unexpected absence, unknown postcondition, successful present/absent restore and displaced-backup undo, stale second restore). Converted existing MED-11 expected-failing contract to passing assertion.
- **Final full regression:** Task `49cad18b-0660-4d5a-b508-19c353269248`: `vitest run` **144 files / 652 PASS + 9 expected failures assigned to other leaves (661 total), zero unexpected failures**; source/test TypeScript, production build, strict G1 (183 files/0 violations) all PASS. The initial typecheck run found two Buffer-vs-string compile errors; corrected byte-exact hashing then repeated the entire gate. The first full-run wrapper's 30-second orchestration timeout was diagnosed; final run used an explicit 120-second step timeout and completed.
- **Data/scope:** No schema change beyond accepted v14, no production DB migration or workspace cleanup. Changed only filesystem restore service, MED-11 contract, new focused tests, traceability matrix and this ledger. Existing unrelated untracked `HooshiX_EAAP_Implementation_Package/` left untouched. No push, merge, deploy, restart or reset. External-process modification between the final check and the filesystem effect is not a transactional CAS operation; this residual concurrency risk is not claimed solved by the SHA-256 guard.

---

## R4.03 — deterministic repeated restore — 2026-09-21

- **Decision:** VERIFIED on isolated branch; G4 still OPEN. An already-matching previous state produces an explicit `alreadyRestored:true` no-op, without content writes, file removal, duplicate displaced backups or changes to the original immutable snapshot. Successful first application reports `alreadyRestored:false`. The first `restored_at` timestamp is preserved by updating only when NULL.
- **Safety:** An unrelated later edit after a prior restore remains a revision conflict, never a second overwrite. Present/absent previous-state variants remain immutable independently of restoration history. Historical snapshots lacking observed post-mutation evidence remain fail-closed.
- **Evidence:** `tests/core/r4-repeated-restore.test.ts` (3 new passing cases), existing MED-10/11/12 and R4.02 regressions (14 focused tests PASS). Task `11d5257b-ae16-4867-9e0d-2d35b3fd84c3` full suite: 145 files, 655 PASS + 9 expected failing other-phase contracts (664 total), source/test TypeScript, build, G1 strict (183 files, 0 candidates) PASS. MED-10 -> VERIFIED_CLOSED; 17/54 findings closed.
- **Scope:** No additional DB schema, no live DB migration, no external deployment, no unrelated EAAP folder modification. R4.04 canonical project identity is next.
