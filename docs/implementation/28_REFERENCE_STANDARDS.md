# Current Reference Standards & Authoritative Documentation

**Purpose:** external normative/current references that the implementing assistant must re-check before version-sensitive implementation work.  
**Last verified for this package:** 2026-09-06.

This file does not replace the standards themselves. When a current official source changes, implementation follows the newer authoritative source and records the delta in the progress ledger/ADR before coding.

---

## 1. MCP / TypeScript SDK — highest version-sensitive priority

### MCP 2026-07-28 release
`https://blog.modelcontextprotocol.io/posts/2026-07-28/`

Verified package implications:
- 2026-07-28 is the modern protocol era;
- stateless protocol core;
- Multi Round-Trip Requests;
- header-based routing and cacheable list changes;
- authorization hardening;
- updated Tier-1 SDKs.

### TypeScript SDK v2
`https://ts.sdk.modelcontextprotocol.io/v2/`

Verified:
- v2 is the stable line implementing 2026-07-28;
- monolithic v1 package is replaced by split packages.

### Upgrade v1 -> v2
`https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2`

Verified:
- official codemod exists;
- run at repository root, then inspect unresolved markers;
- staged v1/v2 coexistence is possible;
- v1 and v2 objects must not be mixed across runtime boundaries;
- server/client package imports change.

### Supporting 2026-07-28
`https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28`

Verified:
- modern HTTP serving uses current v2 handler patterns such as `createMcpHandler`;
- modern stdio uses `serveStdio`;
- 2026 authorization opt-ins include RFC 9207 issuer handling and current credential/scope hardening behavior;
- protocol eras have different wire behavior and are handled by the v2 SDK.

### Protocol versions
`https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions`

Verified:
- 2024-10-07 through 2025-11-25 are the legacy era;
- 2026-07-28 is the modern era;
- modern protocol does not use the old initialize/session model in the same way.

**Implementation rule:** re-open these pages immediately before R1/R5 and update document 31 if APIs/recommendations changed.

---

## 2. Hexagonal / Clean Architecture

### Alistair Cockburn — original Hexagonal Architecture
`https://alistair.cockburn.us/hexagonal-architecture/`

Adopted principle:
- application logic is isolated from UI/database/devices;
- technology-specific adapters translate at ports;
- application can be regression-tested independently of external runtime devices.

### Microsoft Learn — Architectural principles
`https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles`

Adopted principles:
- separation of concerns;
- dependency inversion toward abstractions;
- explicit dependencies instead of hidden globals.

### Microsoft Learn — Clean Architecture overview
`https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures`

Adopted principle:
- business/application core is central;
- infrastructure/implementation details depend on the application core, not vice versa.

These references guide dependency direction; TypeScript implementation details remain project-specific.

---

## 3. OAuth / HTTP authorization

### RFC 9700 — OAuth 2.0 Security Best Current Practice
`https://www.rfc-editor.org/rfc/rfc9700.html`

Adopted:
- secure authorization-code flow/PKCE practices;
- exact redirect handling and mix-up defenses;
- current token/replay security guidance;
- avoid deprecated/insecure OAuth patterns.

### RFC 9207 — Authorization Server Issuer Identification
`https://www.rfc-editor.org/rfc/rfc9207.html`

Adopted:
- `iss` issuer identification/validation for authorization responses where required by MCP/SDK profile.

### RFC 8707 — Resource Indicators for OAuth 2.0
`https://www.rfc-editor.org/rfc/rfc8707.html`

Adopted:
- bind/request access authority for the intended protected resource.

### RFC 9728 — OAuth 2.0 Protected Resource Metadata
`https://www.rfc-editor.org/rfc/rfc9728.html`

Adopted:
- protected-resource metadata/discovery behavior required by current MCP authorization profile.

### RFC 10017 — OAuth 2.0 for Browser-Based Applications (BCP, August 2026)
`https://www.rfc-editor.org/rfc/rfc10017.html`

Adopted where browser dashboard OAuth/session architecture is relevant. The dashboard may use a server-side operator session rather than expose bearer tokens to browser storage/URLs.

---

## 4. OWASP application-security verification

### OWASP ASVS 5.0.0
`https://owasp.org/www-project-application-security-verification-standard/`

Current stable version verified: **5.0.0**, released 2025-05-30.

