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
