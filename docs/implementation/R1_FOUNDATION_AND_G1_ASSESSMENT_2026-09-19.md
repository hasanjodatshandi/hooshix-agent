# R1 — Hexagonal/Clean foundation implementation and G1 assessment (2026-09-19)

Project: HooshiX Brain at `D:/workspace/hooshix-agent`.
Base: clean R0 G0 commit `24f09e0`, branch `feature/r1-hexagonal-foundation-2026-09-19`.
Authoritative plan: documents 02/03/04/05/06, backlog R1.01–R1.06 and Gate G1 in document 22.

## Implemented in this changeset

| Leaf | Actual deliverable | Status |
|---|---|---|
| R1.01 | Domain/Application/Adapter/Infrastructure/Bootstrap directories; empty future adapter/handler directories tracked with explicit `.gitkeep` markers, no legacy bulk moves | IMPLEMENTED |
| R1.02 | Pure branded identifiers, domain errors/results, Task/Step/Approval/ToolDescriptor/WorkspaceScope/Principal/ExecutionReceipt/Idempotency/backup value types; pure dependency-cycle, append and scope-capture policies | IMPLEMENTED |
| R1.03 | Application-owned Task/Approval/Lease/Workspace/Filesystem/Process/Git/Package/Input Validation/Clock/Identity/Token/OAuth/Rate Limit/Telemetry ports | IMPLEMENTED AS CONTRACTS; non-memory production adapters belong to R2–R7 |
| R1.04 | Executable read-only `ExecuteToolUseCase`, `CreateTaskUseCase`, `GetTaskUseCase`, `GetWorkspaceUseCase` and typed contracts for remaining Task/Workspace/OAuth/metrics/retention use cases. Fail-closed for mutating tools in R1 | IMPLEMENTED AS SKELETON; no production mutation/approval/lease activation |
| R1.05 | Explicit `createR1FakeComposition` wiring pure application use cases to separate in-memory Task/Workspace and fake Tool/Audit adapters; inbound MCP mapper delegates only to the application use case | IMPLEMENTED FOR TEST COMPOSITION; live MCP remains on legacy runtime |
| R1.06 | Standalone TypeScript project `tsconfig.r1.json` compiles **only** Domain/Application with no Node ambient types; permanent `typecheck:r1` and combined `typecheck` scripts; R0 import scaffold and R1 static new-tree boundary tests | PASS FOR NEW TREE; G1 GLOBAL NOT YET PASSED |

## Verified application behavior

- New in-memory Task creation copies workspace context per principal/session and rejects invalid plan dependencies, self/cross-step cycles and duplicate step IDs.
- Task scope is unchanged when the direct session workspace later changes.
- New read-only gateway refuses unknown tools, invalid arguments, principal/scope mismatch and a root absent from allowedRoots.
- A simulated mutating tool returns `approval_required` **without** invoking a handler. It cannot be substituted for an R2 production approval implementation.
- Standalone application/core compilation needs no MCP SDK, SQLite, process runner or Node filesystem dependency; adapter-specific code stays outside `tsconfig.r1.json`.
- Target-tree boundary tests reject synthetic cross-layer import and SQL/environment violations; tests include the actual present new source tree. This is a conservative static source check, **not an AST parser**: the installed TypeScript 7 package does not expose the old JavaScript `createSourceFile` API. CI-grade parser/negative-fixture hardening remains in R8.

## Legacy architecture violation migration baseline — NOT EXEMPTED FROM FINAL G1

A read-only static **candidate inventory** of the unchanged 97 legacy `.ts` files found these broad matches (counts overlap and include legitimate old DB/transport modules):

