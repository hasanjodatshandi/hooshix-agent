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
  | R7 Config/deployment/CI | IN_PROGRESS | G7 OPEN — R7.01/02/03/06/08/09/10 done and locally verified; R7.04/R7.05/R7.07 real container build/non-root/live-ready smoke and clean-checkout CI blocked by environment (Docker daemon unreachable, no GitHub runner), R7.10 blocked-list recorded honestly | 2026-09-23 | | 170 files / 777 tests PASS serially; coverage 86.45/80.49/86.23/90.54; audit clean; G1 190/0 |
  | R8 Verification/parallel/fuzz | COMPLETE (leaves) | R8.01–R8.08 all done; G8 NOT declared PASS — hosted clean-checkout CI evidence unavailable locally (3 consecutive local parallel runs green instead) | 2026-09-24 | | 180 files / 808 tests PASS serially + parallel ×3 |
| R9 Legacy deletion/docs/cutover | IN_PROGRESS | R9.01–R9.04 done (SQL moved into the SQLite adapter, 10 dead modules deleted, unrestricted mode proven unreachable, compat shims pinned as pure aliases, README completeness gap closed and enforced); remaining: deferred facade retirement | 2026-09-24 | | 178 files / 801 tests PASS serially |
| R10 Final release validation | IN_PROGRESS | R10.01 done (migration/restore drill executed PASS against a real DB copy; stale hardcoded schema-version assertion found and fixed; release-readiness test added). Preflight NO_GO on DIRTY_WORKTREE + owner-only manual gates; Docker/CI parts remain environment-blocked | 2026-09-24 | | 179 files / 804 tests PASS serially |

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
Current phase: R7 IN_PROGRESS (G7 OPEN). This session completed and locally verified: R7.01 complete immutable typed config cutover with single-parse-path compatibility readers; R7.02 retired-name conflict detection and first-party artifact canonical-name consistency; R7.03 bootstrap secret hardening with executed lifecycle/rotation tests and a documented rotation procedure; R7.06 digest-pinned base image with provenance and update procedure; R7.08 tested runtime toolchain gate; R7.09 consolidated operations runbook (reference startup paths, outcome_unknown recovery, auth troubleshooting, backup/restore, public deployment boundary); R7.10 real dependency advisory verdict, README/tool-catalog contract test and full serial coverage. G7 is NOT passed: R7.04/R7.05/R7.07 real frozen-image negative build, non-root container runtime and live/ready health smoke and the clean-checkout CI run are blocked by environment (Docker daemon unreachable on this host; no GitHub Actions runner access), and the POSIX secret-permission proof needs a POSIX host. The blocked list is recorded with named pending evidence; HIGH-10/11/12 are not claimed VERIFIED_CLOSED. R9 IN_PROGRESS (R9.01–R9.04 done: SQL removed from the HTTP readiness probe into the SQLite adapter, 10 dead modules deleted, unrestricted mode proven unreachable from production paths by executable test, compat shims pinned as pure aliases with their retirement deferred for a recorded reason, README completeness gap closed and permanently enforced). R10 IN_PROGRESS (R10.01: migration/restore rehearsal executed against a real database copy — PASS; a stale hardcoded schema-version assertion found and fixed; release-readiness test added). The Docker/CI evidence remains environment-blocked and public production approval is NOT evaluated.
Latest validation: 171 test files / 778 tests PASS serially, exit 0 (baseline 165/726); default parallel mode green after R8.06; source/test TypeScript PASS; production build PASS; strict G1 190 files / 0 candidates PASS; git diff --check exit 0; r7-secret-policy-check PASS (8 files / 489 tracked paths); pnpm audit --prod --audit-level=high against registry.npmjs.org: No known vulnerabilities found; serial coverage 86.45/80.49/86.23/90.54 (thresholds 80/75/85/85).
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
| `package_restore` alias | removed entirely; manifest-only compensation is now the internal failure path of `managePackage` | R4/R9 | done 2026-10-02 | REMOVED — no client-facing name can imply a full rollback it never performed |
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

- **Decision:** VERIFIED on isolated feature branch. Manifest-only compensation is a property of the package service's internal failure path, not a client-facing tool: the MCP `package_restore` name was **removed entirely (2026-10-02)** rather than kept as a deprecated alias, because no client-facing name may imply a full package rollback it never performed. Only captured supported regular manifest files are eligible, with bounded validated binary data, no traversal, duplicate, unexpected-manager paths, or symlink substitution; exact content/absence is verified after restoration.
- **Outcome contract:** Subprocess timeout/cancellation/unknown verification is marked `outcome_unknown` with no automatic compensation or successful restoration claim. Persistence status uses `manifest_restored`, `manifest_restore_failed`, `outcome_unknown` and `environment_reconciliation_required` instead of unqualified `rolled_back` for new operations; old rows are handled conservatively.
- **Evidence:** `tests/core/r4-package-manifest-compensation.test.ts` retains the disposable timeout/unknown case proving an interrupted package process never auto-restores its snapshot; the restore-path cases were retired together with the removed capability. Focus task `6a33c68a-e912-4781-8b29-b531f80ea7fa` historical context preserved above.
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

### R7.10 — CI, supply-chain and gate evidence completion (locally executable portion) — 2026-09-23

- **Status:** R7.10 IMPLEMENTED for every criterion this host can actually execute. The remaining G7 criteria are blocked by environment limitations, NOT by missing code. Overall R7 remains IN_PROGRESS / G7 OPEN; **G7 is NOT passed**.
- **Dependency advisory (real verdict, re-executed):** `pnpm audit --prod --audit-level=high --registry=https://registry.npmjs.org` returned `No known vulnerabilities found`, exit 0, on 2026-09-23 against the production dependency set (`@modelcontextprotocol/*`, `better-sqlite3`, `execa`, `zod`). The configured local mirror returns HTTP 409 for the audit API, which is an environment limitation; CI's default registry is `registry.npmjs.org`. This is a point-in-time snapshot, not a permanent guarantee.
- **Documentation / tool-catalog contract (new, executable):** `tests/core/r7-documentation-contract.test.ts` (2 tests) reads the SAME `ALL_REGISTERED_TOOLS` the MCP `tools/list` response is generated from and asserts (1) every tool the README advertises is really registered — a stale README entry would mislead an integrator into calling a non-existent operation — and (2) every executable in the README's `execute_command` allowlist exists in BOTH code allowlists (the `ALLOWED_COMMANDS` set in `legacy-command-policy.ts` and the zod enum in `execute-command.ts`). Verified current state: 48 README tools all registered (zero stale), 53 registered tools total (5 newer tools not yet listed in the README — a completeness gap owned by R9, not a safety defect).
- **Registry completeness:** the pre-existing `tests/tools/in-process-tools.test.ts` contract already asserts MCP `tools/list` matches `ALL_REGISTERED_TOOLS` exactly (53 tools) with every tool carrying a real description and title annotation.
- **Secret scan:** `r7-secret-policy-check.mjs` PASS — 8 active deployment files / 489 tracked paths, with fail-closed detection of the retired static literal, deprecated auth env assignments, query-string credential guidance, and tracked `.token`/`.env`/`.db`/`.pem`/`.key` files.
- **Serial coverage on the final R7 changeset:** 170 files / 777 tests PASS, exit 0; aggregate statements 86.45%, branches 80.49%, functions 86.23%, lines 90.54%. Satisfies the repository's current aggregate thresholds (80/75/85/85); R8 still requires separately agreed critical per-file/branch coverage and must not be pre-empted by this aggregate number.
- **Final controls:** `tsc -p tsconfig.r1.json` PASS; `tsc -p tsconfig.test.json` PASS; `tsc -p tsconfig.json` PASS; `verify-g1-global.mjs --strict` PASS (190 files / 0 candidates); `git diff --check` exit 0.
- **Honest blocked list (these are why G7 is NOT passed):**
  1. **Real frozen-image negative build** (HIGH-10): the Docker CLI exists but the daemon is unreachable (`permission denied while trying to connect to the docker API`). The disposable mismatched-manifest fixture proves the policy is encoded, but a real `docker build` on a mismatched lockfile has never executed on this host.
  2. **Non-root container runtime** (R7.05) and **live/ready health smoke** (HIGH-12): same Docker limitation. The container `USER node`, `/app/data` ownership, `/health/live` probe and loopback-only publish are encoded and statically asserted, but never exercised against a real container.
  3. **Clean-checkout CI execution**: the workflow exists with pinned actions, least-privilege permissions, build/typecheck/test/architecture/audit/secret-scan/container-smoke jobs and the runtime toolchain gate, but it has never run from a clean checkout (no GitHub Actions runner access from this host).
  4. **POSIX secret-file-permission proof**: the `0600` branch is executed on POSIX by `tests/e2e/r5-http-edge-contracts.test.ts`; this Windows host cannot execute the `chmod` case.
- **Gate decision:** G7 stays OPEN. Static, serial and local evidence is sufficient to advance the IMPLEMENTATION, but cannot substitute for a real clean-checkout CI run, real image build, non-root runtime check and readiness smoke. HIGH-10/HIGH-11/HIGH-12 were updated in `20_FINDINGS_TRACEABILITY_MATRIX.md` to IMPLEMENTED/TEST_ENCODED with the exact pending evidence named; none is claimed VERIFIED_CLOSED.



