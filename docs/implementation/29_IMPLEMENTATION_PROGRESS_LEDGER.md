# Implementation Progress Ledger

**Project:** `D:/workspace/hooshix-agent`  
**Program:** Full Hexagonal/Clean redesign + complete consolidated-audit remediation  
**Status:** R0 GATE_PASSED; R1 GATE_PASSED (G1 PASS); R2 GATE_PASSED (G2 PASS on isolated feature branch); R3 GATE_PASSED (G3 PASS on isolated feature branch, 2026-09-21). R4 GATE_PASSED (R4.01–R4.07 VERIFIED; G4 PASS on isolated feature branch, 2026-09-21). R5 GATE_PASSED (R5.01–R5.12 VERIFIED; G5 PASS on isolated feature branch, 2026-09-21); R6 GATE_PASSED (R6.01–R6.09 verified; measured v17 query/write trade-off explicitly accepted by owner, 2026-09-23); R7 IN_PROGRESS (R7.04 HIGH-10 implementation started); R8–R10 NOT_STARTED.
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
| R4 Data integrity/compensation | GATE_PASSED | G4 PASS — immutable file restore, canonical project identity, clean Git snapshots/rollback and truthful package manifest compensation VERIFIED on isolated feature branch | 2026-09-21 | 2026-09-21 | 148 files / 673 PASS + 7 expected RED assigned to R5–R10; Typecheck, Build and strict G1 PASS; no live migration or deployment |
| R5 HTTP/OAuth/MCP modern | GATE_PASSED | G5 PASS — isolated HTTP/OAuth process + v2 Stdio/HTTP, bounded contexts, fake-clock expiry, issuer and credential proofs | 2026-09-21 | 2026-09-21 | 155 files / 692 PASS + 4 expected later-phase RED; source/test TypeScript, build, G1 strict 186/0 PASS. Windows POSIX permission behavior remains conditional; live connector cutover and Docker/CI smoke not claimed. See R5 G5 closure record. |
| R6 Persistence/perf/observability | GATE_PASSED | G6 PASS — R6.01–R6.09 verified; owner explicitly accepted the measured v17 query/write trade-off | 2026-09-21 | 2026-09-23 | Full validation: source/test TypeScript PASS, 163 files / 714 PASS + 1 expected R7 HIGH-10 RED / 0 unexpected failures, build PASS, strict G1 189/0 PASS. Pinned 250k A/B preserves result/integrity and filtered query improves ~45–76x; five of six paired write medians exceed +20%, explicitly accepted as residual R6 risk on 2026-09-23. No live migration/deployment implied. |
| R7 Config/deployment/CI | IN_PROGRESS | G7 OPEN — R7.01/R7.02 typed-config cutover, R7.06 digest pin, R7.08 toolchain gate and R7.10 advisory verdict done and locally verified; real container build/non-root/live-ready smoke and clean-checkout CI still pending (Docker daemon unreachable on this host) | 2026-09-23 | | 167 files / 768 tests PASS serially; TypeScript, build, strict G1 190/0, secret scan, audit all PASS |
  | R8 Verification/parallel/fuzz | IN_PROGRESS | R8.06 parallel isolation DONE (root cause: shared DB EPERM + shared runtime-files tree; fixed per VITEST_WORKER_ID; 4× consecutive green parallel runs) | 2026-09-23 | | 168 files / 771 tests PASS in default parallel mode; serial 167/768 PASS |
| R9 Legacy deletion/docs/cutover | NOT_STARTED | — | | | |
| R10 Final release validation | NOT_STARTED | — | | | |

Allowed phase status: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `GATE_FAILED`, `GATE_PASSED`.

---

## 3. Finding closure summary

| Severity | Total | OPEN | TEST_ENCODED | IMPLEMENTING | IMPLEMENTED | VERIFIED_CLOSED | DEFERRED_BY_OWNER |
|---|---:|---:|---:|---:|---:|---:|---:|
| HIGH | 13 | 0 | 2 | 0 | 1 | 10 | 0 |
| MEDIUM | 29 | 10 | 0 | 0 | 0 | 19 | 0 |
| LOW | 12 | 11 | 0 | 0 | 0 | 1 | 0 |
| **TOTAL** | **54** | **21** | **2** | **0** | **1** | **30** | **0** |

The detailed source is `20_FINDINGS_TRACEABILITY_MATRIX.md`; keep totals consistent.

---

## 4. Current task