| Category | Candidate files | Examples | Removal owner / planned phase |
|---|---:|---|---|
| SQL strings outside target SQLite adapter | 20 | `src/core/memory/task-repository.ts`, `src/tools/task/index.ts`, `src/security/workspace-policy-repository.ts`, and existing database migration modules | R2/R6/R9 — extract all SQLite access/migrations into `adapters/outbound/persistence/sqlite/**` |
| `process.env` outside target config/bootstrap | 9 | `src/security/workspace-guard.ts`, `src/mcp/http-server.ts`, legacy entrypoints | R2/R5/R7/R9 — typed config and explicit composition |
| Concrete service/security/memory imports in core/tools/MCP | 44 | `src/core/runtime/task-runtime-service.ts`, `src/core/executor/handlers/file-handler.ts` | R2/R3/R4/R9 — migrate to application ports/gateway |
| MCP SDK imports outside new inbound adapter | 19 | `src/mcp/server.ts`, `src/mcp/http-server.ts`, `src/tools/task/index.ts` | R2/R5/R9 — modern inbound adapters and legacy cutover |

These are source-text **candidates**, not 92 independently adjudicated vulnerabilities.
Existing DB migration modules count in the SQL inventory because they are still
under the old directory; they are permitted as migration code but must be moved
into the target persistence adapter before the final gate.

This ledger establishes the temporary legacy migration baseline permitted by
section 7 of `29_IMPLEMENTATION_PROGRESS_LEDGER.md`. No new target-tree
violation is accepted after R1. The global text of Gate G1 also requires
**no raw SQL outside SQLite adapters/migrations, no non-config environment
access and no remaining forbidden adapter dependency**: unchanged legacy
code still violates that final target. Therefore the **R1 foundation code is
implemented but overall G1 cannot honestly be marked PASS** without
crossing into the mass-migration work assigned to R2–R9.

## Regression evidence

- Independent `pnpm exec tsc -p tsconfig.r1.json`: PASS.
- Focused R1/R0 architecture suite: 3 files, 14 tests PASS.
- Full suite before the permanent typecheck script wiring: 105 files;
  **502 passing + 18 expected pre-fix failures**, no unexpected failures.
- `pnpm run typecheck` / `pnpm run build` from the same code snapshot:
  PASS; post-script-wiring independent+whole-project typecheck is rerun
  before commit.
- Old 18 `it.fails` regressions remain unmet/unchanged by this phase.
- No schema migration, package dependency installation, live DB mutation,
  R2 tool rewiring, R5 OAuth/token cutover, server restart, push, merge or deploy.

## Operational decision and next dependent work

- **R1 skeleton implementation: DONE. Gate G1 global: NOT PASSED;
  phase status IN_PROGRESS, pending legacy migration.**
- Keep the live service on its existing tested legacy execution path.
- R2 must establish one unified authorization/tool gateway and move its
  affected concrete imports; the SQLite/config/MCP migrations belong
  respectively to R6/R7/R5/R9 per the official backlog. Preserve R0 RED
  tests and do not mark any HIGH finding `VERIFIED_CLOSED`.
- This R1 branch provides independently compilable, fake-adapter-runnable
  foundation; it does not claim production Hexagonal migration is complete.
## Follow-up vertical migration — pure Template Resolver (2026-09-19)

- Actual production source `src/core/runtime/template-resolver.ts` (246 legacy-source lines)
  was relocated to `src/application/services/template-resolver.ts`.
  The original path now only re-exports the exact same function/class objects
  as a compatibility facade, slated for removal with legacy imports in R9.
  No template resolution algorithm or public legacy API was intentionally changed.
- New Application module uses a structural `TemplateStep` contract instead of
  importing the concrete legacy `TaskStep` type from the planner. It remains
  independently typecheckable via `tsconfig.r1.json`.
- `tests/core/r1-template-migration.test.ts` verifies object identity of all
  five legacy exports and structural compatibility with the existing legacy
  `TaskStep` type.
- Focused tests: 59 PASS across legacy resolver, agent-runtime features, loop,
  and new-tree architecture. Full suite: **106 files, 504 PASS + 18 expected
  pre-fix failures** (522 cases); Typecheck (including standalone new tree)
  and Build PASS.
- This moves real pure behavior into the intended Application layer, but
  does not claim R2's unified live tool gateway, eliminate old SQL/config/MCP
  dependencies, resolve the 18 pre-fix HIGH/MED contracts or pass global G1.