- **Status:** R7.09 implemented as a bounded leaf (documentation only, no runtime behavior change); overall R7 remains IN_PROGRESS / G7 OPEN.
- **Reference startup methods (one canonical path each):** the runbook now names stdio (`node dist/index.js`, the MCP-client subprocess transport) and HTTP (`node dist/index-http.js`, the only mode exposing `/mcp`, `/health/*`, `/operator/login`, `/dashboard`, `/metrics`) as the two reference paths and forbids mixing them. Both load the same immutable `loadAppConfig()` contract, so no environment differs except transport-specific variables.
- **Outcome unknown recovery:** documented the real contract — a step is `outcome_unknown` when the process died or timed out mid-mutation and the side effect may or may not have happened; the original tool result stays unknown and is never auto-replayed. Resolution requires `task_reconcile` with an explicit operator decision (`confirmed_succeeded`/`confirmed_failed` need an independent read-only verification Task with the same owner; `safe_to_retry` additionally needs a durable idempotent `create_file` receipt). Until reconciled the task is frozen: `task_run`/`task_resume` reject with `outcome_unknown_requires_reconciliation` and `task_append_steps` is rejected. This matches `src/core/recovery/task-reconciliation.ts`, `crash-recovery.ts` and `closed-agent-loop.ts`.
- **Authentication/workspace troubleshooting table:** every row names the exact error string the code emits and the correct operator response — retired-name startup errors, `conflicting environment names`, external-bind public-origin requirement, MCP 401 `invalid_token`/403 `insufficient_scope`, 403 file/command tools (workspace boundary or approval gate), non-retryable `SECURITY_POLICY`, HTTP 429 with `Retry-After`, and the protected `/health` vs unauthenticated `/health/live` split (operator session cookie or `hooshix:monitoring:read` scope).
- **Backup, integrity check and restore:** documented that the SQLite database at `HOOSHIX_DB_PATH` plus the audit JSONL under `HOOSHIX_LOG_DIR` form the backup unit; `PRAGMA integrity_check`/`quick_check` against the copy before trusting it; `pnpm run release:preflight` for non-destructive checks and `pnpm run release:db-rehearsal` to rehearse migration only on a backup copy; restore = stop, move aside (never delete), place verified backup, start, verify with `task_list`/`task_report`/`/tools`.
- **Public deployment boundary:** stated explicitly that TLS termination, the external tunnel and any edge proxy belong to a separate deployment project and must not be added to this repository/branch; publishing `-p 3001:3001` alone is not a secure public interface and `HOOSHIX_PUBLIC_BASE_URL` must be the exact trusted HTTPS origin of that edge.
- **README and legacy guide state:** `README.md` already documents the canonical `HOOSHIX_*` config set, the fail-closed empty-by-default workspace pool, the denylist, the backup/restore capability and the R7 runbook as the operations reference; `scripts/SETUP_NODEJS_MCP_V2.md` is already an explicit deprecated pointer to the R7 runbook. No contradiction was found between them and the code; the remaining legacy-spec cutover text belongs to R9.
- **Validation:** documentation-only change; full serial suite unchanged at **169 files / 775 tests PASS**; the r7-secret-policy check still PASSES (8 files / 488 tracked paths); no code path changed.



### R8.06 — parallel isolation root cause found and fixed — 2026-09-23

- **Status:** R8 STARTED (R8.06 only). The headline G8 blocker — the whole-suite parallel failure — is resolved with a structural fix, not a retry or a suppressed test. R8.01–R8.05 and R8.07+ remain NOT_STARTED.
- **Root cause (proven, not assumed):** the shared `beforeEach` in `tests/setup/database-cleanup.ts` deleted `data/test-agent-memory.db`, `data/test-logs` and `data/test-agent-memory.json`, but `vitest.config.ts` pinned those same paths for EVERY worker. Under parallel execution one worker's `beforeEach` therefore deleted another worker's OPEN SQLite database. Reproduced minimally with just two files (`filesystem-service` + `workspace-isolation`, `--maxWorkers=2`): the error was `EPERM, Permission denied ... data/test-agent-memory.db` from `rmSyncWithRetry` (Windows refuses to delete an open file; on POSIX the deletion orphans the connection). A second, independent collision existed: five test files shared one fixed `tests/runtime-files` scratch tree and recursively deleted it, so one worker removed another worker's in-flight fixtures (the remaining e2e trace failure).
- **Fix:** each parallel worker now owns an isolated tree keyed on `VITEST_WORKER_ID`. The setup file sets `HOOSHIX_DB_PATH` / `HOOSHIX_LOG_DIR` / `HOOSHIX_MEMORY_FILE` to `data/test-agent-memory-<worker>` / `data/test-logs-<worker>` / `data/test-agent-memory-<worker>.json`, and `vitest.config.ts` no longer injects a single shared database path. A new `tests/helpers/runtime-files.ts` exports a worker-scoped `RUNTIME_FILES_ROOT` (always forward-slash) that replaces the fixed `tests/runtime-files` literal in the five consumers. `maxWorkers: 1` was removed from the config so the DEFAULT local run exercises parallelism; CI keeps its explicit serial flags, which still override. Nothing was retried, hidden or deleted.
- **Evidence of stability (the plan requires repeated parallel runs):** the full DEFAULT parallel suite passed **four consecutive times** — 167 files / 768 tests each, exit 0 (~16–31 s) — and after adding the regression guard, **168 files / 771 tests**, exit 0. The serial suite (the CI mode) also still passes: 167/768, exit 0. Earlier, `--maxWorkers=4` on the pre-fix tree produced **564 failures**; the two-file repro produced 10 failures; both are now green.
- **Regression guard:** `tests/core/r8-parallel-isolation.test.ts` (3 tests) asserts the setup derives the three persisted paths from `VITEST_WORKER_ID`, that `vitest.config.ts` no longer injects a shared `HOOSHIX_DB_PATH`, that `RUNTIME_FILES_ROOT` is worker-scoped, and that no test file reintroduces a fixed `tests/runtime-files` literal.
- **Validation:** parallel 168/771 PASS; serial 167/768 PASS; `tsc -p tsconfig.test.json` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (190/0); serial coverage exit 0 (86.45/80.49/86.23/90.54); `git diff --check` exit 0.
- **Boundary and residuals:** this makes parallel execution reliable on this host; it does NOT certify the GitHub clean-checkout CI run (still no runner access), and the decision to flip CI from explicit serial to parallel is deliberately left to a separate change so it can be verified from a clean checkout. R8's remaining items — permanent HIGH-finding regression coverage accounting, real E2E assertions, critical per-file/branch coverage thresholds, property/fuzz tests, seeds, crash/timeout/failure injection — are still NOT_STARTED. No finding is closed by this record.

### R7.03 — bootstrap secret hardening, generation and rotation — 2026-09-23

- **Status:** R7.03 implemented and locally verified as a bounded leaf; overall R7 remains IN_PROGRESS / G7 OPEN. HIGH-11 is not closed by this record.
- **Secret input policy (already in force, restated for completeness):** `MCP_API_KEY` / `MCP_ACCESS_TOKEN` are hard startup errors; the only accepted inputs are `HOOSHIX_BOOTSTRAP_TOKEN` (>= 32 bytes) or `HOOSHIX_BOOTSTRAP_TOKEN_FILE`. `loadToken()` in `src/mcp/http-server.ts` rejects a symlinked secret file (`unsafe bootstrap secret file`), a non-`0600` file on POSIX (`insecure bootstrap secret file: expected 0600`) and any stored value under 32 bytes (`insecure bootstrap secret length`). Auto-generation uses `crypto.randomBytes(32)` written with mode `0600` and exclusive-create flag `wx`, so an existing file is never clobbered.
- **No secret reaches logs, args or health output:** the request error handler logs only the error NAME (`error instanceof Error ? error.name : "unknown"`), never the message, URL or headers; `/health/live` returns only `{"status":"ok"}`; the Dockerfile passes only a token FILE PATH (`HOOSHIX_BOOTSTRAP_TOKEN_FILE=/app/data/.token`), never a value.
- **Rotation procedure documented** (`R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md`): stop the owning process, replace the file content with `0600` permissions (or set a new >= 32-byte `HOOSHIX_BOOTSTRAP_TOKEN`), restart — only the new credential is then accepted. MCP client sessions are unaffected because they use OAuth authorization-code/PKCE, not the bootstrap secret. Historical disposition recorded: the retired static literal was removed from all active surfaces and remains only in the deliberately-unrewritten audit document; any environment that used it must rotate via the procedure above.
- **Tests (real executed processes, not mocks):** `tests/security/r7-bootstrap-secret-lifecycle.test.ts` (4 tests) spawns the actual HTTP server through the tsx loader and proves (1) a supplied token under 32 bytes aborts startup, (2) a stored secret under 32 bytes aborts startup, (3) a symlinked secret file aborts startup, and (4) ROTATION — after replacing the token file and restarting, the old secret returns HTTP 403 and the new one returns 303, and the liveness probe never echoes the secret. The symlink branch skips on Windows without symlink privilege; the POSIX `0600` branch is covered by the existing `tests/e2e/r5-http-edge-contracts.test.ts` chmod case.
- **Validation:** focused suite 4/4 PASS; full serial suite **169 files / 775 tests PASS** (was 168/771 after R8.06); `tsc -p tsconfig.test.json` PASS; `tsc -p tsconfig.json` PASS; `verify-g1-global.mjs --strict` PASS (190 files / 0 candidates); `r7-secret-policy-check.mjs` PASS (8 active deployment files / 488 tracked paths).
- **Boundary:** the POSIX file-permission proof requires a POSIX host; this Windows host cannot execute the `chmod` case, which remains owned by the container/CI smoke. Rotation was verified only against disposable isolated fixtures, never an operational service. No finding is closed.



