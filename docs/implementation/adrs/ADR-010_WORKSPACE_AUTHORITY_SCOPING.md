# ADR-010 — Workspace Authority Is Principal/Task Scoped, Not Global

**Status:** Accepted  
**Date:** 2026-09-06

## Context
The audit confirmed that workspace authorization currently depends on mutable process-global state and that direct workspace-management calls can widen scope without the same unavoidable authorization path used elsewhere. Persisted Task execution context also was not consistently authoritative across handlers.

## Decision
- Direct calls use a workspace context keyed to authenticated principal/session.
- Task creation captures and persists an immutable `WorkspaceScope` copied from the caller's authorized context.
- Existing Task scope never changes because a later direct workspace-management call occurs.
- Scope expansion is an explicit application operation handled through the centralized authorization service.
- `unrestricted` requires all of: server `allowUnrestricted=true`, ADMIN effective permission, explicit human approval bound to the exact scope mutation, and a security audit event.
- Outbound filesystem/process adapters receive the effective scope/context from Application. They may add defense-in-depth checks but cannot widen authority.
- Modern MCP transport session identifiers are not an application authorization boundary; HTTP workspace context is principal/logical-context scoped according to document 31.

## Alternatives considered
- Keep module-level global roots/unrestricted state: rejected because it creates cross-session/task authority drift.
- Treat workspace as a presentation-only convenience: rejected because it is a security boundary.
- Let adapters decide scope independently: rejected because it recreates the audited fragmented-policy defect.

## Consequences
- Removes ambient global authorization state.
- Makes direct HTTP multi-session behavior deterministic.
- Makes task recovery use the exact persisted authorization scope.
- Requires a workspace-context repository/port and migration/cutover from the legacy global guard.

## Findings
HIGH-01, HIGH-02 context, MED-04, MED-28, architecture root cause A/G.

## Validation
- two principals/sessions cannot mutate each other's direct workspace context;
- changing direct context does not alter an existing Task's scope;
- unrestricted mutation fails unless server flag + ADMIN + exact approval are all present;
- no Domain/Application code imports the legacy global workspace guard.