```text
Completed phases: R0–R6 (G0–G6 VERIFIED PASS on isolated feature branch). G6's v17 Metrics index batch-write penalty is owner-accepted as an explicit R6 design trade-off, not removed or approved for live deployment; see R6_G6_OWNER_ACCEPTANCE_2026-09-23.md.
Current phase: R7 IN_PROGRESS (G7 OPEN). This session completed and locally verified: R7.01 complete immutable typed config cutover with single-parse-path compatibility readers; R7.02 retired-name conflict detection and first-party artifact canonical-name consistency; R7.06 digest-pinned base image with provenance and update procedure; R7.08 tested runtime toolchain gate; R7.10 real dependency advisory verdict; R7.09 runbook updated. Still outstanding for G7: R7.04/R7.05/R7.07 real frozen-image negative build, non-root container runtime and live/ready health smoke (Docker daemon unreachable on this host, so these are encoded in CI but not executed), clean-checkout CI execution, and serial coverage evidence on the final changeset. R8 STARTED for R8.06 only (parallel isolation root-caused and fixed; the other R8 leaves remain NOT_STARTED). R9–R10 NOT_STARTED.
Latest validation: 168 test files / 771 tests PASS in DEFAULT parallel mode (including the r8-parallel-isolation guard); serial mode 167 files / 768 tests PASS (baseline 165/726); source/test TypeScript PASS; production build PASS; strict G1 190 files / 0 candidates PASS; git diff --check exit 0; r7-secret-policy-check PASS (8 files / 482 tracked paths); pnpm audit --prod --audit-level=high against registry.npmjs.org: No known vulnerabilities found.
Findings: unchanged from the authoritative matrix (30/54 VERIFIED_CLOSED). No finding was closed by this session's R7 work; HIGH-10/HIGH-11/HIGH-12 remain pending their real container/CI evidence.
Gate: G0–G6 PASS on isolated branch; G7–G10 OPEN. HooshiX is NOT release-ready.
Workspace: D:/workspace/hooshix-agent; feature/r2-unified-tool-gateway-2026-09-20 branch. Nothing here authorizes a live database cutover, production deployment, service restart, push or merge.
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
Code/security: G4 PASS; unresolved finding contracts belong to R5–R10 (including HIGH-10 Docker frozen-lock fallback in R7). No force-historical file restore, dirty Git recovery or full installed-package compensation is claimed.
Testing: 7 expected failing contracts remain assigned to later phases. G5–G10 release/security/performance/fuzz and production cutover are NOT PASSED. R3 cross-process lease/recovery and R4 disposable copied-DB migration proofs PASS.
Architecture: G1–G4 PASS on isolated feature branch. MCP SDK v2 and HTTP/OAuth migration remain R5, legacy retirement R9 and release verification R10.
Data-integrity concurrency: SHA-256 normal restore guard does not atomically exclude external OS writers between final check and filesystem effect (residual TOCTOU).
Operational/safety: public HTTP/release remain blocked. No push, merge, tag, deploy, restart, live DB migration, branch reset or deletion of unrelated user work was performed by R4.
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

---

## R4.04 — canonical project identity — 2026-09-21

- **Decision:** VERIFIED on isolated feature branch. R4.05 Git snapshot is next; G4 OPEN. MED-07 changed to VERIFIED_CLOSED; 18/54 findings closed.
- **Implementation:** One shared `canonicalProjectPath` helper used by both runtime project repository and migration; absolute normalized identity with existing symlink/junction resolution and Windows case-folding. Project writes persist `canonical_path` and `display_path`, reject equivalent identity on create or update, preserve IDs. SQLite migration 15 preflights every existing project and fails atomically with both project IDs on canonical collisions; it never guesses memory or Task ownership. UNIQUE identity index and not-null insert/update triggers protect the DB boundary.
- **Migration evidence:** `tests/core/r4-project-canonical-identity.test.ts` covers duplicate lexical/case identity, existing symlink alias, copied-v14 project upgrade retaining ID/path, missing canonical rejection, and copied-v14 collision rollback proving schema/version/rows unchanged. No production DB migration was manually applied.
- **Verification:** Focused task `c63e2fc4-fbed-4d36-a89b-7498712af81d`: 9 tests PASS plus source/test typecheck PASS after two test-only TypeScript diagnostics were corrected. Full task `91f7ad79-2bc2-4241-ad1e-e50c7e7a7c18`: 146 files / 659 PASS + 9 expected RED in other phases, TypeScript, build, strict G1 PASS (184 scanned source files / 0 candidates).
- **Scope:** Only project identity, migration schema, focused test, migration-version assertion, finding matrix and ledger. No live DB, deployment, push, merge, reset or unrelated untracked EAAP file mutation.

---

## R4.05–R4.06 — verified clean Git snapshot and destructive rollback contract — 2026-09-21

- **Decision:** VERIFIED on isolated feature branch. The snapshot entrypoint refuses dirty tracked/index/untracked repositories before storing a snapshot, and refuses unverifiable status/HEAD and a non-root working directory. A valid snapshot stores the clean contract version, exact repository root, HEAD, branch and verified empty porcelain status. A dirty repository returns `GIT_DIRTY_SNAPSHOT_UNSUPPORTED`, no durable rollback capability.
- **Rollback safety:** Requires high-risk task approval, trusted clean versioned snapshot, exact stored repository, matching current branch and existing captured commit before destructive actions. Rejects historical dirty/unversioned rows or a different workspace/repository/branch; executes Git hard reset and untracked clean only for an approved exact clean snapshot, then verifies HEAD, branch and clean worktree. Ignored files are outside the claimed reconstruction guarantee.
- **Evidence:** `tests/core/r4-clean-git-snapshot-rollback.test.ts`: 6 isolated disposable-Git cases for staged/worktree/untracked denial, clean exact roundtrip, historical dirty rejection, repo/branch mismatch and approval. The formerly expected-failing HIGH-08 exploit assertion was converted to ordinary PASS. Focus task `2b89e90b-715c-4582-9f9f-688b927087fb`: 65 PASS + 1 then-expected HIGH-09 RED in 4 files; source and test TS PASS. No Git reset or clean ran against the actual project.
- **Finding:** HIGH-08 VERIFIED_CLOSED; Git dirty-state restoration remains deliberately unsupported rather than claiming to recover uncaptured changes.

## R4.07 — package manifest compensation and outcome truthfulness — 2026-09-21

- **Decision:** VERIFIED on isolated feature branch. Application exposes `restorePackageManifest`; the MCP `package_restore` name remains a deprecated, explicitly manifest-only compatibility alias. Only captured supported regular manifest files are eligible, with bounded validated binary data, no traversal, duplicate, unexpected-manager paths, or symlink substitution; exact content/absence is verified after restoration.
- **Outcome contract:** Result `manifest_restored` carries `restored:false`, `manifestOnly:true`, `environmentReconciliationRequired:true` and exact verified files. Managers lacking file manifests return explicit `manifest_restore_unsupported`; installed package/environment reversal is never inferred. Known operation failure may restore and verify *only* captured manifests; subprocess timeout/cancellation/unknown verification is marked `outcome_unknown` with no automatic compensation or successful restoration claim. Persistence status uses `manifest_restored`, `manifest_restore_failed`, `outcome_unknown` and `environment_reconciliation_required` instead of unqualified `rolled_back` for new operations; old rows are handled conservatively.
- **Evidence:** `tests/core/r4-package-manifest-compensation.test.ts` (6 disposable cases: byte-exact restore with unchanged installed marker; absent manifest; winget unsupported; traversal preflight; symlink denial; timeout unknown without auto-compensation). Existing HIGH-09 expected failure was converted to ordinary PASS and package snapshot lifecycle assertions updated to truthful status. Focus task `6a33c68a-e912-4781-8b29-b531f80ea7fa`: 13 PASS and source/test TS PASS.
- **Finding:** HIGH-09 VERIFIED_CLOSED; no real package manager install/update/remove was executed during this leaf.

## R4 G4 — phase acceptance — 2026-09-21

- **Decision:** PASS on isolated branch. All seven R4 leaves R4.01–R4.07 VERIFIED, no R5 work initiated. The traceability matrix now records 20/54 VERIFIED_CLOSED (HIGH 9/13, MED 10/29, LOW 1/12), 28 OPEN and 6 TEST_ENCODED for later phases.
- **Final integration:** Task `68776e71-27bc-4d8a-b490-f7b94515a7c8`: `vitest run` 148 test files, **673 PASS + 7 expected RED belonging to later phases (680 total), zero unexpected failures**; independent source and test TypeScript, production build and strict G1 **184 scanned source files / 0 violations** PASS. `git diff --check` PASS. Tests include copied v14 migration collision rollback, immutable v14 file backups, repeat restore, revision conflict, clean/dirty Git and package outcome/manifest truthfulness.
- **Residual limitations:** R5–R10 and seven expected RED contracts are not resolved by G4. Live user DB was not manually migrated; no release/deploy/public HTTP approval. External-process file modification between the final SHA check and filesystem effect is not protected by cross-process atomic CAS; no general dirty-Git rollback or installed package rollback is claimed.
- **Scope/isolation:** Existing unrelated untracked `HooshiX_EAAP_Implementation_Package/` preserved and excluded. No push, merge, deployment, service restart, production DB migration, branch reset, or cleanup of unrelated user data.

---

## R5 — HTTP/OAuth/MCP modern — in progress, 2026-09-21

- **Decision:** R5 implementation is active on the isolated feature branch. G5 is OPEN; this record does not declare release readiness or full current-spec interoperability.
- **R5.01–R5.04:** Operator bootstrap secret is separate from client bearer credentials. Token repository migration 16 stores SHA-256 token hashes, principal, client, resource, scope, issuance/expiry/revocation and refresh-family replay state. Code redemption is one-time with PKCE S256; issued bearer validation enforces resource and expiry. Refresh rotation consumes the predecessor atomically and family replay invalidates descendants.
- **R5.05 and MCP v2:** Split SDK v2 packages are pinned alongside the transitional v1 dependency; modern 2026-07-28 HTTP client/server process exchange and legacy HTTP workspace isolation pass disposable end-to-end tests. Stdio v2 serving is wired. Final SDK/current-spec authorization and migration compatibility proof remains to be closed.
- **R5.06–R5.12:** Query bearer is rejected; dashboard uses separate HttpOnly operator web sessions or monitoring-scoped issued bearer; public/identity request budgets and bounded concurrent MCP requests exist; sessions have idle/absolute TTL and capacity ceilings; public HTTP bind requires configured trusted HTTPS URL and browser origins are constrained; unauthenticated minimal live/ready probes and POSIX owner-only bootstrap file create/validation are implemented.
- **Evidence:** Full acceptance task `6da6b5ba-3320-4673-8747-2b9ad8a7c94e`: source/test TypeScript PASS; 151 test files, 683 PASS + 4 expected remaining-phase failures, zero unexpected failures; production build PASS; strict G1 186 source files / zero candidates PASS; git diff --check PASS. Focused task `ef982bca-2699-4b20-ba9d-4b329d407541`: 3 files / 7 PASS for R5 issued token and HTTP integration. Subsequent isolated fake-clock configuration/session/rate regressions task `e2a70439-0418-4100-8a02-2376d30ef8fe`: 4 PASS. Independent HTTP edge process + fake-clock regression task `4a41312d-76b2-44db-85b4-40d665adabfb`: 4 PASS; on Windows the POSIX chmod-rejection branch is not executed.
- **Migration observation:** A read-only query of the configured local runtime SQLite file found migrations through v16, 7 project rows, 984 historical file-backup rows, and `quick_check=ok`. This confirms the local service DB has reached v16 but does not establish an approved production-copy cutover or a rollback rehearsal. No manual migration or repair was performed during this work.
- **Final full-suite rerun:** Task `326f1944-206c-46a3-a757-e571d683b521` (source/test TypeScript, full Vitest 153 files / 687 PASS + 4 expected other-phase failures, build and strict G1 186/0 all PASS). The working diff whitespace check found an added blank line at ledger EOF; that formatting defect was corrected and the patch check must be rerun before staging.
- **Before G5 closure:** Record the remaining process-level fake-clock expiry/PKCE/session-expiration checks, v2 Stdio/current authorization interoperability and platform-specific bootstrap permission proof; rerun full suite/build/architecture gate on the final changeset, verify the exact staged patch and then mark finding statuses. Do not count R5 findings as VERIFIED_CLOSED based on this interim record.
- **Isolation:** Only R5 source, tests and implementation docs are intended for staging. The untracked EAAP package, `data/backups/` and existing `scripts/r5-*.mjs` diagnostics must remain untouched; no Git reset, merge, push, deployment or user-file cleanup.

---

## R5 continuation after connector access recovery — 2026-09-21

- **Starting point:** `9ca9a96` on `feature/r2-unified-tool-gateway-2026-09-20`, no dirty tracked files. Preserve the other assistant's recovered operational connector state, existing OAuth registrations, project-collision repair/backups and untracked diagnostics; none of those are inputs to this checkpoint.
- **Scope:** Added only disposable regression fixtures `tests/e2e/r5-isolated-stdio-and-clock.test.ts` and `tests/e2e/r5-http-session-fakeclock.test.ts`. The v2 client pinned to MCP 2026-07-28 negotiates with a separate Stdio server process and lists its tools. A separate OAuth process with an injected fake clock verifies code expiry, single-use PKCE, resource/audience binding, access-token expiry, refresh rotation and family replay invalidation. An isolated real HTTP process with its clock injected *before* module initialization verifies operator web-session idle and absolute TTL. Every test child uses a marker-owned temporary workspace and database.
- **New R5.05 finding / known G5 blocker:** The current local OAuth authorization-server metadata does not advertise `authorization_response_iss_parameter_supported`, and its authorization-code redirect does not include an RFC 9207 `iss` issuer stamp. The new `it.fails` regression deliberately encodes this as a remaining G5 issue, not a verified fix. Official 2026 guidance rechecked: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28 and https://blog.modelcontextprotocol.io/posts/2026-07-28/ . An attempted guarded `modify_file` on `src/mcp/http-server.ts` returned `tool_handler_failure`; a subsequent read and Git status confirmed no runtime source change. Do not bypass the guarded file mutation or change live connector settings merely to force a pass.
- **Focused verification:** Task `187550e9-a597-4ca9-b893-4ec69e34fd18`: 2 test files, 3 PASS + 1 expected R5 issuer failure; no unexpected failures. The existing process tests also passed in task `607d096e-8fac-4fe7-b8f3-427953630765` (3 files / 7 PASS).
- **Full verification:** Task `2b11fb9f-8006-4d76-b36e-7f2db7c74f09`: source and test TypeScript PASS; full suite 155 files / 690 PASS + 5 expected failures (including the new R5 issuer blocker), zero unexpected failures; production build PASS; strict G1 186 scanned files / 0 candidates PASS. This does **not** establish G5 PASS or live-connector readiness.
- **Operational boundary:** No restart, deployment, live DB migration, OAuth client re-registration, secret rotation, Git reset/merge/push or edits to unrelated EAAP/recovery artifacts. G5 remains OPEN. Next action is to resolve the issuer-stamp gap safely, then retest the existing connector's consent/reauthorization behavior without overwriting operator grants and complete remaining current-auth conformance checks before any G5 closure.

---

## R5.05 — Authorization response issuer stamp resolved — 2026-09-21

- **Decision:** VERIFIED for the exact issuer-stamp gap on the isolated branch; this supersedes the blocker recorded above, without asserting live-service deployment or G5 completion.
- **Explicitly approved narrow fallback:** Direct `modify_file` on `src/mcp/http-server.ts` again returned `tool_handler_failure`. With the owner's express authorization for this specific case, an approval-gated `node -e` task (`0493d4ec-edbb-43b9-a39e-a4a7323e51a5`) enforced clean tracked target, exact two unique search strings, regular-file and repository-root checks, an unchanged SHA-256 precondition and post-write byte verification. It changed ONLY OAuth metadata to advertise `authorization_response_iss_parameter_supported:true` and the authorization-code redirect to append `iss=CONFIG.publicBaseUrl`. No other HTTP behavior, token/client record, live database or connector credential was altered.
- **Real isolated HTTP proof:** In `tests/e2e/r5-http-session-fakeclock.test.ts`, a temporary server and registered fixture client verify exact configured metadata issuer, advertised RFC 9207 support, redirect containing an exact encoded `iss`, and continued issuance of an authorization code. The historical `it.fails` assertion was removed rather than left as a false expected failure. The same isolated server with a fake clock rejects a wrong-resource token exchange, returns `expires_in=3600`, and returns HTTP 401 on the protected MCP endpoint after 3600 seconds; operator web-session idle/absolute expiry is retained.
- **Additional independent token proof:** The separate OAuth process fixture now explicitly verifies manual access-token revocation, on top of PKCE, code expiry, resource binding, access expiry, refresh rotation and replay-family revocation.
- **Validation:** Focus task `0a670435-96d7-4b28-9ce2-bf40a672ba46`: source/test TypeScript PASS and 4 focused files / 9 PASS. Token/HTTP extra process tasks `418bbe3d-43c4-49e5-9221-236786f437a1` and `96ce2398-ee03-4854-adc2-0b41c4a00fa9` PASS. Full acceptance task `25358b93-e6b4-4bd4-abf6-c7661045be6c`: source and test TypeScript PASS; 155 test files / 690 PASS + 4 expected RED assigned to other phases, zero unexpected failures; production build and strict G1 (186 scanned source files / 0 violations) PASS. After the additional isolated HTTP 401-on-expiry and manual access-revocation fixture assertions, final task `eb5b33d4-8d88-47a0-b0c4-3919296eecb6` re-ran source/test TypeScript (PASS), full Vitest (155 files; 690 PASS + 4 expected failures belonging to other phases; 0 unexpected failures), production build (PASS) and strict G1 (186 source files; 0 violations).
- **Operational boundary:** No running HooshiX service restart, local-user database repair/migration, production client re-registration, token rotation, push, merge or deployment. The external connector is not claimed reauthorized or upgraded by these repository-only changes; a separate controlled cutover and existing-client smoke test remain necessary before claiming live interoperability. G5 remains OPEN in this narrowly scoped checkpoint pending broader phase acceptance; later R7 owns the existing Docker/Compose healthcheck/config migration and POSIX-only permission tests cannot be exercised on Windows.

---

## R5 G5 — phase acceptance — 2026-09-21

- **Decision:** G5 PASS for the isolated-branch R5.01–R5.12 HTTP/OAuth/MCP code-and-process acceptance gate. This supersedes the preceding dated IN_PROGRESS and G5 OPEN records; the product is NOT release-ready and no operational cutover is authorized.
- **Scope:** Existing R5 OAuth grants use distinct opaque bearer credentials, stored SHA-256 hashes, resource/client/scope binding, issuer-stamped authorization responses, short-lived authorization code + PKCE S256, enforced access expiry, one-time refresh rotation and family replay invalidation. Header-only bearer and scoped monitoring/browser sessions prevent query-secret use. Public binding validates its configured HTTPS public base, rejects stale auth configuration, and restricts origins; live/ready endpoints are minimal. Modern HTTP and Stdio run under the pinned 2026-07-28 MCP SDK v2 protocol; legacy HTTP session compatibility remains bounded and isolated in the adapter.
- **R5.09 final change:** `HttpPrincipalContexts` in `src/infrastructure/server/http-security.ts` bounds modern principal+client workspace context to 64 active identities with 30-minute idle TTL and 8-hour absolute TTL; expired contexts are pruned on access. Modern `/mcp` returns HTTP 429 with Retry-After if the context budget is full; request workspace state is never keyed solely to `Mcp-Session-Id`. A fake-clock unit regression verifies per-identity reuse, idle/absolute expiry and cap. Legacy sessions retain their independent bounded lifecycle.
- **Process-level G5 evidence:** `tests/e2e/r5-http-security.test.ts`, `tests/e2e/r5-http-edge-contracts.test.ts`, `tests/e2e/r5-http-session-fakeclock.test.ts`, `tests/e2e/r5-isolated-stdio-and-clock.test.ts` and `tests/security/r5-issued-credentials.test.ts` cover the required PKCE positive/negative cases, issued-vs-bootstrap token isolation, fake-clock 401 after the advertised 3600-second expiry, resource/audience and consent-scope checks, revoked grants, refresh replay, rejected query bearer, 429/Retry-After, browser CSRF/logout plus idle and absolute TTL, configured public base and rejected external origin, no-secret unauthenticated liveness/readiness, monitoring scope, and bootstrap secret creation. The focus task `01bd2ab9-965d-41f5-b5ba-c3a0ce5c1c20` passed 5 files / 10 tests including the final modern context and browser/config cases.
- **Full phase acceptance:** Task `05342dce-331d-4756-afe1-a98df2db0a47` ran independent source + test TypeScript PASS, full Vitest **155 files / 692 PASS + 4 expected later-phase RED / 0 unexpected failures**, production build PASS, strict global G1 **186 source files / 0 violations** PASS.
- **Finding closure:** HIGH-04, MED-01, MED-22 and MED-29 upgraded to VERIFIED_CLOSED with persistent real HTTP/OAuth process and v2 client fixtures. Matrix total is 24/54 VERIFIED_CLOSED; HIGH 10/13, MEDIUM 13/29, LOW 1/12; 26 OPEN and 4 TEST_ENCODED for subsequent phases.
- **Explicit remaining work outside G5:** HIGH-11/12 retain Docker/Compose/CI/config or real container smoke acceptance in R7; MED-03 retains independent expensive-operation concurrency evidence and R6 performance limits; LOW-07 requires actual POSIX owner-only creation/rejection proof on a POSIX-capable CI target (Windows fixture only checks available platform behavior). These findings are NOT marked closed. R8 retains repeated release-stage interoperability and parallel/fuzz gates; R9 owns v1 SDK compatibility retirement; production OAuth reauthorization and migration/cutover require a separate controlled operational plan.
- **Isolation:** No live HooshiX server restart, production database migration/repair, existing-client re-registration, secret rotation, Git reset/merge/push, deployment or destructive cleanup. Existing untracked EAAP package, database backups and the other assistant's diagnostic/recovery scripts remain excluded from this phase checkpoint.

---

## R6.01 — Migration-only initial schema — VERIFIED 2026-09-21

- **Decision:** R6.01 verified on the isolated feature branch; G6 remains OPEN, with R6.02–R6.09 and G6 benchmarks/observability evidence outstanding.
- **Architecture:** The SQLite connection adapter delegates new-file base table creation to `src/adapters/outbound/persistence/sqlite/base-schema.migration.ts`, whose transaction installs the baseline and records version 0 atomically. Only previously absent database files get this baseline; existing databases retain historical versions 1–16 without a retroactive version-0 marker or unrequested repair. Incremental `ALTER TABLE` operations remain inside `src/core/memory/database/migrations.ts`, not the normal repository/tool path. Database singleton publication occurs only after initialization succeeds; a failed initialization closes its connection.
- **Isolated evidence:** `tests/core/r6-migration-only-schema.test.ts` verifies 0–16 ordered version history, repeated migration idempotence, SQLite `quick_check`, transactional rollback on a version-0 collision, preservation of a historical user row and unmarked version history, and fail-closed behavior for an unrelated existing SQLite schema without creating tables. Existing `tests/core/database-lifecycle.test.ts`, `tests/core/persistence-hardening.test.ts`, `tests/core/r4-file-backup-schema.test.ts`, and `tests/core/r4-project-canonical-identity.test.ts` also pass. Task `5199d957-50f6-4766-87c8-bd41513a79f7` passed TypeScript and 5 focused files / 26 tests.
- **Full verification:** Task `5bff06fc-9d45-464d-9ee4-8dd68c2cdb1b`: source and test TypeScript PASS, all 156 Vitest files / 696 PASS + 4 expected RED assigned to later phases / zero unexpected failures; production build PASS; strict G1 187 scanned source files / zero violations PASS.
- **Safety and scope:** Test subprocesses use marker-owned temporary databases; no manual migration of the live SQLite file, application restart, branch reset, deployment, push, merge, or mutation of unrelated backups, EAAP materials or prior recovery scripts. Existing production data migration/cutover requires separate operational approval and proof. Next planned leaf is R6.02 retention service.

---

## R6.02 — Periodic class-aware retention — VERIFIED 2026-09-22

- **Decision:** R6.02 code/fixture acceptance VERIFIED on the isolated feature branch. G6 remains OPEN; the next leaf is R6.03 representative metrics-query benchmarking, followed by R6.04–R6.09.
- **Explicit policy:** `src/adapters/outbound/persistence/sqlite/cleanup.adapter.ts` defines separate `toolCalls`, `checkpoints`, `recoveryEvents`, `approvals` and `restoredBackups` retention classes with independently validated whole-day lifetimes (default 90 days; optional per-class overrides through `createRetentionPolicy`). All SQL predicates are static and bound by cutoff; one SQLite transaction covers a deletion pass. Active task checkpoints, active recovery, unconsumed approvals, unrestored backups and backup records for absent files are preserved. Task plans, executions, OAuth's separate TTL repository, and other unlisted data have NO implicit deletion policy.
- **Dry-run/report:** `runRetention({policy,nowMs,dryRun:true})` runs only COUNT queries and returns mode, per-class cutoff/count and total; delete mode returns the same report shape with actual affected rows. Legacy `cleanupAgentData(days)` retains its count-only return contract.
- **Periodic scheduling:** `src/infrastructure/server/retention-scheduler.ts` provides startup + six-hour unref'd periodic cleanup with a cancellation handle, re-entrancy guard and error/report hooks. Both stdio and HTTP entrypoints register this scheduler using the existing `HOOSHIX_RETENTION_DAYS` setting. A logging failure does not alter the main server outcome; invalid/disabled legacy settings do not trigger cleanup. No live service was restarted, so operational cutover is not claimed.
- **Isolated tests:** `tests/core/r6-retention-service.test.ts` verifies all five classes with old/recent, terminal/active and consumed/unconsumed fixture rows, nonmutating dry-run, idempotent actual deletion, per-class day overrides and input rejection, immediate/periodic execution, error continuation and stop. Task `0d490866-fd5d-42b8-bb1d-4725ce9eddb0`: source/test TypeScript PASS, three fixture files / 12 PASS.
- **Full acceptance:** Task `17ac25db-6b19-40c6-9e62-10f08450d2da`: source/test TypeScript PASS; full 157 Vitest files / 699 PASS + 4 expected later-phase failures / 0 unexpected failures; production build PASS; strict G1 188 source files / zero violations PASS.
- **Finding closure:** MED-18 (retention startup-only/incomplete) VERIFIED_CLOSED with the five-class dry-run/delete and periodic-scheduler regression evidence above. Finding matrix totals now 25/54 closed; HIGH 10/13, MEDIUM 14/29, LOW 1/12. MED-19 session metrics pruning remains R6.06 and is not silently included in this closure.
- **Isolation:** Test runs use the Vitest dedicated test database and marker-owned child fixtures; the other assistant's existing untracked EAAP materials, runtime backups, diagnostic/recovery scripts and all active connector credentials are excluded. No manual live DB cleanup or migration, restart, push, merge or deployment. G6 and release readiness remain OPEN.

---

## R6.03 — Real Metrics query benchmarks — VERIFIED 2026-09-22

- **Decision:** R6.03 benchmark evidence VERIFIED on isolated feature branch. This is the *pre-index* baseline for R6.04, not a G6 release gate closure. G6 stays OPEN.
- **Reproduction:** `pnpm exec tsx scripts/r6-metrics-benchmark.mts` runs the real `getAgentMetrics` outbound adapter with 25,000/250,000 `tool_calls` rows plus proportional execution and recovery rows in a newly created, marker-owned OS temporary SQLite database. Source bootstrap/migrations create the fixture; the script closes the database and deletes only that marked temporary root. The configured live database is never used.
- **Observed two-run medians (ms):** At 25k: global 9.947 / 11.001; filtered task/category/date 16.983 / 16.035; paged offset 1000 8.121 / 9.779. At 250k: global 174.904 / 175.743; filtered 304.209 / 295.984; paged 179.181 / 170.580. Two warmups and seven samples/profile/run; measured p95, seed durations, exact fixture distributions and selected `EXPLAIN QUERY PLAN` output are recorded in `docs/implementation/R6_03_METRICS_QUERY_BENCHMARK_2026-09-22.md`.
- **Query-plan observation:** The filtered recent-call path uses `idx_tool_calls_category_created_at` on `category` and `created_at`, leaving `task_id` as a residual filter; failed-tools grouping uses a covering `idx_tool_calls_tool_status` scan plus temporary sort; recovery-duration aggregation scans 250/2,500 rows; failed execution count uses `idx_executions_status`. R6.04 must compare candidate indexes on equivalent disposable fixtures and quantify total Metrics and write impact before changing migration/schema.
- **Evidence:** Benchmark tasks `37a6d3ea-cfaf-4dc5-bc7a-d32cf6155218` and `e090edd2-e464-4eb3-a172-acb16454822c` PASS, both temporary SQLite `quick_check=ok` at both sizes. No production schema/index or live service was modified; no finding closed solely from benchmark observations. R6.04–R6.09 remain pending.

---

## R6.04 — Evidence-based Metrics index — VERIFIED 2026-09-22

- **Decision:** On the isolated feature branch, select migration 17's `idx_tool_calls_task_category_created_at` for task/category/time-filtered Metrics, based on a controlled read+write A/B. R6.04 code/fixture acceptance is separate from a future production workload decision and cutover; **G6 and release remain OPEN**.
- **Controlled non-destructive baseline:** `scripts/r6-index-ab-benchmark.mts` reads immutable committed HEAD migration-v16 source, initializes an entirely new marker-owned temporary SQLite file, seeds 250,000 tool-call rows plus 12,500 execution and 2,500 recovery rows, and times the real Metrics query adapter with an injected fixture DB port. It then applies only the pending real v17 migration on **the same fixture** and repeats timings and EXPLAIN; all three runs had identical before/after Metrics payloads, 250,000 rows intact after matched rollback-only write probes and SQLite `quick_check=ok`. The earlier untracked scratch `scripts/r6-index-evaluation.mts` creates the v17 index a second time, is not accepted for A/B and remains **excluded** from the checkpoint.
- **Observed three A/B runs, median at 250k rows:** filtered real Metrics 324.992→4.261 ms, 327.498→4.497 ms and 289.784→6.426 ms (**45–76x faster**). A true SQLite planner change constrains `task_id`, `category` and `created_at` rather than `category` and `created_at` alone. Other global and paged profiles vary in both directions; they have no consistently reproduced >20% regression in these three runs, but G6 must continue monitoring p95 and representative workloads.
- **Measured write cost, disclosed:** three matched 3,000-row rollback-only insertion medians rise **17.176→39.131 ms (+127.8%)**, **17.127→26.417 ms (+54.2%)** and **18.756→29.049 ms (+54.9%)**. The new index consumes another 3,304 fixture SQLite pages and takes roughly 383–386 ms to build at 250k rows. This is substantial **explained** write amplification, NOT a zero-cost or below-20% change. A future live workload/copy-rehearsal and explicit release-stage trade-off review are required; no live database has been migrated or index applied.
- **Detailed, reproducible report:** `docs/implementation/R6_04_METRICS_INDEX_AB_REPORT_2026-09-22.md`. Initial controlled A/B task `c653e133-bafc-412a-9465-502e40a08399` and two independent repeats in task `3a75ea93-4088-44ae-9879-2c844c2f4fdc` PASS.
- **Regression fixtures:** `tests/core/r6-metrics-index.test.ts` covers v16→v17 on a disposable historical schema, row preservation, a single version-17 migration record and matching EXPLAIN plan/index columns; existing migration-history tests now expect version 17. Source/test TypeScript + 3 fixture files/10 tests already PASS in task `b12742d0-1a5c-4252-8e6d-45785368d980`. Final full acceptance task `4625b9ef-9534-41ff-8a8b-9a6a2641137e` PASS on the exact R6.04 candidate: source/test TypeScript PASS; full Vitest **158 files / 700 PASS + 4 expected later-phase failures / 0 unexpected failures**; production build PASS; strict G1 **188 source files / 0 verified violations** PASS; tracked `git diff --check` PASS.
- **Finding:** MED-17 (previously under-indexed/unbenchmarked Metrics) VERIFIED_CLOSED with R6.03 representative sizes, R6.04 actual adapter A/B, query-plan and migration regression evidence. Matrix count now 26/54 VERIFIED_CLOSED (HIGH 10, MEDIUM 15, LOW 1); 24 OPEN and 4 TEST_ENCODED. Other R6 findings retain their status.
- **Isolation and phase boundary:** No live database migration, restart, change to real OAuth credentials, user project/backup mutation, Git reset, merge, push or deployment. R6.05 aggregate search budgets is the next planned leaf; R6.05–R6.09/G6 remain OPEN.

---

## R6.05 — Aggregate search budgets — IMPLEMENTED; test-project compiler acceptance pending 2026-09-22

- **Implementation:** `src/services/filesystem/search-budget.ts` defines immutable process-wide caps (10,000 files; 16 MiB cumulative reserved/read bytes; 1,000 results; 10,000 ms monotonic elapsed time; 4 concurrent searches), a per-search aggregate meter and a shared semaphore-like concurrency limiter. `src/services/filesystem/filesystem-service.ts` now applies the limiter at the inbound service boundary; recursive search uses the same meter for every visited directory/file, reserves reported file size before reading, reconciles actual UTF-8 content bytes, checks the elapsed time during traversal and stops at the result cap. The existing sensitive-path checks remain ahead of reads, and results still use workspace-relative paths.
- **Focused evidence:** `tests/core/r6-search-aggregate-safety.test.ts` verifies aggregate file/byte/result/time counters, invalid policy rejection, concurrency over-capacity rejection and permit recovery after success/failure, and an actual workspace search truncated at 1,000 results without exposing absolute paths. Focused task `c78417e1-a737-49d1-911f-cb14a268bcac`: 1 file / 3 PASS. Existing search/security task `87dc39c6-8d0a-480b-81cd-92e96eb30452`: source + test TypeScript PASS before the new R6.05 fixture was added; 3 files / 19 PASS + 1 expected later-phase failure.
- **Broader evidence:** Full fixture-based regression task `67d8f815-851b-4c04-a161-f8ae24d7003e` PASS: 159 files / 703 PASS + 4 expected later-phase failures / 0 unexpected failures. Production build task `6d0aec82-c446-47d1-8a2e-90511326b1ef` PASS; strict G1 task `c89e045a-6fec-4e56-a4ce-3162465b5f45` PASS (189 source files, zero violations).
- **Explicit open acceptance item:** Repeatable attempts to run `pnpm run typecheck`, the test-only `tsc -p tsconfig.test.json --noEmit`, and a read-only TypeScript API compilation after the new test file was added failed at the HooshiX `execute_command` boundary with `tool_handler_failure`, without any TypeScript compiler stdout/stderr or diagnostic. This is **not** evidence of a TypeScript compilation failure or success. Do not represent R6.05 or G6 as fully VERIFIED until the complete test-project compiler check is independently successful. The code/test checkpoint may be committed without closing that gate.
- **Finding status:** MED-03 remains OPEN because it also covers broader HTTP/expensive-operation concurrency and cross-transport acceptance, not only file-search concurrency. No other finding is closed solely by this leaf.
- **Scope:** Neither the live SQLite database nor the running MCP server was restarted or modified; unrelated EAAP materials, backups and R5 recovery scripts remain unmodified/untracked. G6 remains OPEN; R6.06–R6.09 and the outstanding R6.05 test-only compiler acceptance must be resolved before final G6 closure.

---

## R6.06 — Session metrics lifecycle — focused/full tests PASS 2026-09-22

- **Implementation:** `src/mcp/metrics.ts` now keeps session details only for currently active session IDs. On close, it removes the session record immediately rather than retaining up to 512 completed objects. Lifetime session count and peak concurrent count are separate monotonic aggregates; closing an unknown or already-closed ID has no effect. Duplicate creation of an already-active ID does not inflate the lifetime count or overwrite client details. Recent tool-call history retains its existing separate bounded limit and is not changed by this leaf.
- **Churn evidence:** `tests/core/r6-session-metrics-pruning.test.ts` creates and closes 10,000 unique sessions with two continuously active sessions, asserts exactly two retained IDs throughout the churn, verifies duplicate close/creation and unchanged live counts, then closes both remaining sessions and verifies an empty map with 10,002 total and a peak of three. Focused test task `08b0c727-b979-40ed-9f25-c2aa3cd3cbaf`: 2 files / 2 PASS including the earlier R5 bounded-state fixture.
- **Regression evidence:** Full-suite task `3b389074-7a90-41c3-8edf-d8a19753b64b`: 160 test files / 704 PASS + 4 expected later-phase failures; zero unexpected failures. Production source TypeScript PASS via task `4d551308-4024-4975-952a-4cfe576647b1`; build and strict G1 PASS via task `04a43bf1-df6f-4464-83fc-a5bb67ff751c` (189 scanned files, zero candidates).
- **Open acceptance boundary:** The full test-project TypeScript compiler step in `4d551308-4024-4975-952a-4cfe576647b1` returned `tool_handler_failure` with no compiler diagnostic. It is not represented as passing or failing TypeScript. R6.05 and final G6 compiler acceptance remain OPEN. The code/test checkpoint does not imply live-service cutover or product release readiness.
- **Finding closure:** MED-19 (session metrics accumulation) VERIFIED_CLOSED based on 10,000 churn record retention and active/lifetime aggregate assertions; matrix now 27/54 closed (HIGH 10, MEDIUM 16, LOW 1), 23 OPEN, 4 TEST_ENCODED.
- **Isolation:** Only source, dedicated test, finding status and ledger are in scope. The running server, actual SQLite, session credentials, EAAP materials and other assistant's untracked backups/recovery scripts were not modified or restarted. Next planned leaf R6.07 hot-path schema introspection, followed by R6.08–R6.09; G6 remains OPEN.

---

## R6.07 — Hot-path schema introspection — VERIFIED 2026-09-22

- **Decision:** The current `withAgentDatabase` connection wrapper already applies versioned migrations at most once after cold database initialization, and the SQLite adapter issues `journal_mode`, `foreign_keys`, and `busy_timeout` PRAGMAs only when creating a new connection. The only source `PRAGMA table_info` is in `core/memory/database/migrations.ts` under `ensureColumn`, called from versioned migrations. No additional runtime schema DDL or code change was necessary for R6.07.
- **Persistent regression:** `tests/core/r6-no-hot-path-schema-pragmas.test.ts` warms up the dedicated fixture SQLite connection, spies on both `prepare` and `pragma`, then runs 500 repeated business reads through the real `withAgentDatabase` path. It proves every prepared statement is the requested business SELECT, the connection is unchanged, and zero schema PRAGMAs or migration statements are executed on the hot path. Focused task `cac94660-61a2-41b8-9382-0990e043e3e3`: three files / 14 PASS, including database lifecycle and migration-only fixtures.
- **Full acceptance:** Task `bddd84a3-e90c-49dd-a838-250e9e7ed352`: 161 Vitest files / 705 PASS + 4 expected later-phase failures, 0 unexpected failures. Source TypeScript, production build and strict global G1 (189 source files, 0 candidates) PASS in task `ee1bbb13-2604-4ce9-8997-45a87fe9f525`.
- **Outstanding phase-wide evidence:** The full test-project TypeScript compiler remains UNVERIFIED due the previous HooshiX command-tool failures; this test-only checkpoint does not mark that phase gate passed. G6 stays OPEN pending full test-project compiler acceptance and final gate reconciliation; R6.08 and R6.09 have since been committed separately. No live database, service restart, OAuth registration, user backups, EAAP materials or unrelated diagnostic scripts were touched.
- **R6.07 finding closure:** MED-20 VERIFIED_CLOSED after the 500-operation hot-path spy regression plus migration/startup-only schema inspection. The outcome concerns normal repeated database operations; the wider G6 performance trade-off and complete TypeScript test-project acceptance are separate and remain OPEN.

---

## R6 phase reconciliation — isolated branch checkpoint, 2026-09-22

- **Later scoped commits already present before this record:** `7cbd390` R6.06 session metrics lifecycle, `b2a48f2` R6.08 Prometheus exposition and lifetime counters, and `866bf9b` R6.09 audit redaction plus telemetry degradation. These are retained as separate commits; this checkpoint only records R6.07 test/evidence and MED-20 closure.
- **Latest complete-suite evidence:** R6.09 task `c720bed4-9774-4974-b395-b2a1162871a0`: 163 Vitest files / 711 PASS + 3 expected later-phase failures, zero unexpected failures. R6.09 source TypeScript, build and strict G1 passed in their existing independent tasks. The 500-operation R6.07 regression was included as its own passing test file.
- **G6 is NOT closed:** The full `tsconfig.test.json` TypeScript compiler check still returns HooshiX executor `tool_handler_failure` without compiler diagnostics (most recent attempted task `011fa2c2-47de-4b96-a4a8-6a42531f17ff`). A small `tsc --version` check passed (7.0.2), so the executable exists, but this does not prove full test-project type correctness. Before G6 PASS, obtain an actual successful full test-project compiler run, reconcile the R6.04 measured 54–128% fixture write amplification with the G6 material-regression criterion, and rerun the gate on the final exact commit.
- **Matrix after MED-02 and MED-20 closures:** 29/54 VERIFIED_CLOSED (HIGH 10, MEDIUM 18, LOW 1), 22 OPEN, 3 TEST_ENCODED. No runtime server restart, live SQLite update, OAuth client modification, push/merge, or unrelated EAAP/backups/recovery artifact cleanup was performed in this checkpoint.

---

## G6 final compiler and regression evidence — 2026-09-22

- Full source and test TypeScript compilation passed in task `0e6308a3-37a7-4064-a1ac-c156bbdc0c1d`. The former executor failure is no longer a TypeScript acceptance blocker.
- Final full regression task `1c2cbb91-0241-4a4b-9cfc-abe4b546f7ef` passed: 163 test files, 711 passing tests and 3 expected later-phase failures. Earlier task `b3ffa227-c0f5-48dc-ba09-fe9a5c23b843` recorded a passing production build and strict architecture gate (189 source files, zero violations) on the same candidate.
- Performance acceptance remains OPEN: the version-17 index improves task-filtered metrics queries 45–76 times but adds 54–128% overhead to synthetic 3,000-row insertion batches. The measured write cost is disclosed, not dismissed; live-workload compatibility and deployment are not approved. G6 must not be closed solely because TypeScript and tests pass.
- The current unstaged source change is limited to the search-budget type definition. Unrelated EAAP, runtime backups and diagnostic files remain excluded from any checkpoint.

---

## R0–R6 audit discrepancy remediation — 2026-09-22

- **Authoritative detail:** `docs/implementation/R0_R6_AUDIT_RECONCILIATION_2026-09-22.md` records verified evidence, original contradictions, code and test fixes, the remaining R6.04 performance risk and the explicit release boundary. Earlier dated notes above are history; the phase-status table and Current task block contain the current verdict.
- **MED-05 actual code gap corrected:** The legacy `filesystem-service.ts` file-audit sink could overwrite a successful mutation's outcome or mask the original business error. Async telemetry persistence is now best-effort, with a fixed degraded-observability counter/diagnostic. The old `it.fails` is now an ordinary passing success-after-audit-error test and a second normal regression preserves the original business failure and file bytes if failure auditing also rejects. MED-05 was already recorded CLOSED; do not count it a second time.
- **HIGH-13 obsolete test fixed:** The R0 expected-RED fixture checked nonexistent `task_execution_leases` without base schema. It now applies v0+versioned migrations and asserts the actual v12 `task_leases` table as an ordinary passing test. The independent real two-OS-process production lease/fencing fixture also passed (task `97119ea3-382a-47c3-9c9e-0fb132b11488`); HIGH-13 remains closed, with no double count.
- **MED-25 finding matrix corrected:** R6.08's existing golden grammar/parser contract and HELP/TYPE/lifetime-counter tests passed again (task `afbef316-bd0f-4639-b160-76823f7ba939`, 4/4 and TypeScript PASS). MED-25 is VERIFIED_CLOSED based on the always-executed local parser contract; external `promtool` execution is optional and is not claimed. Matrix totals are now 30/54 closed (HIGH 10, MEDIUM 19, LOW 1), 21 OPEN and 3 TEST_ENCODED.
- **Stale phase evidence reconciled:** R6.07 is present in HEAD `412ca3e` and the former test-project TypeScript executor error was resolved by the successful full source/test compiler task `0e6308a3-37a7-4064-a1ac-c156bbdc0c1d`. The R6 table and Current task summary no longer claim otherwise. The `SearchBudgetLimits` type-widening correction is retained rather than discarded.
- **Verification after source/test corrections:** Scoped R0/R3 suite task `69a9b49d-d0b0-43ba-960f-86acb1e9bbc6`: 7/7 PASS; additional MED-05 error-preservation test task `b4b8cd85-822d-4bbe-b741-527b183cb6f8`: 2/2 PASS; independent real R3 two-process lease task `97119ea3-382a-47c3-9c9e-0fb132b11488`: PASS. Full audit task `055c74e0-53b1-4008-bfd7-38d45527b140`: source/test TypeScript PASS and **163 files / 714 PASS + 1 expected R7 HIGH-10 failure / 0 unexpected failures**. Subsequent task `b972b734-12f6-436f-aef5-c5b61c677a8b` completed production build PASS and strict G1 (189 files, zero violations) PASS; the final `git diff --check` executor step returned `tool_handler_failure` and is NOT claimed successful.
- **Gate boundary remains unchanged:** G0–G5 historical phase-gate claims retain their prior evidence, now reinforced for MED-05/HIGH-13. G6 remains OPEN due the independently measured R6.04 +54–128% synthetic write overhead versus 45–76x filtered-query speedup, pending an explicit, justified workload-level acceptance or code-level alternative. One intentionally failing HIGH-10 Docker frozen-lockfile regression remains in R7; R7–R10 and release-readiness are NOT PASSED. No live DB migration, service restart, OAuth registration/secret change, push or merge was authorized or performed by this reconciliation.

---

## G6 continuation — pinned historical benchmark replay and deferred audit register — 2026-09-23

- **Scope:** existing R6 only; no new stage or alteration of the approved R6.01–R6.09 sequence. Starting HEAD `2dd4837`; workspace `D:/workspace/hooshix-agent`. Authoritative 54-finding matrix unchanged. All previously reported current audit issues are recorded for later execution in `POST_R6_AUDIT_FINDINGS_SNAPSHOT_2026-09-23.md` without advancing R7–R10.
- **Reproducibility repair:** `scripts/r6-index-ab-benchmark.mts` formerly used `git show HEAD` for its v16 control, so it cannot replay correctly after the v17 index commit. It now uses pinned R6.03 commit `ad96009` and retains the strict v16/no-candidate-index guard. Only the marker-owned 250k temporary fixture is migrated by the current v17 code. App DB, operational service, backups, untracked EAAP/R5 diagnostic files remain untouched.
- **Verification:** HooshiX Task `608d498c-3717-4e42-b503-2dd719b3798b` COMPLETED: historical v16/current v17 actual-adapter A/B replay PASS (250,000 fixture rows, identical normalized result, `quick_check=ok`, selected query-plan index verified); source/test TypeScript PASS; complete Vitest 163 files/714 PASS plus 1 expected R7 HIGH-10 RED/0 unexpected failures; production build PASS; strict G1 189 source files/0 verified violations PASS.
- **Current A/B observation:** filtered Metrics median 272.047 ms (v16) vs 4.530 ms (v17), ~60x improvement. Global median 165.525 vs 175.337 ms; offset-1000 median 170.762 vs 148.871 ms. The 3x3,000-row write samples in this repeat are very noisy: before median 35.079 ms, after 28.716 ms; this isolated apparent improvement does not negate three earlier controlled repeats showing +54.2%, +54.9% and +127.8% write overhead. See `R6_G6_WORKLOAD_EVIDENCE_2026-09-23.md` and original R6.04 report for measured limitations.
- **Gate verdict:** **G6 REMAINS OPEN** for the documented >20% v17 synthetic write-cost trade-off, with no accepted representative live operating workload or owner-approved material-regression disposition. Functional/type/build/architecture evidence does not grant deployment/release approval. Do not move to R7 merely to avoid this gate. No production data mutation, service restart, Git reset, merge, push or release occurred during this continuation.

### G6 follow-up — actual local throughput observation and two paired A/B repeats (2026-09-23)

- Pinned v16/current v17 temporary-fixture repeat Task `3d075107-05b8-40ae-ac35-cffb65f37dff`: two PASS, 250k rows each, real Metrics adapter, identical normalized payloads, `quick_check=ok` and task/category/time index plan. Filtered query improved ~47.6x/~55.6x; v17 3,000-row insert medians regressed +40.7%/+34.9%. Together with original +54.2%/+54.9%/+127.8% and one noisy inverse follow-up run, 5/6 matched samples show a >20% write penalty. See `R6_G6_WORKLOAD_EVIDENCE_2026-09-23.md` for sample data and limitations.
- Read-only existing `agent_metrics` observation: three preceding UTC days contained 4,149 / 1,782 / 2,118 tool-call records, respectively; maximum in the last complete day was 58 calls/minute and five calls in one timestamp second. This is historical local/development traffic, **not** an accepted future public workload or per-autocommit latency measurement.
- **G6 IN_PROGRESS, NOT PASS:** all R6 functional/compiler/build/G1 gates remain verified, but existing scope's real v17 query/write acceptance still needs an owner-backed operating envelope/explicit risk decision. No change to candidate index, matrix finding statuses or stage count. Do not start R7 on this evidence alone.

### G6 owner acceptance and phase closure — 2026-09-23

- Owner decision: **Option 1 accepted** — retain migration v17 index `(task_id, category, created_at DESC)` and accept its measured write-maintenance cost in exchange for the verified filtered Metrics query improvement.
- Residual risk is explicit, not erased: 5/6 paired write medians showed >20% synthetic regression; global/paged timing is noisy; observed local traffic is not a future production SLO. G10 migration rehearsal and later deployment/release gates remain mandatory.
- **R6 GATE_PASSED / G6 PASS on isolated feature branch.** R6.01–R6.09 are complete under the existing Definition of Done because the material local regression is now explained, measured, documented and explicitly accepted by the owner.
- No live DB migration, service restart, deployment, merge, push or release was performed by this acceptance. **Next planned phase: R7 Config / Deployment / CI.**

### R7.04 checkpoint — HIGH-10 implementation started (2026-09-23)

- Scope stayed inside existing R7.04. Docker builder install is now exactly `pnpm install --frozen-lockfile`; production install is exactly `pnpm install --prod --frozen-lockfile`. The permissive `|| pnpm install` fallback was removed from both stages.
- Existing R0 HIGH-10 contract was promoted from `it.fails(...)` to an ordinary permanent regression. Focused result: `tests/core/r0-known-defects.test.ts` **5/5 PASS**. Production TypeScript build PASS. Task: `21d0968c-6513-408c-b6a5-f025011f3497`.
- Matrix state is **IMPLEMENTED**, not yet VERIFIED_CLOSED: the R7 acceptance contract also requires a real frozen-install/container failure proof. That proof and the remaining R7.01–R7.10 work are still pending. No Docker daemon result, clean-checkout CI, deployment, push or merge is claimed.



### G6 experimental index alternatives — isolated fixtures only (2026-09-23)

- Benchmarked the ACTUAL Metrics query adapter with deterministic 250k-row temporary fixtures, historical v16 and committed v17, against two **hypothetical, fixture-only** partial index variants to test if the documented v17 batch-write overhead can be avoided. Script `scripts/r6-partial-index-ab-benchmark.mts`; full methodology, cautions and all three four-way results in `R6_G6_INDEX_ALTERNATIVES_2026-09-23.md`.
- Hypothetical variants: `(task_id,category,created_at DESC) WHERE task_id IS NOT NULL` and slimmer `(task_id,created_at DESC) WHERE task_id IS NOT NULL`. The fixture approximates 60% NULL task IDs from the observed local tool-call mix but is correlated with its synthetic category distribution; **not** a representative future deployment.
- Four-way benchmark Task `05a2c0a5-cd3b-465b-bcec-e046598ac34a` PASS; independent repeats Task `fca0d383-14ab-4899-ae3a-caa4e28df3e9` 2/2 PASS. All phases preserve normalized actual Metrics result equality and SQLite integrity; expected index is selected by the task-scoped query plan. Read median ~2–3 ms for both alternatives; smaller-index whole-fixture allocated page counts 17,985/17,768 vs full-index 19,623.
- Original v16 vs full-v17 batch insert medians regressed +58.6%, +41.7%, +23.8% across the three fixtures. Same-column partial regressed +49.8%, +18.5%, +92.0%; slimmer partial +32.2%, +12.9%, +14.3%. The narrower variant helps in two short matched runs, but still exceeds +20% in one, with likely cache/order noise and unknown future workload. Thus **none is demonstrated to satisfy G6**. Previous five-of-six evidence for the existing v17 full index remains valid.
- **No application index change, added production migration or deployment** was made. G6 remains IN_PROGRESS/OPEN, R7–R10 NOT_STARTED. Original authoritative finding matrix unchanged; unrelated EAAP, backups, R5 and R6 scratch files left intact.

### Latest checkpoint — R7 config/deployment/CI continuation (2026-09-23)

The earlier G6 OPEN entries above are historical observations superseded by the owner's recorded G6 PASS decision. **R7 IN_PROGRESS, G7 OPEN**; R8–R10 NOT_STARTED. R7.01–R7.10 have preliminary implementation across typed HTTP config/legacy migration, non-root Docker/Compose, authenticated-edge separation, liveness, Windows bootstrap, operations and a SHA-pinned CI workflow, but the complete Gate is NOT met. The real container/clean-checkout CI run, full typed config cutover, approved image digest, service-like version proof, full-suite/coverage and dependency-audit evidence remain outstanding. Focused R7 tests 13 PASS, TypeScript PASS, build PASS, G1 190/0 PASS, git diff --check PASS, active secret scan 8 files/475 tracked paths PASS. Full Vitest executor attempts ended `maxConsecutiveFailures_budget_exhausted` without test results; not counted as a PASS or code failure. See `R7_PROGRESS_2026-09-23.md` and `R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md`. No live DB/service, unrelated EAAP/backups/scratch, push or merge modified.

### R7 verification follow-up — 2026-09-23

- New focused static/config/security contracts: 16/16 PASS. Source/test TypeScript PASS; production build PASS (task `81a6fd57-436d-4ecd-aff9-e56611017009`). G1 strict: 190 files, zero candidates PASS (task `84f9b665-495d-41f2-993d-8bfd7123c878`).
- Full default-parallel Vitest: 363 PASS / 363 FAIL in 165 files; must not be ignored. Full serial Vitest (`--maxWorkers=1 --no-file-parallelism`) independently PASS: **165 files / 726 tests** (task `4227ce9e-b115-4c57-85f2-dc181f778c3b`). Isolated retest of a default-parallel failure also PASS 2/2. CI workflow explicitly uses serial tests; R8.06 retains the parallel-isolation requirement.
- Docker build context now includes `pnpm-workspace.yaml` for identical install-script policy. Canonical Compose, watchdog and startup environment examples updated. A Docker probe through the available command tool was disallowed by its allowlist; no Docker build/container evidence is claimed.
- **R7 IN_PROGRESS / G7 OPEN**: full typed config cutover, reviewed base-image digest, actual frozen-container/health/non-root smoke, clean-checkout CI, coverage/advisory evidence and final runbook validation still pending. No R8 start or public release authorization.
- Local serial coverage completed separately: 165 files / 726 tests PASS, exit 0; aggregate statements 86.19%, branches 80.02%, functions 86.08%, lines 90.34% (task `b61e4daa-413a-4530-9443-9b6bd5baacdb` step 1). This satisfies current aggregate thresholds, not future R8 critical per-file thresholds. Production pnpm audit step returned `tool_handler_failure` and has **no verified advisory verdict**.
- Added a disposable stale-manifest Docker negative-build contract to the SHA-pinned CI workflow; static contract focused test 7/7 PASS (task `67ea890c-2b02-4d27-9aed-611a85ff9738`). No real Docker or clean-checkout CI was performed. Remaining G7 blockers are the full typed config cutover, real image/user/live/ready/negative-build smoke, reviewed immutable base digest, service-like version proof, CI/advisory outcome and final runbook consistency.

### R7.01/R7.02 unified typed config cutover — 2026-09-23

- **Status:** R7.01 and R7.02 implemented and locally VERIFIED as bounded leaves; overall R7 remains IN_PROGRESS / G7 OPEN. No finding is marked VERIFIED_CLOSED by this record and no deployment is implied.
- **R7.01 single authoritative source:** `src/infrastructure/config/app-config.ts` now defines the complete immutable contract and is the only place any setting is parsed. Sections: `runtime` (stdio|http), `environment`, `http`, `bootstrapToken`/`bootstrapTokenFile`, `databasePath`, `logDirectory`, `permissionLevel`, `workspace`, `directApprovalBypass`, `retentionDays`, `terminationGraceMs`, plus new `oauth`, `rateLimit`, `session`, `lease` and `search` groups. `loadAppConfig()` returns a deeply frozen object; every numeric value is validated and contradictory pairs fail loudly (OAuth access TTL must be shorter than refresh TTL and longer than code TTL; session idle shorter than absolute and grace shorter than idle; lease heartbeat under half the lease TTL and TTL within `[min,max]`). Previously hardcoded budgets (OAuth TTLs/caps, three HTTP window limiters, session idle/absolute/grace/caps, per-principal concurrency, lease TTL/heartbeat, search budgets) are now injected from the contract and default to the exact previously shipped values, so behavior is unchanged unless an operator overrides it.
- **No parallel config paths:** `legacy-http-server.ts`, `legacy-runtime-paths.ts`, `legacy-workspace-bootstrap.ts`, `permission-config.ts`, `legacy-retention.ts`, `direct-approval-config.ts` and `r3-termination-grace-config.ts` are now thin compatibility projections of the same parsers — zero duplicated parsing logic. Entrypoints (`src/index.ts`, `src/index-http.ts`) load the contract once and pass their runtime mode; `src/mcp/http-server.ts` no longer reads environment variables at all (it calls `loadAppConfig(undefined,undefined,"http")`, keeping the R1 contract that no `process.env` appears outside `infrastructure/config/`).
- **R7.02 retired-name policy:** `MCP_API_KEY` / `MCP_ACCESS_TOKEN` remain hard startup errors. The HTTP aliases (`MCP_PORT`, `MCP_BIND_HOST`, `MCP_PUBLIC_BASE_URL`, `MCP_ALLOWED_ORIGINS`) still resolve for the documented migration window, but setting an alias together with its canonical `HOOSHIX_*` name with DIFFERENT values now fails at startup with `conflicting environment names`. A repository-wide tracked-content scan confirms no first-party artifact (Dockerfile, Compose, watchdog, `start_nodejs_mcp.bat`, CI, runbook) uses a retired name; remaining occurrences are the compatibility reader, rejection/alias tests, and historical spec text.
- **Tests:** `tests/core/r7-unified-config.test.ts` (34 tests) covers every default against the previously shipped values, immutability of all nested sections, invalid values, contradictory values, incomplete security settings (external bind without HTTPS public base, credential/path in public base, malformed origins), alias conflict/equality, runtime-mode validation and the single-source property of the compatibility readers. `tests/core/r7-deployment-security.test.ts` gained an R7.06 digest-pinning regression.
- **Validation:** `pnpm exec tsc -p tsconfig.r1.json` PASS; `tsc -p tsconfig.test.json --noEmit` PASS; `tsc -p tsconfig.json` (build) PASS; `node scripts/verify-g1-global.mjs --strict` PASS (190 files / 0 candidates); full serial Vitest `--maxWorkers=1 --no-file-parallelism` **167 files / 768 tests PASS** (baseline was 165/726; the delta is the two new R7 test files); `git diff --check` exit 0 (LF/CRLF normalization warnings only); `node scripts/r7-secret-policy-check.mjs` PASS (8 active deployment files / 482 tracked paths).
- **Scope and residuals:** config wiring reached the entrypoints, HTTP transport, OAuth provider and HTTP-security constructors. The persisted OAuth client-registration cap (256) is represented in the contract and enforced by the adapter with the matching default. Default parallel Vitest still fails (363/726 previously) and remains owned by R8.06. No live service restart, database migration, push, merge or deployment.

### R7.06 base-image digest pinning — 2026-09-23

- Both Dockerfile stages now pin `node:24.18.0-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`, matching `.nvmrc` (24.18.0) and the CI `setup-node` version exactly.
- Digest provenance: queried the public Docker Hub registry API for the `24.18.0-slim` tag on 2026-09-23 (active multi-arch OCI index). Exact reference, rationale and the controlled base-image update procedure are recorded in `docs/implementation/R7_DEPLOYMENT_PINNING_2026-09-23.md`; the runbook was updated to replace the former "unpinned major tag" note.
- **Honest boundary:** digest existence/activeness was verified via the registry API, but an actual image build was NOT executed — this host has the Docker CLI yet the daemon is unreachable (`permission denied while trying to connect to the docker API`), the same limitation recorded earlier. Node/pnpm/native (`better-sqlite3`) compatibility inside the pinned image and the container build/smoke re-run remain pending a Docker-capable target; the `container-smoke` CI job owns that proof. R7.06 is therefore IMPLEMENTED, not VERIFIED_CLOSED.

### R7.08 runtime toolchain gate — 2026-09-23

- Added `scripts/verify-runtime-versions.mjs`: a machine-independent preflight that reads the toolchain pins from `.nvmrc` and `package.json` `packageManager` and exits non-zero with an actionable message when the Node major line is wrong, the exact Node line drifts, pnpm is missing from PATH, or the pnpm version mismatches. It resolves pnpm from PATH exactly as the service scripts do.
- Wired as a `Runtime toolchain gate` step in the CI workflow and documented in the runbook. The existing Windows watchdog and `start_nodejs_mcp.bat` inline checks are unchanged (their contents are pinned by existing contracts).
- **Tests:** `tests/core/r7-runtime-version-gate.test.ts` (7 tests) executes the REAL script via documented test hooks and proves the happy path plus every failure mode: wrong Node major, drifted Node patch, missing pnpm, wrong pnpm, unparseable Node version, and the `.nvmrc`/`packageManager` pin agreement. This converts "startup must fail on version mismatch" and "missing pnpm must fail" from prose into repeatable executed evidence.
- Validation included in the full-suite result above (167 files / 768 tests PASS).

### R7.10 dependency advisory — real verdict obtained — 2026-09-23

- The previously unresolved `pnpm audit` now has a real result. The locally configured registry mirror (`package-mirror.liara.ir`) returns HTTP 409 for the audit API, which is an environment/tooling limitation, not a code defect and not an advisory verdict.
- A read-only query against the direct registry — `pnpm audit --prod --audit-level=high --registry=https://registry.npmjs.org` — returned **`No known vulnerabilities found`, exit 0** on 2026-09-23 for the production dependency set (`@modelcontextprotocol/{node,sdk,server}`, `better-sqlite3`, `execa`, `zod`). CI runs on GitHub-hosted runners whose default registry is `registry.npmjs.org`, so the workflow step is expected to resolve there. This is a point-in-time advisory snapshot, not a permanent guarantee.
- Serial coverage on the final R7 changeset (`pnpm run test:coverage --maxWorkers=1 --no-file-parallelism`): **167 files / 768 tests PASS, exit 0**; aggregate statements **86.45%**, branches **80.49%**, functions **86.23%**, lines **90.54%** (prior recorded aggregate was 86.19/80.02/86.08/90.34 at 165/726). This satisfies the repository's current aggregate thresholds; R8 still requires separately agreed critical per-file/branch coverage and must not be pre-empted by this aggregate number.