- **Status:** R8 STARTED (R8.06 only). The headline G8 blocker — the whole-suite parallel failure — is resolved with a structural fix, not a retry or a suppressed test. R8.01–R8.05 and R8.07+ remain NOT_STARTED.
- **Root cause (proven, not assumed):** the shared `beforeEach` in `tests/setup/database-cleanup.ts` deleted `data/test-agent-memory.db`, `data/test-logs` and `data/test-agent-memory.json`, but `vitest.config.ts` pinned those same paths for EVERY worker. Under parallel execution one worker's `beforeEach` therefore deleted another worker's OPEN SQLite database. Reproduced minimally with just two files (`filesystem-service` + `workspace-isolation`, `--maxWorkers=2`): the error was `EPERM, Permission denied ... data/test-agent-memory.db` from `rmSyncWithRetry` (Windows refuses to delete an open file; on POSIX the deletion orphans the connection). A second, independent collision existed: five test files shared one fixed `tests/runtime-files` scratch tree and recursively deleted it, so one worker removed another worker's in-flight fixtures (the remaining e2e trace failure).
- **Fix:** each parallel worker now owns an isolated tree keyed on `VITEST_WORKER_ID`. The setup file sets `HOOSHIX_DB_PATH` / `HOOSHIX_LOG_DIR` / `HOOSHIX_MEMORY_FILE` to `data/test-agent-memory-<worker>` / `data/test-logs-<worker>` / `data/test-agent-memory-<worker>.json`, and `vitest.config.ts` no longer injects a single shared database path. A new `tests/helpers/runtime-files.ts` exports a worker-scoped `RUNTIME_FILES_ROOT` (always forward-slash) that replaces the fixed `tests/runtime-files` literal in the five consumers. `maxWorkers: 1` was removed from the config so the DEFAULT local run exercises parallelism; CI keeps its explicit serial flags, which still override. Nothing was retried, hidden or deleted.
- **Evidence of stability (the plan requires repeated parallel runs):** the full DEFAULT parallel suite passed **four consecutive times** — 167 files / 768 tests each, exit 0 (~16–31 s) — and after adding the regression guard, **168 files / 771 tests**, exit 0. The serial suite (the CI mode) also still passes: 167/768, exit 0. Earlier, `--maxWorkers=4` on the pre-fix tree produced **564 failures**; the two-file repro produced 10 failures; both are now green.
- **Regression guard:** `tests/core/r8-parallel-isolation.test.ts` (3 tests) asserts the setup derives the three persisted paths from `VITEST_WORKER_ID`, that `vitest.config.ts` no longer injects a shared `HOOSHIX_DB_PATH`, that `RUNTIME_FILES_ROOT` is worker-scoped, and that no test file reintroduces a fixed `tests/runtime-files` literal.
- **Validation:** parallel 168/771 PASS; serial 167/768 PASS; `tsc -p tsconfig.test.json` PASS; `node scripts/verify-g1-global.mjs --strict` PASS (190/0); serial coverage exit 0 (86.45/80.49/86.23/90.54); `git diff --check` exit 0.
- **Boundary and residuals:** this makes parallel execution reliable on this host; it does NOT certify the GitHub clean-checkout CI run (still no runner access), and the decision to flip CI from explicit serial to parallel is deliberately left to a separate change so it can be verified from a clean checkout. R8's remaining items — permanent HIGH-finding regression coverage accounting, real E2E assertions, critical per-file/branch coverage thresholds, property/fuzz tests, seeds, crash/timeout/failure injection — are still NOT_STARTED. No finding is closed by this record.

### R8.01 — HIGH-finding regression coverage audit and HIGH-10 executed negative evidence — 2026-09-23

- **Status:** R8 IN_PROGRESS beyond R8.06. This leaf audits the test backing for all 13 HIGH findings and converts the one genuinely weak spot into executed evidence. G8 remains OPEN.
- **Audit result (every HIGH finding has a permanent, executable regression test):** HIGH-01 through HIGH-09 and HIGH-13 are backed by genuine EXECUTED_BEHAVIORAL tests — several spawn real OS processes (HIGH-13 two-process lease race, HIGH-08 real git, HIGH-04/11/12 real spawned HTTP servers), and HIGH-01/02 go through a real in-memory-transport MCP client with real tool handlers. No finding has zero coverage. No .skip/.todo/it.fails-masked test remains in the suite (the 18 original R0 RED contracts were all converted to ordinary passing regressions as their fixes landed).
- **The one real weakness found and fixed — HIGH-10 was static-only.** Every prior HIGH-10 test was a fs.readFileSync(...) + toContain assertion on the Dockerfile/CI text; the frozen-lock POLICY was never actually executed. New tests/core/r8-frozen-lockfile-executed.test.ts copies the project REAL pnpm-lock.yaml into a throwaway temp directory, mutates package.json so the manifest disagrees with the lockfile, and runs the REAL pnpm install --frozen-lockfile, asserting it exits non-zero with ERR_PNPM_OUTDATED_LOCKFILE and that no node_modules was created (i.e. it aborted rather than silently regenerating the lockfile — the exact HIGH-10 defect). This is executed negative evidence for the frozen-install half; the container-build half still requires a Docker-capable target and remains blocked.
- **HIGH-12 clarified:** the endpoint behavior is already executed against a real spawned server by tests/e2e/r5-http-edge-contracts.test.ts (/health/live and /health/ready both fetched, both bodies asserted secret-free) and tests/security/r7-bootstrap-secret-lifecycle.test.ts. The remaining static assertion in tests/core/r0-known-defects.test.ts only pins that the route string exists. Only the container smoke is missing (environment-blocked).
- **Doc honesty fix:** the stale header of tests/core/r0-known-defects.test.ts still described its tests as live it.fails RED contracts, which they no longer are. Corrected to state they are converted permanent regressions and to point at the two files that now carry the executed evidence for HIGH-10 and HIGH-12.
- **Validation:** focused new test 1/1 PASS; full serial suite **171 files / 778 tests PASS** (was 170/777); default parallel mode remains green after R8.06.
- **Boundary:** this does NOT close HIGH-10 or HIGH-12 (both still need the real container build/non-root/live-ready smoke and the clean-checkout CI run) and does NOT pass G8. R8.02–R8.05 remain NOT_STARTED.

### R8.02 — real Task lifecycle over the HTTP/OAuth transport — 2026-09-23

- **Status:** R8.02 implemented and locally verified as a bounded leaf; G8 remains OPEN. R8.03–R8.05 remain NOT_STARTED.
- **The gap this closes:** every prior Task-lifecycle test ran through an in-process stdio MCP client, which never crosses the network boundary and never involves an OAuth principal, a session, or scope enforcement. Existing HTTP/OAuth tests cover the auth machinery but stop at a single get_workspace tool call. Nothing exercised the FULL Task lifecycle over HTTP.
- **New test:** tests/e2e/r8-http-task-lifecycle.test.ts spawns the real HTTP server on a reserved loopback port, completes a REAL OAuth/PKCE authorization-code grant with the full operator scopes (client registration, consent, code, token exchange), then drives the complete create -> run -> approve -> resume -> report cycle through a real @modelcontextprotocol/client over loopback HTTP — the same path a remote integrator takes. It asserts the run pauses at the approval-gated execute_command step (pending_approval with an approvalId), that approve + resume complete both steps, that task_get shows both steps completed with the executed output, and that task_report carries the tool_call timeline event. The issued access token is asserted NOT to equal the bootstrap secret.
- **Validation:** focused test 1/1 PASS; full serial suite 172 files / 779 tests PASS (was 171/778); tsc -p tsconfig.test.json PASS.
- **Boundary:** this is genuine end-to-end coverage of the Task lifecycle over the authenticated HTTP transport, but it is still a single principal and a single happy path; session expiry mid-task, multi-principal isolation and concurrent-task behavior over HTTP remain covered by the in-process suites, not by this one. No finding is closed.

### R8.03 — per-file coverage floors for security-critical modules — 2026-09-23

- **Status:** R8.03 implemented and locally verified as a bounded leaf; G8 remains OPEN. R8.04/R8.05 remain NOT_STARTED.
- **The gap this closes:** the project aggregate thresholds (80/75/85/85) cannot detect a regression that is invisible in the average — one security module could drop to near-zero while the total stays green. R8.03 requires per-module floors instead.
- **New test:** tests/core/r8-coverage-floors.test.ts (2 tests) reads the coverage summary produced by pnpm run test:coverage and enforces an explicit statements+branches floor on 12 security/reliability-critical modules: workspace-guard, authorization-service, sensitive-path-policy, command-permission, permission, workspace-scope, http-security, crash-recovery, task-reconciliation, task-lease-runner, task-lease and app-config. A second test guards the floor list itself against pointing at deleted files (a stale entry would silently enforce nothing).
- **How the floors were set:** from the ACTUAL measured coverage of the final R7/R8 changeset, deliberately below the current values so the test catches real regressions without failing on a harmless refactor. Measured current values: workspace-guard 93.98/86.17, authorization-service 89.65/91.42, sensitive-path-policy and command-permission and permission all at 100, http-security 97.05/94, crash-recovery 91.8/73.17, task-reconciliation 86.36 (floor set to 80). When measured coverage rises materially above a floor, the floor is raised toward the new value — never lowered.
- **Skip behavior:** if coverage/coverage-summary.json is absent the test SKIPS with a recorded reason instead of failing, because a plain vitest run (no --coverage) legitimately produces no summary; the CI coverage job produces it.
- **Validation:** focused tests 2/2 PASS with a fresh coverage summary; full serial suite 173 files / 781 tests PASS (was 172/779); tsc -p tsconfig.test.json PASS.
- **Boundary:** floors cover the modules that enforce a boundary; they are NOT a substitute for the container/CI smoke, and the child-process coverage gap (tool files reporting ~50% because E2E runs in spawned processes whose V8 coverage is not merged) is documented in vitest.config.ts and remains out of scope for this leaf. No finding is closed.

