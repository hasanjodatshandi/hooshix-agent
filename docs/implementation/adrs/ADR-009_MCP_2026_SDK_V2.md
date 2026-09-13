# ADR-009 — MCP TypeScript SDK v2 & 2026-07-28 Modern Protocol

**Status:** Accepted target; compatibility window finalized during R1/R5 interoperability verification  
**Date:** 2026-09-06

## Context
Current HooshiX uses monolithic MCP TypeScript SDK v1.30.0 and 2025-era session-oriented server patterns. Official SDK v2 is now the stable line implementing protocol revision 2026-07-28. The modern era has a stateless protocol core, different discovery/version behavior, updated auth hardening and split packages. The architecture redesign must not recreate obsolete transport-session assumptions.

## Decision
- Migrate production MCP server to official SDK v2 split packages.
- Make 2026-07-28 modern protocol the primary target.
- HTTP uses the current official v2 modern handler pattern (`createMcpHandler` or superseding current API); stdio uses `serveStdio` or superseding current API.
- Application correctness/state is not keyed solely by `Mcp-Session-Id`.
- HooshiX durable Tasks remain application-level tools/use cases, not dependent on deprecated protocol task wire vocabulary.
- Enable the current 2026 auth conformance opt-ins (including RFC 9207 issuer behavior and scope/credential protections) according to official SDK docs.
- A bounded legacy 2025 compatibility mode may be retained only if current supported clients require it and the v2 server can serve it safely; this is adapter-only and may not change application semantics.

## Alternatives
- Stay on v1 until later: rejected because owner requires latest docs and full redesign now; v2 migration aligns naturally with adapter boundaries.
- Support only modern immediately with no interoperability check: rejected until actual ChatGPT/client compatibility is verified.
- Use transport session as workspace identity: rejected because modern core is stateless.

## Consequences
Dependency/import churn, E2E changes, possible client reauthorization and proxy/header updates. Staged v1+v2 coexistence is permitted during migration, with strict no-crossing of SDK object instances. Final code removes v1.

## Findings
HIGH-04, HIGH-11/12 integration, MED-22, MED-28, MED-29; architecture owner directive.

## Validation
Official current docs rechecked before implementation; v2 modern HTTP and stdio E2E; auth issuer/scope tests; zero monolithic v1 imports after cutover; protocol compatibility doc current.