- Files changed only within this migration: new application resolver; original
  legacy compatibility facade; dedicated migration tests; R1 report and ledger.

## Follow-up vertical migration — Execution Context and permission/config split (2026-09-19)

- `ExecutionContext` DTO moved inward to `src/application/dto/execution-context.ts`; Node UUID/time creation moved outward to `src/infrastructure/composition/execution-context-factory.ts`. The old `src/core/runtime/execution-context.ts` path is now a compatibility facade.
- Legacy permission ranking/tool requirements moved to `src/application/services/legacy-permission-policy.ts`. Reads of `HOOSHIX_PERMISSION_LEVEL` and `HOOSHIX_DIRECT_AUTO_APPROVE` now live under `src/infrastructure/config/**`; `src/security/permission.ts` and the policy decision point delegate instead of reading environment variables directly.
- Compatibility semantics are preserved: existing tests that mutate `process.env` still observe the same legacy behavior because the config readers read the supplied/current environment at call time.
- Focused regression: 7 files / 40 tests PASS across adversarial approval, permission level, governance, package service and execution-context/correlation behavior. Combined standalone R1 + project Typecheck PASS; Build PASS.
- Literal source inventory now reports `process.env` in nine source paths total; only two are under the new target config directory. Remaining legacy reads are `src/index.ts`, `src/index-http.ts`, `src/core/memory/database/connection.ts`, `src/mcp/http-server.ts`, `src/memory/command-audit.ts`, `src/memory/file-audit.ts`, and `src/security/workspace-guard.ts`. These remain migration debt for R2/R5/R6/R7/R9.
- No production DB migration, tool gateway cutover, server restart, merge, push or deployment occurred.

## Follow-up vertical migration — legacy Task State Machine into Domain (2026-09-19)

- The existing pure transition implementation moved from `src/core/state/task-state-machine.ts` to `src/domain/task/legacy-task-state-machine.ts`; the legacy path is now a compatibility re-export facade.
- Runtime semantics were intentionally preserved, including legacy transitional states such as `created`, `checkpointing`, `resuming` and the current reopen transitions. R3 owns convergence to the final canonical Task aggregate/state model; R1 does not silently change execution semantics.
- Dedicated migration tests verify exact function identity through the old facade and preservation of representative allowed/blocked transitions.
- Focused regression: 21 PASS. Full regression: **107 files / 506 PASS + 18 expected pre-fix failures** (524 cases); combined Typecheck PASS; Build PASS.
- No production DB migration, service restart, tool-gateway cutover, push/merge/tag or deployment.

## Follow-up vertical migration — pure command and action-governance policies (2026-09-19)

- Pure command allowlist/argument validation and the existing command-risk decision table moved to `src/application/services/legacy-command-policy.ts`; `src/security/command-validator.ts` and `src/security/permissions/command-permission.ts` are compatibility facades.
- Pure action-text governance moved from `src/core/governance/governance-engine.ts` to `src/application/services/legacy-action-governance.ts`; the old path is a compatibility facade.
- `policy-decision-point.ts` and `step-governance.ts` now import these application services directly rather than routing through the legacy security/core implementation paths.
- R1 intentionally preserves the current command-decision semantics. The dedicated migration test explicitly proves that `git diff --no-index` is still classified as low-risk/allow, so HIGH-03 remains a visible R2 blocker rather than being silently changed during architecture movement.
- Compatibility test verifies exact old/new function identity. Focused command/governance suite: 28 PASS + 5 expected RED; migration-alias subset: 8 PASS; combined Typecheck PASS.
- No production effect, DB migration, service restart, push/merge/tag or deployment.

## Follow-up vertical migration — Task Planner and Tool Orchestrator (2026-09-19)