### R8.04 — property-based (fuzz) contracts with recorded seeds — 2026-09-23

- **Status:** R8.04 implemented and locally verified as a bounded leaf; G8 remains OPEN. R8.05 remains NOT_STARTED.
- **Approach:** no external fuzzing dependency was added (minimal-dependency principle). A small deterministic xorshift32 PRNG drives randomized but fully reproducible inputs, and every test prints SEED=<hex> plus the offending input on failure so a failing case can be reproduced and, if it exposes a real defect, converted into a permanent regression.
- **New test:** tests/security/r8-property-based.test.ts (5 tests, 400 cases each, fixed seeds): (1) every sensitive path is denied regardless of casing, mixed separators, traversal padding and uppercase extensions; (2) benign paths are never falsely denied (no over-blocking, which would break legitimate work); (3) workspace scope capture is idempotent, deeply frozen and never drops a requested root; (4) scope capture rejects an empty principal or session identity; (5) edge-character inputs (null bytes, quotes, tabs, backslashes) never crash the sensitive-path policy.
- **Seeds (recorded for reproduction):** denylist 0x484f5348, benign 0x4f564552, scope 0x53434f50, identity 0x4944, edge 0x45444745. Fixed seeds by design — the plan requires recorded, reproducible inputs, not random flakiness.
- **Validation:** focused tests 5/5 PASS; full serial suite 174 files / 786 tests PASS (was 173/781); tsc -p tsconfig.test.json PASS.
- **Boundary:** these are input-boundary properties of the pure policy and domain functions, not of the persistence layer or the HTTP transport. Crash/timeout/failure-injection against the running engine is R8.05. No finding is closed.

### R8.05 — real crash and timeout injection — 2026-09-23

- **Status:** R8.05 implemented and locally verified as a bounded leaf; G8 remains OPEN. This completes the R8.01–R8.06 leaf set (parallel isolation, HIGH-finding audit, HTTP E2E, coverage floors, property tests, crash/timeout injection).
- **The gap this closes:** existing crash-recovery tests simulate a crash by mutating persisted state in-process, which proves the recovery READ path but not that a live OS process killed mid-flight leaves exactly the state recovery expects. R8.05 performs a REAL external kill.
- **New test:** tests/e2e/r8-crash-timeout-injection.test.ts (2 tests), each spawning the real HTTP server with a real OAuth/PKCE client: (1) TIMEOUT — a hung mutating step (a 60s sleep under a 6s lease) must finalize as outcome_unknown, never silently succeeded, and its side effect must never have happened; (2) CRASH — a two-step task is driven until step 1 writes a marker file, the live process is then KILLED externally (process.kill), a fresh process restarts against the SAME database, startup recovery runs automatically, and the test asserts step 1 is still completed, its file content survived, and the in-flight step 2 is NOT silently succeeded.
- **Design note (honest):** after the restart the task cannot be read through task_get, because task_control operations are bound to the ORIGINAL session by the task-owner check in r2-runtime-gateway.ts (a security property, not a defect). The recovered state is therefore asserted directly against the persisted database, which is the authoritative recovery surface.
- **Validation:** focused tests 2/2 PASS; full serial suite 175 files / 788 tests PASS (was 174/786); tsc -p tsconfig.test.json PASS.
- **Boundary:** the lease budget is shortened (6s TTL / 1s heartbeat) to keep the test fast; production defaults remain unchanged. Ports use the 30xxx range because Windows excludes 49xxx. This does NOT close HIGH-05/06/07 (already VERIFIED_CLOSED separately) and does NOT pass G8.

### R9.01 — adapter boundary enforced: SQL removed from the transport layer — 2026-09-24 — commit `3bdca93`

- **Status:** R9 STARTED (R9.01 only, committed). G9 remains OPEN; R10 NOT_STARTED.
- **The gap this closes:** the R1 static scan cleared the legacy SQL candidates, and R6 moved the persistence layer into the SQLite adapters, but ONE executable SQL statement remained outside them: the HTTP readiness probe in `src/mcp/http-server.ts` ran `db.prepare("SELECT 1 AS ok").get()` inline in the transport handler. That is exactly the kind of boundary R9 exists to remove — a SQL string in a layer that should only call adapter functions.
- **Fix (behaviour-preserving):** new `isDatabaseReady()` in `src/adapters/outbound/persistence/sqlite/connection.adapter.ts` owns the probe SQL, opens the shared connection on first use (matching the historical lazy-initialisation behaviour of the endpoint) and returns false rather than throwing on any failure. The `/health/ready` handler now calls it through the `core/memory/database` facade and no longer contains SQL or a try/catch around SQL. The historical 200/503 contract is unchanged.
- **Dead module removal (10 files, zero source or test importers verified before deletion):** `src/domain/backup/snapshots.ts`, `src/domain/shared/result.ts`, `src/application/use-cases/auth/oauth.contracts.ts`, `src/application/use-cases/monitoring/monitoring.contracts.ts`, `src/application/use-cases/tasks/task-lifecycle.contracts.ts`, `src/application/use-cases/workspace/workspace.contracts.ts`, `src/application/ports/inbound/use-case-contracts.port.ts`, `src/application/ports/outbound/approval-repository.port.ts`, `src/application/ports/outbound/execution-lease.port.ts`, `src/adapters/inbound/mcp/common/r1-tool-mapper.ts`.
- **Bypass audit result (no code change needed):** grep across `src/` confirms no alternate execution path to tools remains — both `registry.ts` and `local-tool-executor.ts` funnel through `createR2RuntimeGateway`, and `tests/e2e/r2-no-alternate-inbound-execution.test.ts` already forbids reintroducing one. So R9's "no bypass" requirement is already enforced by a permanent test.
- **New test:** `tests/e2e/r9-adapter-boundary.test.ts` (4 tests): (1) a REAL spawned server answers `/health/ready` 200 and `/health/live` 200 against a live database; (2) the probe returns 503 `not_ready` (not a crash) when the database genuinely cannot be opened — the DB path points at an existing directory so SQLite fails with SQLITE_CANTOPEN_ISDIR on every platform (chmod is NOT used because the Windows read-only attribute does not block file creation); (3) a source scan over `src/mcp` forbids any `.prepare(/.pragma(/.exec(` call with a string literal, so the removed SQL cannot return; (4) the probe contract is reached through the adapter facade, and the removed literal does not reappear.
- **Validation:** focused 4/4 PASS; full serial suite **176 files / 792 tests PASS** (was 175/788); `tsc -p tsconfig.r1.json` PASS; `tsc -p tsconfig.test.json` PASS; `git diff --check` PASS. All files normalized to the repository CRLF convention before commit.
- **Boundary and residuals:** the remaining R9 items are NOT done — the `unrestrictedMode` mutable global in `src/security/workspace-guard.ts:241` (removal breaks 4 existing tests, so it needs its own leaf), the compat shims (`tool-orchestrator.ts` re-export facade, `legacy-command-policy.ts`, `legacy-http-server.ts`, `legacy-retention.ts`, the R1 island) which still have test importers, and the README completeness gap (5 newer tools unlisted, owned by R9). No finding is closed by this record.

### R9.02 — unrestricted mode proven unreachable from production paths — 2026-09-24

- **Status:** R9 IN_PROGRESS (R9.01 + R9.02). G9 remains OPEN; R10 NOT_STARTED.
- **The item:** R9 flags `unrestrictedMode` — a module-level mutable in `src/security/workspace-guard.ts` — as a mutable global. Analysis shows it CANNOT be enabled by any production path: the only two producers are `setUnrestrictedMode` (which routes every enable attempt through `assertUnrestrictedElevationAllowed()`, which always throws) and `seedUnrestrictedMode` (never imported outside tests — asserted by an executable source scan). The real production producer is `runWithApprovedUnrestrictedScope`, an `AsyncLocalStorage` that the R2 gateway (`r2-runtime-gateway.ts:158`) enters for a SINGLE effect after an approved-task claim.
- **Decision (with owner):** keep the global as a test-only fixture rather than deleting it. Removing it would mean rewriting six test files that use the setters for isolation, including the HIGH-01 elevation-gate regression in `tests/security/audit-high-fixes.test.ts`, without buying any production safety — the flag is fail-closed by construction. Instead the safety property is pinned by a permanent test, which is stronger than a deletion that could be reverted silently.
- **New test:** `tests/security/r9-unreachable-unrestricted-mode.test.ts` (4 tests): (1) the mode starts disabled and no exported production setter can enable it (`assertUnrestrictedElevationAllowed` always throws and state is unchanged); (2) `runWithApprovedUnrestrictedScope` grants a single effect only — the flag is on inside the callback and off the instant it returns, and never leaks into a subsequent call; (3) a source scan over `src/` proves `seedUnrestrictedMode` appears only in its own definition file, never in another source module; (4) the single-effect scope still constrains real file access — a path outside the workspace root is denied before and after the scope, and resolved only inside it.
- **Validation:** focused 4/4 PASS; full serial suite **177 files / 796 tests PASS** (was 176/792); `tsc -p tsconfig.test.json` PASS; `git diff --check` PASS.
- **Boundary and residuals:** this pins the property, it does not delete the global (a deliberate trade-off recorded above). The compat shims and the README completeness gap remain NOT_STARTED. No finding is closed by this record.