Use as a verification cross-reference particularly for:
- input/business-logic validation;
- API/web-service security;
- file handling;
- authentication/session/authorization;
- self-contained token/OAuth controls where applicable;
- configuration/data protection;
- security architecture/dependencies;
- security logging/error handling;
- resource-demand/availability controls.

Do not claim full ASVS certification unless every selected requirement has explicit mapped evidence. This package uses ASVS as verification guidance, not as a certification statement.

---

## 5. SQLite

### WAL
`https://www.sqlite.org/wal.html`

Adopted facts:
- WAL permits readers with a writer;
- only one writer at a time;
- shared-memory constraints mean same-machine usage.

### Appropriate Uses
`https://www.sqlite.org/whentouse.html`

Adopted:
- SQLite is appropriate for local embedded/application storage;
- many concurrent writers may justify client/server DB only when actual requirement/evidence exists.

### Isolation / busy timeout / query planning
`https://www.sqlite.org/isolation.html`  
`https://www.sqlite.org/c3ref/busy_timeout.html`  
`https://www.sqlite.org/queryplanner.html`

Use for migration/concurrency/index design.

**Project decision:** keep SQLite for current design scale; add execution lease for correctness; benchmark before database replacement.

---

## 6. Prometheus

### Exposition formats
`https://prometheus.io/docs/instrumenting/exposition_formats/`

Adopted:
- HELP/TYPE identify the metric name;
- only one HELP/TYPE per metric family;
- labels belong to sample syntax;
- correct content type required by modern Prometheus scraping.

### Writing client libraries
`https://prometheus.io/docs/instrumenting/writing_clientlibs/`

Use for exporter/client-library behavior and stable exposition design.

---

## 7. Docker

### Build best practices
`https://docs.docker.com/build/building/best-practices/`

Adopted:
- multi-stage builds;
- non-root `USER` when privilege is unnecessary;
- image tags are mutable;
- digest pinning provides immutable build provenance, with an update process required;
- build/test automation and minimal build context.

Project-specific additional requirement:
- `pnpm install --frozen-lockfile` must fail closed; no fallback.

---

## 8. GitHub Actions

### Secure use reference
`https://docs.github.com/en/actions/reference/security/secure-use`

Adopted:
- least-privilege workflow permissions;
- pin third-party actions/workflows to full-length commit SHA for immutable references;
- audit action behavior around source/secrets;
- protect untrusted PR data from command injection/secrets.

---

## 9. Vitest / TypeScript

### Vitest v4 coverage
`https://v4.vitest.dev/config/coverage`

Adopted:
- global thresholds plus per-file/per-glob thresholds available;
- critical application/security/recovery code should use focused thresholds rather than only a global headline.

### Vitest workers
`https://v4.vitest.dev/config/maxworkers`

Use when completing test fixture isolation before increasing parallelism.

### TypeScript strict
`https://www.typescriptlang.org/tsconfig/strict`

Preserve strict mode and existing unused/casing checks.

---

## 10. Node.js process/event-loop/runtime guidance

Use current official Node.js documentation at implementation time for:
- child process cancellation/AbortSignal semantics;
- filesystem atomic/fsync behavior;
- event-loop blocking guidance;
- file creation mode/permissions;
- graceful shutdown/signals.

Because Node 24+ APIs can evolve, the implementer must verify current Node 24/declared project version docs before relying on exact cancellation or filesystem behavior.

---

## 11. Git semantics

Use current official Git docs:
`https://git-scm.com/docs/git-reset`  
`https://git-scm.com/docs/git-clean`  
`https://git-scm.com/docs/git-diff`

Adopted:
- `reset --hard`/`clean -fd` are destructive to working-tree/untracked state;
- `--no-index` changes diff scope beyond repository comparison;
- command policy must inspect semantics/arguments, not only first subcommand.

---

## 12. Reference update procedure

Before each version-sensitive phase:
1. open the current official page;
2. compare relevant requirement/API to this package;
3. if unchanged, record “verified current” in progress ledger;
4. if changed, update the affected implementation spec and add/supersede ADR if design changes;
5. do not use secondary blogs when an official specification/SDK/RFC/source exists.

The implementation assistant must never cite this reference file as proof that an external API has not changed since 2026-09-06.