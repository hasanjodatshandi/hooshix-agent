# R1 — G1 architecture gate completion evidence
Date: 2026-09-20
Project: HooshiX Brain, D:/workspace/hooshix-agent
Branch: feature/r1-hexagonal-foundation-2026-09-19

## Gate decision
**R1 GATE_PASSED — G1 PASS for the R1 architecture-boundary acceptance scope.**
This does not approve an R2 unified authorization gateway, MCP SDK v2 upgrade,
removal of the legacy runtime, production deployment, or closure of the 54
security/reliability findings. Existing code still exposes legacy tool/service
shortcuts that are explicitly owned by R2 and R9.

## Implementation
- R1.01–R1.05: independently compilable Domain and Application, branded IDs,
  Task/Step/Approval/Workspace/Execution Receipt invariants, application-owned
  ports and use-case contracts, fake-adapter runnable composition, and target
  adapter/bootstrap directories. Existing source behavior was preserved.
- R1.06: the strict global scanner, `scripts/verify-g1-global.mjs --strict`,
  now checks the **entire** `src` tree for direct MCP SDK imports outside
  `adapters/inbound/mcp`, raw SQL outside the canonical SQLite adapter or
  migrations, `process.env` outside config/bootstrap and forbidden target-layer
  imports. The standalone Domain/Application compilation and
  `tests/core/r1-strict-boundary.test.ts` check layer independence.
- Real SQLite persistence and query implementations were moved into
  `src/adapters/outbound/persistence/sqlite/**` with compatibility facades
  where necessary. No new live SQLite schema migration was performed.
- Eight remaining legacy tool-registration modules now import the
  **type-only** `McpServer` from
  `src/adapters/inbound/mcp/legacy-sdk-bridge.ts`. This is SDK **v1**
  isolation, not an SDK v2 upgrade; tool names, registration schemas and
  callback behavior are unchanged.
- Legacy ToolHandler concrete constructors moved to
  `src/infrastructure/composition/legacy-tool-handler-composition.ts`.
  `src/core/executor/handlers/dispatcher-factory.ts` now injects a provided
  handler list; the old public import path remains a compatibility facade.
  `tests/core/r1-legacy-handler-composition.test.ts` verifies fake-handler
  dispatch and construction location.

## Executed acceptance evidence
- `node scripts/verify-g1-global.mjs --strict` => PASS; 166 source files,
  zero currently detected candidates in all reported categories.
- `tests/core/r1-global-architecture-gate.test.ts` is a permanent test
  asserting strict global G1 scan exit 0 and no candidates. Together with
  the standalone compile and fake-adapter tests, it prevents these documented
  boundaries from silently regressing.
- `pnpm run typecheck:r1` and `pnpm run typecheck` => PASS; the latter
  includes independent Domain/Application and whole-project compilation.
- `pnpm exec vitest run` after the final compatibility correction => PASS:
  119 files, 542 passing, 18 **expected-failing pre-fix contracts**
  (560 total), no unexpected failures. The expected failures remain unresolved.
- `pnpm run build` => PASS.
- The previous failed intermediate run resulted from a new test expecting
  a synchronous dispatcher error as a rejected Promise. The test was
  corrected to assert the established synchronous API; the **full suite**
  was rerun afterward and passed. Older successful runs are not substituted
  for the final code snapshot.

## Boundaries and explicit residual risk
The global scanner is a conservative source-pattern check, not a full
AST-level proof of arbitrary dynamic import/dependency behavior; it also
checks new-target-layer direct imports separately. Production direct MCP and
Task execution still use legacy adapters and separate authorization paths.
Eliminating those actual execution shortcuts and completing effective
principal/workspace/approval checks are mandatory **G2/R2**, not verified
by this G1 result. Durable execution/fencing (R3), SDK v2/HTTP OAuth (R5),
full persistence/observability (R6), legacy deletion (R9) and release gates
through G10 remain independent. Nothing in R1 changes live service state,
marks an HIGH/MED/LOW finding VERIFIED_CLOSED, or authorizes deployment.

## Git and operational isolation
Commit the reviewed R1 changes only to the dedicated feature branch.
Do not push, merge to main, tag, restart the running service, or alter the
primary database as part of this phase. R2 may begin after the final
stage/commit/clean-tree check confirms the candidate code and this record.