### R9.03 — compatibility shims audited and pinned as pure aliases — 2026-09-24

- **Status:** R9 IN_PROGRESS (R9.01–R9.03). G9 remains OPEN; R10 NOT_STARTED.
- **Audit (full, by subagent with grep-verified importer counts):** every file whose name starts with `legacy` in `src/`, plus the `core/memory/*` re-export facades. Result: 9 "legacy"-named files are REAL production code despite the name — `legacy-tool-orchestrator.ts` (tool selection/validation, 19 production importers), `legacy-command-policy.ts` (the command allow/block policy, 3 importers), `legacy-task-plan.ts`, `legacy-task-plan-validator.ts`, `legacy-task-plan-factory.ts`, `legacy-action-governance.ts`, `legacy-permission-policy.ts`, `legacy-tool-handler-composition.ts`, `legacy-task-state-machine.ts`. These are misnamed, not shims; renaming them is cosmetic churn with no safety value and is deliberately NOT done.
- **Genuine shims kept, with reason:** `infrastructure/config/legacy-retention.ts` (4 lines, alias of `parseRetentionDaysRaw`, 0 production importers but 2 migration tests), `infrastructure/config/legacy-http-server.ts` (projection + the retired bearer-token credential, 0 production importers but 4 tests), `infrastructure/config/legacy-runtime-paths.ts` (thin projection, 3 importers). These are the executable R7.01 migration contract — four test files assert the historical names still resolve — so deleting them would remove a cutover guarantee, not dead weight.
- **Genuine shims with real retirement value, deferred with recorded reason:** `core/memory/database.ts` (22 production importers incl. 18 SQLite adapter files — an inverted dependency where adapters import a facade that forwards back into the same adapter layer), `core/memory/task-repository.ts` (8 importers), `core/memory/database/connection.ts` (2), `adapters/inbound/mcp/legacy-sdk-bridge.ts` (17). Repointing these is high-effort mechanical churn across 50+ import sites with zero behavioral change and a real regression risk per file; it is not worth the risk in a verification phase and belongs in a dedicated cleanup change after R10.
- **New test:** `tests/core/r9-compat-shims-are-pure-aliases.test.ts` (4 tests) pins the decision: (1) `legacy-retention.ts` is a bare alias of `parseRetentionDaysRaw` with no parser of its own; (2) `legacy-http-server.ts` only re-exposes the authoritative parsers and the retired bearer token stays hard-undefined; (3) a source scan over `src/infrastructure/config/legacy-*` asserts every import statement resolves to `app-config.ts` and `process.env` appears only as a default parameter — so no shim can ever hide a parser or its own env state; (4) the historical names still resolve to the very same function objects as the authoritative parsers (an alias cannot drift from the implementation), and the projection agrees with `parseHttpSecurityConfig`.
- **Validation:** focused 4/4 PASS; full serial suite **178 files / 800 tests PASS** (was 177/796); `tsc -p tsconfig.test.json` PASS; `git diff --check` PASS.
- **Boundary and residuals:** the README completeness gap (5 newer tools unlisted) remains NOT_STARTED. Deleting the `core/memory/*` re-export facades is deliberately deferred for the recorded reason above. No finding is closed by this record.

### R9.04 — README completeness gap closed and enforced — 2026-09-24

- **Status:** R9 IN_PROGRESS (R9.01–R9.04). G9 remains OPEN; R10 NOT_STARTED.
- **The gap:** the README tool list under "Context" named only `project_save`, `project_list`, `memory_add`, `memory_list` — registered tools were silently absent: `project_get`, `project_delete`, `project_archive`, `memory_get`, `memory_update`, `memory_delete`. All registered tools are now documented (verified against the same `ALL_REGISTERED_TOOLS` that generates the MCP `tools/list` response). This was the completeness gap first measured by R7.10 and explicitly owned by R9 there.
- **Why it went unnoticed:** the R7.10 contract test only checked the STALE direction (nothing in the README may name a non-registered tool). Completeness — the reverse — was deliberately out of scope then, which is how five shipped tools stayed invisible to anyone reading the docs.
- **Enforcement:** `tests/core/r7-documentation-contract.test.ts` gains a second test that asserts every registered tool is documented in the README, so the gap cannot silently reopen. The file now enforces BOTH directions and its header explains why.
- **Validation:** focused 3/3 PASS (was 2/2); full serial suite **178 files / 801 tests PASS** (was 178/800); `git diff --check` PASS.
- **Boundary and residuals:** the README is a name list, not full per-tool documentation; richer per-tool reference lives in the `/docs` and `/tools` pages served at runtime. Deleting the `core/memory/*` re-export facades remains deferred for the reason recorded in R9.03. No finding is closed by this record.

### R10.01 — release readiness: migration/restore drill executed, stale schema assertion fixed — 2026-09-24

- **Status:** R10 STARTED (R10.01 only). The final release gate G10 is NOT passed and public production approval is NOT evaluated.
- **What was executed (the real R10 evidence):** the migration + restore rehearsal (`scripts/release-db-rehearsal.mjs`) was run against a real SQLite online backup of the live development database. Result **PASS**: integrity ok before and after, 0 foreign-key violations, task count preserved 1051 -> 1051, 8 persisted workspace roots, schema version 17, the restore drill (a second online backup of the migrated copy, reopened independently) also PASS with the same counts, and `sourceUnmodified: true`. Artifacts confined to the ignored `data/release-validation/` tree.
- **A genuine defect found and fixed:** the rehearsal asserted the migrated schema version against a HARDCODED `8`, which had silently rotted to 17 as R3–R6 migrations landed. The rehearsal was passing against a stale assumption instead of the code — exactly the failure mode R10 exists to catch. `runMigrations` now exports `LATEST_MIGRATION_VERSION` (17), the rehearsal imports it, and the assertion names the expected version on failure.
- **New test:** `tests/core/r10-release-readiness.test.ts` (3 tests) keeps the fix honest from both directions: (1) `LATEST_MIGRATION_VERSION` equals the highest `migrate()` call in the file, so adding a migration without bumping the constant fails; (2) the rehearsal script reads the exported constant and never re-declares a schema version; (3) a fresh in-memory database taken through the real production path (base schema + all migrations) reaches the head version with zero foreign-key violations, and running the migrations again is a no-op (idempotency).
- **Gates re-run this session (all PASS):** `verify-g1-global.mjs --strict` (0 candidates), `verify-runtime-versions.mjs` (node 24.18.0 / pnpm 11.24.0), `r7-secret-policy-check.mjs` (8 active deployment files / 488 tracked paths), `pnpm audit --prod --audit-level=high` (No known vulnerabilities found), `tsc tsconfig.r1.json` + `tsconfig.test.json`, `pnpm run build`, full serial suite.
- **Preflight verdict NO_GO — expected and honest:** `release:preflight` reports one blocker, `DIRTY_WORKTREE` (the uncommitted changes this very record describes), plus `UPSTREAM_NOT_CONFIGURED` and the manual gates that legitimately require an operator: the release-readiness checklist sign-off, external HTTP exposure / watchdog ownership, cutover/rollback approval, and release tag provenance. These are NOT things this environment can approve; they belong to the owner.
- **Clean-checkout preflight — `LOCAL_SOURCE_GATES_PASS` (executable, not asserted):** after committing R10.01, the tree was cloned fresh from `dccdb26` into a throwaway directory (no scratch files, no EAAP package, no backups), `pnpm install --frozen-lockfile` and `pnpm run build` were run there, and `scripts/release-preflight.mjs` then returned **verdict `LOCAL_SOURCE_GATES_PASS` with zero blockers** — `dirtyFileCount: 0` and every required digest present. The `dist/index.js` and `dist/index-http.js` digests reproduced BYTE-IDENTICALLY to the ones built in the working tree, which is real evidence the build is deterministic from a clean checkout. The frozen lockfile install succeeding there is also the executed half of HIGH-10's policy. This is the closest available equivalent of the clean-checkout CI run the environment cannot provide.
- **Validation:** focused 3/3 PASS; full serial suite **179 files / 804 tests PASS** (was 178/801); `tsc` both configs PASS; build PASS; db rehearsal PASS; `git diff --check` PASS.
- **Boundary and residuals — what R10 still cannot do here:** the Docker daemon is unreachable (permission denied on npipe), so the real frozen-image negative build, the non-root container runtime and the live/ready container smoke remain unexecuted; there is no GitHub Actions runner, so the hosted clean-checkout CI run remains unexecuted (the local clean-clone preflight above is the strongest available substitute, not a replacement); POSIX secret-permission proof needs a POSIX host. These were blocked in R7 and stay blocked. The 54-finding matrix closure count is unchanged by this record; no finding is closed.

### R8.07 — static and lint hygiene made permanent — 2026-09-24