### R8.06 — parallel isolation root cause found and fixed — 2026-09-23

- **Status:** R8 STARTED (R8.06 only). The headline G8 blocker — the whole-suite parallel failure — is resolved with a structural fix, not a retry or a suppressed test. R8.01–R8.05 and R8.07+ remain NOT_STARTED.
- **Root cause (proven, not assumed):** the shared `beforeEach` in `tests/setup/database-cleanup.ts` deleted `data/test-agent-memory.db`, `data/test-logs` and `data/test-agent-memory.json`, but `vitest.config.ts` pinned those same paths for EVERY worker. Under parallel execution one worker's `beforeEach` therefore deleted another worker's OPEN SQLite database. Reproduced minimally with just two files (`filesystem-service` + `workspace-isolation`, `--maxWorkers=2`): the error was `EPERM, Permission denied ... data/test-agent-memory.db` from `rmSyncWithRetry` (Windows refuses to delete an open file; on POSIX the deletion orphans the connection). A second, independent collision existed: five test files shared one fixed `tests/runtime-files` scratch tree and recursively deleted it, so one worker removed another worker's in-flight fixtures (the remaining e2e trace failure).
- **Fix:** each parallel worker now owns an isolated tree keyed on `VITEST_WORKER_ID`. The setup file sets `HOOSHIX_DB_PATH` / `HOOSHIX_LOG_DIR` / `HOOSHIX_MEMORY_FILE` to `data/test-agent-memory-<worker>` / `data/test-logs-<worker>` / `data/test-agent-memory-<worker>.json`, and `vitest.config.ts` no longer injects a single shared database path. A new `tests/helpers/runtime-files.ts` exports a worker-scoped `RUNTIME_FILES_ROOT` (always forward-slash) that replaces the fixed `tests/runtime-files` literal in the five consumers. `maxWorkers: 1` was removed from the config so the DEFAULT local run exercises parallelism; CI keeps its explicit serial flags, which still override. Nothing was retried, hidden or deleted.
- **Evidence of stability (the plan requires repeated parallel runs):** the full DEFAULT parallel suite passed **four consecutive times** — 167 files / 768 tests each, exit 0 (~16–31 s) — and after adding the regression guard, **168 files / 771 tests**, exit 0. The serial suite (the CI mode) also still passes: 167/768, exit 0. Earlier, `--maxWorkers=4` on the pre-fix tree produced **564 failures**; the two-file repro produced 10 failures; both are now green.
- **Regression guard:** `tests/core/r8-parallel-isolation.test.ts` (3 tests) asserts the setup derives the three persisted paths from `VITEST_WORKER_ID`, that `vitest.config.ts` no longer injects a shared `HOOSHIX_DB_PATH`, that `RUNTIME_FILES_ROOT` is worker-scoped, and that no test file reintroduces a fixed `tests/runtime-files` literal.
- **Validation:** parallel 168/771 PASS; serial 167/768 PASS; `tsc -p tsconfig.test.json` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (190/0); serial coverage exit 0 (86.45/80.49/86.23/90.54); `git diff --check` exit 0.
- **Boundary and residuals:** this makes parallel execution reliable on this host; it does NOT certify the GitHub clean-checkout CI run (still no runner access), and the decision to flip CI from explicit serial to parallel is deliberately left to a separate change so it can be verified from a clean checkout. R8's remaining items — permanent HIGH-finding regression coverage accounting, real E2E assertions, critical per-file/branch coverage thresholds, property/fuzz tests, seeds, crash/timeout/failure injection — are still NOT_STARTED. No finding is closed by this record.



