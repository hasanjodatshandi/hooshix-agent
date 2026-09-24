# HooshiX Architecture

This document describes the deployed architecture. It is a companion to the executable boundary tests in `tests/core/r1-strict-boundary.test.ts`, `r0-architecture-boundary.test.ts` and `r9-adapter-boundary.test.ts` — if this document and those tests disagree, **the tests are correct**.

## Layering

```
src/domain/            Pure enterprise model. Zero outward imports.
src/application/       Use cases + ports. Imports domain and application only.
src/adapters/inbound/  Transport: MCP/HTTP and MCP/stdio. Only place the MCP SDK may be imported.
src/adapters/outbound/ Concrete adapters: SQLite, filesystem, git, process, package, auth, observability.
src/infrastructure/    config/ (the single env reader), composition/ (wiring), server/ (scheduler).
src/core/              Runtime engine: executor, governance, loop, recovery, trace.
src/security/          workspace-guard, command-validator, sensitive-path gating.
src/services/          Concrete outbound implementations (filesystem, git, shell, package).
src/mcp/               Transport surface: server.ts, http-server.ts, oauth.ts, registry.ts.
src/tools/             Per-tool schema registrations (schema only — no service imports).
```

`src/index.ts` (stdio) and `src/index-http.ts` (HTTP) are the two entrypoints.

## Dependency rules — enforced, not aspirational

| Rule | Enforcement |
|---|---|
| `domain/` may import only inside `domain/` | `r1-strict-boundary.test.ts` |
| `application/` may import only `domain/` and `application/` | `r1-strict-boundary.test.ts` |
| `adapters/inbound/**` may never import `adapters/outbound/` | `r1-strict-boundary.test.ts`, `r0-architecture-boundary.test.ts` |
| `@modelcontextprotocol/*` importable only in `adapters/inbound/mcp/` | `r1-strict-boundary.test.ts` |
| `process.env` only in `infrastructure/config/` or `bootstrap/` | `r1-strict-boundary.test.ts` |
| Raw SQL only in `adapters/outbound/persistence/sqlite/` | `r1-strict-boundary.test.ts`, `r9-adapter-boundary.test.ts` |

The global gate `scripts/verify-g1-global.mjs --strict` re-scans the whole tree on demand.

## ExecuteToolUseCase — the single gateway

All tool effects, whether from a direct MCP call or a task step, meet at exactly one use case (`src/application/use-cases/tools/execute-tool.usecase.ts`). It guarantees:

- Exactly one of `directContext` / `taskContext`, else `ambiguous_or_missing_execution_context`.
- Workspace scope resolved from the trusted repository/session, **never from tool args** — a spoofed `scope` in args is `blocked`.
- Task scopes are immutable captured state, not the caller's current workspace.
- Unknown tool → `blocked`; malformed args → `blocked` without invoking the handler.
- Authorization and the server permission ceiling are enforced before any outbound port.
- No mutation dispatches without a verified approval; approval is never accepted from args, only a persisted, single-use approval bound to exact task/step/tool/args/scope.
- Post-effect audit failure → `observabilityDegraded`, never a failure that could trigger a retry.

`tests/core/r2-execute-tool-gateway.test.ts` and `r2-no-alternate-inbound-execution.test.ts` pin all of the above, and assert that every tool registration goes through `createR2RuntimeGateway`.

## OperationCatalog

`src/application/services/operation-catalog.ts` is the one registry: 53 descriptors (`TOOL_NAMES` 30 + `CONTROL_TOOL_NAMES` 23), frozen, one per externally registered operation including the control plane. It fails closed on unknown and prototype-looking names (`__proto__`, `toString`, `constructor`). See `docs/TOOLS.md`.

## Composition root

- `src/core/runtime/composition-root.ts` — `createRuntimeDependencies()` / `createTaskRuntimeService()` constructs the trace, recovery, observability and tool-executor wiring.
- `src/infrastructure/composition/r2-runtime-gateway.ts` — `createR2RuntimeGateway(handler)` injects the concrete catalog, validator, authorization, workspace, operation policy, approvals, audit and security-event ports into `ExecuteToolUseCase`.
- `src/infrastructure/composition/r1-application-composition.ts` — the test composition using in-memory adapters; no service locator, no process/env/global IO.

No other module constructs concrete adapters.

## Retained compatibility shims

A small number of legacy-named modules remain as pure aliases with an explicit expiry owner/date (see `docs/implementation/29_IMPLEMENTATION_PROGRESS_LEDGER.md` R9.03): the four `core/memory/*` facades and `legacy-sdk-bridge.ts`. `tests/core/r9-compat-shims-are-pure-aliases.test.ts` asserts they stay pure aliases; the four `infrastructure/config/legacy-*` shims import nothing but `app-config.ts`.