- **Status:** R8 IN_PROGRESS (R8.01–R8.07 all done). G8 remains OPEN pending the final gate consolidation.
- **The item:** the backlog names R8.07 as "keep strict TS; add only useful rules; always include `git diff --check` and forbidden-import checks". Strict TypeScript was already in force (`strict`, `noUnusedLocals`, `noUnusedParameters` in tsconfig.json, enforced by both compile gates), and the forbidden-import rules were partially covered by `r0-architecture-boundary.test.ts` and `r1-strict-boundary.test.ts`. The two gaps were that `git diff --check` was only ever run by hand, and the config-shim import boundary had no executable enforcement after R9.03.
- **New test:** `tests/core/r8-static-lint-hygiene.test.ts` (4 tests): (1) the strict TS options stay enabled in the build config, so they cannot be silently relaxed; (2) `git diff --check` runs inside the suite and must report nothing — the hygiene gate is now executable, not a manual step; (3) no `legacy-*` config shim imports anything but the authoritative `app-config.ts`; (4) every real test-file import resolves inside `src/` or `tests/`, so no test can reach production internals through a relative back door. Test (4) matches import statements at line start specifically so probe STRINGS inside the boundary tests (which deliberately name invalid specifiers like `../../outbound/sqlite.js`) are not mistaken for imports.
- **Validation:** focused 4/4 PASS; full serial suite **180 files / 808 tests PASS** (was 179/804); `tsc` both configs PASS; `git diff --check` PASS.
- **Boundary:** this enforces hygiene on the working tree and the config shims; it does NOT add an ESLint/Biome config (the project deliberately uses the TypeScript compiler as its lint gate, and adding a second tool is not a useful rule). No finding is closed.

### R8.08 — Gate G8 criteria mapped to executable evidence — 2026-09-24

- **Status:** R8 COMPLETE (R8.01–R8.08). G8 itself is NOT marked PASS — see the blocked item below.
- **Gate G8 requires (doc 22) / evidence now on record:**
  1. *all HIGH findings have permanent regressions* — R8.01 audit: HIGH-01–09/13 are EXECUTED_BEHAVIORAL; HIGH-10 gained the executed negative frozen-lockfile test; HIGH-12 is executed against a real spawned server. No `.skip`/`.todo`/`it.fails` mask remains.
  2. *HTTP/OAuth transport E2E active* — R8.02 full create→run→approve→resume→report over real OAuth/PKCE + loopback HTTP.
  3. *critical modules meet per-file thresholds* — R8.03 floors on 12 security/reliability modules, with a guard that the floor list never points at a deleted file.
  4. *property tests deterministic and reproducible* — R8.04, 5 properties × 400 cases with recorded seeds.
  5. *parallel suite only after isolated state; repeated parallel runs green* — R8.06 isolation fix, plus **3 consecutive full parallel runs green (180 files / 808 tests each) this session**. One genuine race condition was found by exactly this requirement and fixed in `b498d58`: the new hygiene scan walked `tests/` while `orchestration-remediation.test.ts` deleted its scratch tree, so `readdirSync` threw ENOENT mid-scan.
  6. *`git diff --check` clean* — now an executable assertion inside the suite (R8.07), not a manual step.
  7. *no flaky test tolerated by blind retry* — the parallel-run requirement is the mechanism; nothing was retried to green.
- **The one G8 item that stays blocked:** the backlog ties G8 to the CI container/parallel profile on a clean checkout. That needs a hosted runner, which this environment does not have. The 3 parallel runs above are the local equivalent, not a hosted CI certification.
- **Validation:** serial 180 files / 808 tests PASS; parallel ×3 PASS; `tsc` both configs PASS; `git diff --check` PASS.
- **Boundary:** R8 leaves are complete and evidence-backed; G8 is NOT declared PASS because of the missing hosted CI evidence. No finding is closed.

### R10.03 — checklist 4.9 fixed and executed; real child-process secret leak closed — 2026-09-24

- **A genuine vulnerability, found by filling the checklist honestly.** Item 4.9 ("child process environment excludes unrelated sensitive credentials") was the only section-4 item with no test. Auditing `src/services/shell/shell-service.ts` showed the shell passed no `env` option to execa. Since execa's `env` **extends** `process.env` by default (`extendEnv: true`), every spawned command inherited the full parent environment: `HOOSHIX_BOOTSTRAP_TOKEN`, `HOOSHIX_OAUTH_CLIENT_SECRET`, `HOOSHIX_API_KEY`, and the DB/log paths. Verified empirically by a probe subprocess before the fix.
- **The fix is an allowlist plus `extendEnv: false`.** `buildChildProcessEnvironment()` in `src/infrastructure/config/app-config.ts` (the only layer permitted to read `process.env`, per the G1 gate) copies only PATH/PATHEXT/SystemRoot/WINDIR/COMSPEC/PSModulePath/LANG/LC_ALL/TZ/HOME/USERPROFILE/TEMP/TMP. Setting `extendEnv: false` is essential — without it the allowlist is inert, because execa merges rather than replaces.
- **Test:** `tests/security/r4-child-env-excludes-secrets.test.ts` (4 tests). The pure layer asserts the allowlist withholds every `HOOSHIX_*` and still delivers PATH/HOME, and omits empty/undefined values. The real-subprocess layer runs an actual `node` command through `executeShellCommand` and asserts the environment the child received contains no `HOOSHIX_*` but does contain PATH.
- **Flaky-test work the leak exposed.** The parallel suite had a latent ~15% failure rate (a baseline 1/6 and 2/8 runs failing with EPERM on fixture cleanup) that became ~50% while the first 4.9 test held a shared database connection. Root cause was test-tree directory scans racing against tests that create/delete scratch directories (`tests/orchestration-remediation`, `tests/tool-coverage`). Fixed in two places: `r8-static-lint-hygiene.test.ts` and `r8-parallel-isolation.test.ts` now tolerate a vanished directory. **8 consecutive full parallel runs green** after the fix. `spawnDisposableNode` and the fixture helper already carried the retry machinery; the two remaining scans did not.
- **Validation:** serial 181 files / 812 tests PASS; parallel ×8 PASS (0 failures); `tsc` both configs PASS; `verify-g1-global.mjs --strict` PASS (the config-layer placement is what keeps it green); `git diff --check` PASS.
- **Boundary:** this closes checklist item 4.9 and raises the executed count to 116/139. It does NOT close any audit finding, and the 4 environment BLOCKED items plus the 19 NOT_VERIFIED (dominated by the 7 missing `docs/*.md` files) remain.

### R9.06 — `docs/TOOLS.md` generated against the catalog, kept honest by a test — 2026-09-24

- **The item:** the backlog names R9.06 as "generate `docs/TOOLS.md` from catalog". The file did not exist; the 53-tool list lived only in README.
- **What was written:** `docs/TOOLS.md` — the full 53-tool reference (18 read, 16 write, 9 execute/git, 4 package, 6 task-engine) with risk classes (low/medium/high/critical), approval tags (`always` / `on-risk` / `never`), and the 30 step-executable vs 23 control-plane split.
- **Executable enforcement:** the contract test `tests/core/r7-documentation-contract.test.ts` gained a bidirectional check — `docs/TOOLS.md` must name every registered tool and no unregistered one, read against the same `ALL_REGISTERED_TOOLS` the MCP `tools/list` response is generated from. One genuine false positive was caught and fixed during authoring (a prose backtick `` `tool` `` that the identifier regex treated as a tool name). The suite is now 4 tests (was 3).
- **Boundary:** the file is hand-written from the catalog and pinned by the test; it is NOT produced by a generator script. Checklist item 14.9 (clean-diff generation gate) therefore stays open and is recorded as such. R9.07 items below close it as far as writing the documents goes.
- **Validation:** focused 4/4 PASS; serial suite 181 files / 813 tests PASS.

### R9.07 — final `docs/ARCHITECTURE.md`, `SECURITY.md`, `OPERATIONS.md`, `PROTOCOL_COMPATIBILITY.md`, `MIGRATIONS.md`, `RELEASE.md` — 2026-09-24

- **The item:** the backlog names R9.07 as "write final ARCHITECTURE.md, SECURITY.md, OPERATIONS.md". Four further required documents were missing (`PROTOCOL_COMPATIBILITY.md` also required by checklist §3.8, plus `MIGRATIONS.md` and `RELEASE.md`). None existed; section 14 of the release checklist was the single largest gap in the program (8 of 11 items open).
- **What was written, all from the actual code rather than from prior design notes:**
  - `docs/ARCHITECTURE.md` — the layering, the six dependency rules with the test that enforces each, `ExecuteToolUseCase` and its guarantees, `OperationCatalog`, the composition roots, and the retained compatibility shims. States that the tests win on disagreement.
  - `docs/SECURITY.md` — the empty-by-default workspace pool, single-effect unrestricted scope, sensitive-path policy, bootstrap-vs-OAuth credential separation, the child-process env allowlist (R10.03), backup-before-mutation and guarded restore, audit redaction.
  - `docs/OPERATIONS.md` — requirements, startup, health endpoints, bootstrap secret and rotation, the full `HOOSHIX_*` configuration inventory from every `parse*` function in `app-config.ts`, logging, `outcome_unknown` reconciliation, backup/restore, incident response.
  - `docs/PROTOCOL_COMPATIBILITY.md` — exact `@modelcontextprotocol/*` versions from `package.json`, the 2026-07-28 / 2025-06-18 split per ADR-009, and the v1-SDK dependency stated as an open item rather than claimed closed.
  - `docs/MIGRATIONS.md` — versions 1–17 with each migration's effect, idempotency mechanics, the rehearsal procedure, retention, and failure behavior.
  - `docs/RELEASE.md` — preflight, gates, migration rehearsal, traceability, sign-off recording, and the three environment blockers named explicitly.