- **Status:** VERIFIED bounded R1 migration; global G1 remains `NOT PASSED` while legacy SQL/config/concrete-service/MCP dependencies remain.
- `src/core/planner/task-planner.ts` is now a backward-compatible export facade for `src/application/dto/legacy-task-plan.ts`, `src/application/services/legacy-task-plan-validator.ts`, and `src/infrastructure/composition/legacy-task-plan-factory.ts`. UUID generation is isolated in Infrastructure. The validator retains legacy dependency/template validation and persisted DTO field shapes.
- `src/core/orchestrator/tool-orchestrator.ts` now re-exports `src/application/services/legacy-tool-orchestrator.ts`; direct legacy import sites were redirected where appropriate. This pure legacy selection/metadata migration does **not** substitute for the exhaustive, authorization-enforcing R2 Tool Catalog/Gateway; legacy `executeToolStep` still delegates to its passed executor.
- Tests: `tests/core/r1-task-planner-migration.test.ts` and `tests/core/r1-tool-orchestrator-migration.test.ts` assert exact facade export identities and representative legacy behavior. Focused suite: 3 files / 8 PASS including strict new-tree boundary test; independent Domain/Application compile PASS; combined Typecheck PASS; Build PASS.
- Full regression: **110 files / 515 PASS + 18 expected RED (533 total)**; no unexpected failures. `git diff --check` PASS.
- Scope: application/Infrastructure migration plus import re-pointing, with legacy APIs preserved. No production DB schema mutation, OAuth/Task lease/approval redesign, service restart, deployment, push or merge. All audit finding states unchanged.
- Residual: existing callers and MCP transport still use legacy execution semantics; R2/R3/R5/R6/R7/R9 own the final gateway, durable execution, transport, persistence, configuration and deletion of compatibility facades.

## Follow-up vertical migration — lazy legacy runtime path configuration (2026-09-19)

- `src/infrastructure/config/legacy-runtime-paths.ts` now reads the two existing
  path variables (`HOOSHIX_DB_PATH`, `HOOSHIX_LOG_DIR`) at invocation time.
  Defaults and environment changes during test/bootstrap are preserved.
- `src/core/memory/database/connection.ts`, `src/memory/command-audit.ts`,
  and `src/memory/file-audit.ts` consume this infrastructure configuration
  provider. Direct environment reads were removed from these three modules;
  database initialization, audit log format, and the redaction algorithm were
  not otherwise changed.
- `tests/core/r1-runtime-path-config-migration.test.ts` tests explicit config
  injection, lazy DB-path changes without opening the primary DB, and actual
  command/file audit output in separate disposable log directories.
  Focused validation (5 files / 18 tests) PASS, combined independent/core
  Typecheck PASS. Full-suite and Build evidence belongs to the execution
  record in the progress ledger after revalidation.
- Remaining global G1 blockers still include legacy Workspace env/unrestricted
  bootstrap, HTTP/OAuth/session configuration, entrypoint retention settings,
  SQL in legacy non-adapter modules and concrete service/transport imports.
  These require the assigned R2–R9 changes and are not marked resolved by
  this path-only refactor. No live DB/HTTP/Task gateway mutation, process
  restart, push, merge or deployment is performed.

## Follow-up vertical migration — Workspace bootstrap environment isolation (2026-09-19)

- `src/security/workspace-guard.ts` no longer reads `process.env` directly.
  `src/infrastructure/config/legacy-workspace-bootstrap.ts` reads the same
  `HOOSHIX_WORKSPACE` CSV and `HOOSHIX_UNRESTRICTED` literal "1"/"true"
  values **at the existing lazy bootstrap point**, preserving current behavior.
- `tests/core/r1-workspace-bootstrap-config-migration.test.ts` verifies the
  old trim/opt-in semantics and source isolation. Focused Workspace/Task
  regression: six files, 16 PASS + one expected RED (existing HIGH-01);
  combined standalone and whole-project Typecheck PASS.
- **Security caveat:** relocating environment access does not implement
  principal-scoped authorization, revocation or the R2 unrestricted triple
  authorization. The original operator/bootstrap trust behavior is unchanged.
- No production database migration, Task mutation, service restart or deployment
  was performed. Legacy MCP/HTTP/entrypoint environment/config and SQL/concrete
  dependencies still prevent global G1 PASS.