- **Facts were extracted by re-reading the code and the existing test suite, not copied from earlier documentation**, so a reader following these documents lands on behavior the tests actually assert.
- **Validation:** serial 181 files / 813 tests PASS; parallel ×5 PASS; `tsc` both configs PASS; `git diff --check` PASS.
- **Boundary:** section 14 goes from 3/11 to 10/11 executed; the remaining item (14.9, a generation gate) is documented as NOT_VERIFIED because `TOOLS.md` is test-pinned but not generated. The executed checklist total is now 124/139, with 4 environment-BLOCKED and 11 NOT_VERIFIED. No finding is closed by writing documentation.

### R9.05-continue + checklist 3.2/8.4 — v1 SDK removed, migration-abort tested — 2026-09-24

- **3.2 — the v1 monolithic SDK is removed.** The last surviving import was `tests/helpers/mcp-client.ts` importing `@modelcontextprotocol/sdk/client/stdio.js`. The fix: the dependency is deleted from `package.json`, the helper loads the v2 `StdioClientTransport` from `@modelcontextprotocol/client` through `createRequire`, and `tests/security/r3-no-v1-monolith-imports.test.ts` (2 tests) asserts both the manifest absence and that no source/test/script imports it. The lockfile was rebuilt against `registry.npmjs.org` because the Liara mirror does not carry every transitive tarball (`ERR_PNPM_FETCH_404`); a clean `node_modules` `--frozen-lockfile` install was verified after the rebuild.
- **A real TypeScript 7 constraint, worked around honestly.** TS 7.0.2 under `NodeNext` will not resolve `@modelcontextprotocol/client/stdio` by its package subpath — its bundled declaration re-exports from a hashed `.mjs` that TS refuses to follow, and neither `bundler` resolution nor a direct `.mjs` path resolves either. The transport is therefore loaded through `createRequire` (which resolves the exports map at runtime) and typed by inferring the `Transport` the `Client.connect` signature accepts. The comment in the helper explains why.
- **8.4 — migration failure aborts startup, tested.** `tests/core/r8-migration-failure-aborts.test.ts` (3 tests): a poisoned database makes `openAgentDatabase` throw rather than swallow; `runMigrations` reaches head and is idempotent; an already-applied migration is never re-applied.
- **Validation:** serial 183 files / 818 tests PASS; `tsc` both configs PASS; `pnpm run build` PASS; clean `--frozen-lockfile` install PASS; `verify-g1-global.mjs --strict` PASS; `git diff --check` PASS.
- **Boundary:** sections 3 and 8 are now complete. The executed checklist total is 126/139, with 4 environment-BLOCKED and 9 NOT_VERIFIED. No finding is closed.

### Checklist close-out — 9.9 / 10.6 / 10.7 / 10.9 / 13.10 / 14.9 — 2026-09-24

The remaining open items were all closeable with code and tests on this host. All six are now executed.

- **9.9 — event-loop delay measured.** `tests/core/r9-event-loop-delay.test.ts` drives a 2000-row instrumented DB write batch (the hot path the audit named) and samples loop scheduling delay around it: idle 4.9ms, under load 4.9ms, bounded under 100ms.
- **10.6 — auth-failure log safety.** `tests/security/r10-auth-failure-logs-no-token.test.ts` starts the real HTTP server and sends malformed/unknown bearer tokens to `/mcp`, `/metrics` and `/dashboard`, then inspects both the response bodies and the process's own stdout/stderr for the token strings. None may appear.
- **10.7 — security-event taxonomy.** `tests/security/r10-security-event-taxonomy.test.ts` (5 tests) drives each event kind through the execution gateway and asserts the exact kind recorded on `SecurityEventPort`: `authorization_denied`, `workspace_mutation_executed`, `approved_unrestricted_effect_executed`, no event for an ordinary read, and audit-sink failure degrading to `observabilityDegraded` instead of failing a side effect.
- **10.9 — JSONL rotation implemented, not just documented.** `logCommandAction` now rotates `command-actions.log` to `.1` at a 10 MiB bound (`MAX_LOG_BYTES`). `tests/security/r10-audit-log-rotation.test.ts` (5 tests) proves the rotation by seeding an oversized file, plus one-line-per-action JSONL validity, directory recreation after the log tree is removed, and that a caller-supplied `env` is never serialized verbatim.
- **13.10 — incident response shipped.** `docs/OPERATIONS.md` carries the four operator procedures (bootstrap token leak, unknown task outcome, database issue, edge/exposure outage), each naming the resolving tool and the invariant it protects.
- **14.9 — `TOOLS.md` generation gate.** `scripts/generate-tools-doc.mjs` rewrites `docs/TOOLS.md` from `ALL_REGISTERED_TOOLS` + `OPERATION_CATALOG` (53 tools); under `CHECK=1` it exits 1 if the file would change. The bidirectional R9.06 test remains the contract.
- **Validation:** serial 187 files / 830 tests PASS; `tsc` both configs PASS; `pnpm run build` PASS; clean `--frozen-lockfile` install PASS; `verify-g1-global.mjs --strict` PASS.
- **Boundary:** sections 9, 10, 13 and 14 are now complete. The executed checklist total is **132/139**, with 4 environment-BLOCKED and 3 NOT_VERIFIED. The 3 remaining (1.1/1.2/1.3, audit-findings matrix closure) need hosted-CI and container evidence, exactly like the 4 BLOCKED items. Every item that could be closed with code and tests on this host is closed.

### R9 facade removal — `src/core/memory/database.ts` deleted — 2026-09-24

- The deferred item is done. The file was a 15-line pure re-export shim (`export { ... } from "./database/index.js"`) kept alive by 55 importers that could equally well have pointed at the real module. A shim like that is dead weight: it cannot be deleted without touching every importer, and an importer that diverges creates a second source of truth for the database API.
- The removal repointed all 55 importers (30 in `src/adapters/outbound/persistence/sqlite/repositories/`, 25 in tests and entrypoints) from the bare `core/memory/database.js` to `core/memory/database/index.js`. The negative lookahead in the replacement kept the real subpaths — `database/connection.js`, `database/migrations.js`, `database/cleanup.js` — untouched.
- `src/memory/database.ts` is **not** a shim and was left alone: it has real code (`initializeDatabase`/`getDatabase` wrapping `withAgentDatabase`/`openAgentDatabase`) and is the entrypoint entry `src/index.ts` and `src/index-http.ts` use.
- The removal is executable: `tests/core/r9-database-shim-removed.test.ts` (2 tests) asserts the file is absent and that no source, test or script imports the bare shim path, with the same negative lookahead so the real subpaths cannot false-positive.
- **Validation:** serial 188 files / 832 tests PASS; `tsc` both configs PASS; `pnpm run build` PASS; `verify-g1-global.mjs --strict` PASS; `git diff --check` clean.

### Docker via WSL — 12.6 / 12.8 / 12.9 / 5.12 closed; MED-03 closed — 2026-09-25

- The Docker daemon was unreachable from Windows (`permission denied ... npipe`) but is installed and running inside WSL Ubuntu. The daemon itself was failing to start: `/etc/docker/daemon.json` carried a `hosts` directive that conflicts with the systemd service's `-H fd://` flag. Removing the `hosts` key (keeping the backup at `daemon.json.bak`) let the daemon start.
- `scripts/container-smoke.sh` is the executable evidence for four items that were recorded as environment-BLOCKED:
  - **12.6** non-root runtime — execs `id` in the running container: uid=1000, user=node.
  - **12.8** image health — polls `docker inspect --format '{{.State.Health.Status}}'` until `healthy`, and `/health/ready` returns 200 from inside the container.
  - **12.9** authenticated container smoke — the bootstrap secret is rejected as an MCP bearer (401), operator login with it issues a session cookie (303), that cookie reaches `/metrics` `/dashboard` `/tools` (all 200), and unauthenticated `/metrics` is 401.
  - **5.12** POSIX 0600 — asserts `stat -c '%a' /app/data/.token` is exactly 600 inside the Linux container, exercising the chmod branch that cannot run on Windows.
- **MED-03** closed by `tests/core/r6-search-task-transport.test.ts`: drives the search budget through the task-engine transport (the `search_files` file handler) instead of calling `searchWorkspaceFiles` directly. With 60 files × 20 matching lines, the 1000-result cap fires mid-walk and `truncated` is true; a sparse query reports no truncation.
- A caveat recorded honestly: `src/core/memory/database.ts` was deleted in the previous entry, and the smoke script builds from the repo root via `/mnt/d`, so the image includes only what the Dockerfile COPYs — `dist/` is rebuilt inside the container, not copied from the Windows tree.
- **Boundary:** the executed checklist total is now **136/139**, with 0 environment-BLOCKED remaining and 3 NOT_VERIFIED. The 3 remaining are section-1 rollups (1.1 HIGH-10 hosted clean-checkout CI, 1.2 the MED-15/16/21/23/24/26/27 rows needing hosted CI, 1.3 LOW-02..12 deferred by owner mandate). Every item that could be closed with code, tests, or a container on this host is closed.

---

## 2026-10-02 — Task↔Project direct binding, `memory_update`, and tool-doc synchronization

Two architectural gaps identified by an external audit of this project were closed, every tool description/example was re-verified against its schema and handler, and a production-database leak in the test suite was found and fixed. Full report: `docs/FULL_AUDIT_2026-10-02.md`.

**CRITICAL-01 — the test suite opened the production database and ran migrations on it.** `tests/security/r4-db-identity.test.ts` did `delete process.env.HOOSHIX_DB_PATH` in `afterEach`; the global setup's `beforeEach` then called `replaceWorkspaceRoots(process.cwd())`, which re-opened the database at the default `./data/agent-memory.db` — the LIVE database — and `withAgentDatabase` ran `runMigrations` against it. Proven forensically: migration 21's `applied_at` (`2026-10-01T23:31:34Z`) landed 16 seconds after the first `vitest run` started, and the WAL mtime advanced on every full-suite run. The only data effect was one `workspace_roots` row's `updated_at` being bumped (a legitimate row for the repo path). The bug predates the `package_restore` removal and was invisible purely because no new migration had landed since. Fixed three ways: the suite now restores the inherited value instead of deleting it; `tests/setup/database-cleanup.ts` re-asserts `HOOSHIX_DB_PATH` before anything opens a connection (the setup owns that variable); and `tests/core/r8-parallel-isolation.test.ts` gained a source-level guard making the re-assertion mandatory. A before/after WAL-mtime probe is the evidence: the full suite no longer touches the production database.

**Task↔Project direct binding (migration 21).** The only link from a Task to a Project used to be a `memory_items` row carrying both ids, so listing a project's tasks required a memory scan the schema could not enforce. `tasks.project_id` (nullable, indexed by `idx_tasks_project_id`) is now set at `task_create` and never rebound; `task_list(projectId)` filters on it in SQL; `task_get` returns it. The column is optional so pre-existing tasks and project-less tasks stay valid. The canonical resume path is now `Project → memory_list(projectId) → task_list(projectId) → task_get(taskId)` instead of `Project → Memory task_ref → Task ID`.

**`memory_update`.** The Memory API was add/get/list/delete only. `memory_update(memoryId, kind?, content?)` now mutates a record in place (backed by the new `memory_items.updated_at` column), requires at least one of kind/content, and is principal-scoped — another owner's row reports `{updated: false}` rather than being touched. Catalog: risk medium, approval on-risk, Context & Memory. The registered tool count is 52 → 53 (29 step-executable + 24 control).

**DOC-01 — 14 tool descriptions disagreed with their own schemas/handlers.** The worst was `memory_update`'s own example, which passed a JSON object to a `z.string()` field so any caller following the docs would fail; `git_commit` documented a non-existent error code; `project_save`'s update example omitted the required `path`; `task_snapshot` claimed to snapshot dirty worktrees when it refuses them; and several filesystem/shell tools hid real parameters (`includeSha256`, `ifMatchSha256`, `idempotencyKey`, the exact-argv nature of the auto-allow list). All corrected in `src/tools/**` with the behavior verified against the handlers.

**DOC-02 — the README carried stale tools and the stale-detection guard could not see them.** The README tool list still named `package_restore` two releases after the tool was removed, and a Persian prose line referenced it too. The root cause was logical: `R7.10`'s stale check only collected names that were *already registered*, so an unregistered name was structurally invisible. The test now parses the README's tool-list bullet block and asserts every name there is registered — verified by re-adding `package_restore` and watching it fail. `docs/TOOLS.md` was regenerated with the official generator (not hand-edited) and is idempotent.

**Verification:** build clean; 872 tests / 195 files pass; lint green; live server restarted onto the new dist (PID 22580, both health endpoints 200) and serves 53 tools including `memory_update` and `projectId` on `task_create`/`task_list`. Production DB integrity: `quick_check = ok`, `foreign_key_check` empty. Nothing has been committed — changes await explicit owner approval.



---

## 2026-10-02 (II) — End-to-end audit remediation: governance deadlock, file idempotency, Windows root casing, error taxonomy, reflection

An end-to-end audit invoked all 53 registered tools through a real MCP client (`/mcp` from ChatGPT) — not schema checks, but happy paths, failure paths, governance, approvals, replay, recovery, rollback, idempotency, isolation and cleanup. 51/53 tools had a working success path; the audit filed 8 real defects. This entry fixes 7 of them (the 8th is an environment issue with the machine's Python launcher, not `execute_command`). Full report: `docs/E2E_AUDIT_REMEDIATION_2026-10-02.md`.

**CRITICAL — `project_delete`/`memory_delete` approval deadlock.** The catalog declared both `approval: "always"`, a policy satisfiable only by an approved Task step, yet they are control-plane tools outside the step-executable `TOOL_NAMES` set — `task_create.steps[].tool` rejects them. So a direct call answered `verified_task_approval_required` and no path could ever supply that approval; the tools were unusable (and two leftover audit records in production were undeletable for exactly this reason). Both are now `approval: "on-risk"`, identical to every other control-plane mutation (`project_save`, `project_archive`, `memory_add`, `memory_update`, `task_cancel`, `task_link`); `risk: "high"` and `destructiveHint: true` are preserved so `task_step_risks` and the audit trail still flag them. Regression: `tests/e2e/r2-control-plane-delete-and-failure-reasons.test.ts` executes both deletions through the in-process MCP server. The prior `tests/tools/in-process-tools.test.ts` case that asserted the denial as desired behavior was rewritten to assert successful deletion.

**HIGH — `read_file(includeSha256=true)` broke its own contract.** `executeAuthorizedDirectTool` put the hash in a top-level sibling of the MCP result, but `CallToolResult` carries only `content`/`structuredContent`/`isError`; strict clients drop the rest. So a client only ever saw the content and could never obtain the hash that the documented safe read-modify-write workflow (`ifMatchSha256`) needs. With `includeSha256` set, the payload inside the content block is now `JSON.stringify({content, sha256})` — exactly what the tool description promises. The Task path is untouched (the object is preserved there, so `{{stepN.output.sha256}}` still resolves). Regression: `tests/e2e/r2-file-cas-real-parity.test.ts`.

**HIGH — file `idempotencyKey` collided across workspaces.** The idempotency request hash was built from the *raw* argument path (usually relative), not the canonical absolute path, so two independent workspaces sharing a key + relative path + content produced one identical hash. The second write/delete then returned the first workspace's cached receipt **without performing any effect in the second workspace** — the audit's `write_file` cross-workspace failure and its `delete_file`-with-key failure are the same root cause. The key is now derived from the canonical path returned by `validateWorkspace`, and the `write_file` cache lookup happens after path resolution. Regression: `tests/core/r2-file-idempotency-workspace-scoping.test.ts` (4 scenarios).

**HIGH — Windows compared captured roots case-sensitively.** `local-tool-executor.ts` used `capturedRoots.includes(active)` and the gateway approval verifier used `Array.includes` on the root snapshot; on Windows a Task created in `C:\WINDOWS\TEMP` failed execution with `task_workspace_not_in_captured_roots` (and approval verification failed) against a captured `c:\WINDOWS\TEMP`. `sameRootIdentity` (win32 case-insensitive canonicalization) is now exported from `workspace-guard.ts` and used at both points; non-Windows stays case-sensitive. Regression: `tests/core/local-tool-executor-root-casing.test.ts` — a case-differing workspace is accepted, a genuinely absent one is still rejected.

**MEDIUM — `STALE_WRITE` never surfaced as its documented error.** `write_file`/`modify_file` throw an `errorType: "STALE_WRITE"` error on an `ifMatchSha256` mismatch, but `classifyHandlerFailure` did not recognise it, so clients received an indistinguishable `tool_handler_failure`. The mutation correctly did not apply (data integrity held); only the contract was broken. `classifyHandlerFailure` now maps it to a stable `stale_write` reason.

**MEDIUM — semantic errors collapsed into `tool_handler_failure`.** Changed idempotency payloads, duplicate project names, empty memory content, active-root removal, terminal-`task_append_steps` and file preconditions all shared one opaque label, forcing callers to blind-retry. `classifyHandlerFailure` now maps `AgentError` codes structurally first (layering-safe: the code is read off the error object, `core/errors.ts` is not imported from `application/`), then adds message heuristics for `cannot_remove_active_workspace`, `duplicate_project_record`, `task_append_rejected` and `reconciliation_state_invalid`. Regression: three labels (`stale_write`, `memory_content_required`, `task_append_rejected`) are asserted through the real MCP path.

**MEDIUM — `task_report.reflection` reported success for a failed Task.** The reflection engine read only the `executions` table; forensics on the production database showed it is **completely empty** for a Task that timed out and was reconciled to `confirmed_failed` (its real state lives in `tasks`/`task_steps`). The engine therefore emitted "No execution failure recorded / No failure detected / Existing execution path succeeded" for a durably failed run. The persisted plan is now authoritative: with no execution-row issue but a `failed` plan carrying `failed`/`reconciled_failed` steps, the reflection is derived from the plan (step error plus the reconciliation finding) and never claims success. Regression: two new cases in `tests/core/reflection-engine.test.ts`.

**Verification:** build clean; **884 tests / 198 files pass** (from 872/195), including 9 new regression tests; lint green (`G1_GLOBAL PASS`, `R7_SECRET_POLICY_PASS`). `docs/TOOLS.md` regenerated with the official generator — the only diff is the two `always` → `on-risk` approval rows. Production-database leak re-checked: the maximum `created_at` across `tasks`, `task_steps`, `projects`, `memory_items`, `executions` and `file_backups` stops before 05:09 today, so no test run wrote to production; the WAL mtime movement is live-server checkpoint activity, not test writes. Integrity still `quick_check = ok`, `foreign_key_check` empty. **No production row was added, changed or removed** — the two leftover audit records are deliberately left in place now that the deadlock that made them undeletable is fixed. The live server must be restarted to serve the new dist.