# MCP 2026-07-28 Protocol & TypeScript SDK v2 Migration Specification

**Status:** normative implementation target based on current official MCP/TypeScript SDK documentation as of 2026-09-06.  
**Primary impact:** inbound MCP adapters, HTTP/stdio serving, OAuth/authentication integration, request context, protocol compatibility, tests, dependencies and final documentation.  
**Primary audit links:** HIGH-04, HIGH-11, HIGH-12, MED-22, MED-29, MED-28; architecture owner directive §31.

---

## 1. Current external baseline

HooshiX currently uses the v1 monolithic package `@modelcontextprotocol/sdk@1.30.0` and 2025-era server patterns.

The current official TypeScript SDK line is **v2**, split into packages including:
- `@modelcontextprotocol/server`
- `@modelcontextprotocol/client`
- `@modelcontextprotocol/core`
- Node/framework adapters as documented by the SDK.

The v2 SDK is the stable line implementing the **2026-07-28** MCP specification.

Official migration guidance provides:
- a v1 -> v2 codemod;
- staged side-by-side migration support;
- modern HTTP serving via `createMcpHandler(...)`;
- modern stdio serving via `serveStdio(...)`;
- protocol-version negotiation supporting legacy 2025 and modern 2026 eras;
- additional 2026 authorization opt-ins such as RFC 9207 issuer handling and scope-step-up behavior.

---

## 2. Why this migration is part of the architecture redesign

This is not a dependency-only upgrade.

The 2026-07-28 protocol changes transport assumptions that intersect directly with audited architectural debt:

- the modern protocol core is stateless at the wire level;
- modern clients discover the server rather than using the old initialize/session model;
- modern request routing/context uses per-request metadata/header mechanisms;
- authorization hardening includes issuer/scope/credential-isolation requirements;
- deprecated legacy logging/sampling/root/task wire concepts must not become new design dependencies;
- TypeScript SDK v2 splits the monolithic package, naturally enforcing clearer adapter boundaries.

Therefore the final Hexagonal/Clean architecture must adopt MCP v2 in the inbound adapter/infrastructure layer rather than rebuild old v1 session assumptions.

---

## 3. Protocol-era terminology

Use the SDK's current conceptual eras:

### Legacy era
Protocol revisions from 2024-10-07 through 2025-11-25 share the older initialization/session-oriented behavior.

### Modern era
`2026-07-28` uses the modern protocol behavior. The final HooshiX production target is modern 2026.

HooshiX may temporarily serve legacy requests during migration only if ADR-009 explicitly approves the compatibility window.

---

## 4. Target serving architecture

### HTTP

Use the current official v2 server entry point/pattern such as `createMcpHandler(factory)` according to the SDK migration guide.

Target flow:

```text
Node HTTP infrastructure / auth middleware
 -> validated Principal + request metadata
 -> MCP v2 createMcpHandler server factory
 -> HooshiX inbound MCP adapter
 -> application use cases
```

Modern protocol handling must not depend on `Mcp-Session-Id` as the application correctness boundary.

### Stdio

Use the official v2 `serveStdio(() => buildServer())` path for modern protocol serving.

Transport construction and MCP types remain in inbound/infrastructure code only.

---

## 5. Application context vs transport session

A critical design rule:

> HooshiX application state must not be keyed solely by a transport session that disappears in the modern stateless protocol.

### Workspace context

For direct HTTP operations, choose one explicit application identity model:
- authenticated `PrincipalId` for operator-owned personal context; or
- an explicit HooshiX logical context identifier transported through a secure, integrity-protected application mechanism if multiple contexts per principal are required.

Do **not** use `Mcp-Session-Id` as the new workspace context key.

Stdio can use one stable local context ID created by composition.

Durable Tasks always carry their own immutable persisted WorkspaceScope and never depend on the current transport context after creation.

### Request state

If SDK modern `requestState`/multi-round-trip state is used, treat client-provided state as untrusted. Integrity/authenticity requirements from official docs apply. Business authorization/session data must still come from server-owned repositories/principal context.

---

## 6. Multi Round-Trip Requests and HooshiX Tasks

The MCP 2026 specification introduces Multi Round-Trip Request capabilities and changes/deprecates some older wire concepts.

HooshiX's existing durable Task system is an **application-level workflow feature**. Do not automatically rewrite HooshiX Tasks to rely on deprecated/experimental MCP wire task vocabulary.

Policy:
- keep HooshiX Task tools/use cases as ordinary application-exposed MCP tools unless a separate ADR proves a modern MCP extension is beneficial;
- do not couple durable execution/recovery semantics to an SDK feature scheduled for deprecation;
- multi-round-trip MCP can be used for protocol-native interaction where useful, but Task persistence/approval/reconciliation stays in the application domain.

---

## 7. Deprecated MCP subsystems

Current SDK v2 documentation marks several older subsystems/APIs deprecated for the 2026-era direction, including portions of logging/sampling/roots/task wire vocabulary.

HooshiX migration must:
- grep current code/tests for deprecated SDK APIs after codemod;
- not introduce new dependency on deprecated protocol-native logging when project audit/metrics already have a stronger application observability model;
- prefer stderr/OpenTelemetry-compatible or HooshiX observability ports according to current SDK guidance;
- document any legacy-era feature retained solely for compatibility.

---

## 8. v1 -> v2 package migration procedure

### Step 1 — baseline
- record current v1 package/import inventory;
- run current build/tests before dependency changes.

### Step 2 — codemod on a controlled changeset
Official guide recommends the v1-to-v2 codemod at repository root so manifests/tests/scripts are included.

Use the codemod only after baseline is recorded. Review every change; do not accept it blindly.

Search for `@mcp-codemod-error` markers and resolve manually.

### Step 3 — staged package coexistence
If needed, keep v1 and v2 packages temporarily.

Strict rule:
- v1 SDK object instances/types do not cross into v2 runtime objects;
- compatibility occurs at HooshiX application DTO/use-case boundaries, not by mixing SDK internals.

### Step 4 — migrate inbound adapters
- stdio;
- HTTP;
- tool registration/schema mapping;
- auth middleware/integration;
- tests/helpers.

### Step 5 — cut over production composition
Only after v2 E2E and architecture gates pass.

### Step 6 — remove v1
- grep zero imports of `@modelcontextprotocol/sdk` in production/tests/scripts that should be migrated;
- remove v1 dependency;
- frozen install/build/test;
- update lockfile intentionally;
- record versions in release provenance.

---

## 9. Modern HTTP stateless requirements

Final architecture:
- no correctness assumption that a transport session object survives across calls;
- no unbounded `Map<sessionId,McpServer>` required for modern operation;
- authorization evaluated per request/principal/application state;
- durable state stored through repositories;
- server instances/factories follow official handler lifecycle;
- modern cancellation and per-request stream behavior handled through SDK contracts;
- header/metadata routing preserved through trusted infrastructure/proxy configuration.

If legacy 2025 support is enabled by the v2 handler, any legacy session object/map is adapter-only, bounded, TTL-pruned, and excluded from application authority state.

---

## 10. Authentication hardening for 2026

Enable/implement the current official v2 auth options required for 2026 conformance, including where applicable:
- RFC 9207 authorization response issuer handling/validation;
- credential isolation protections;
- insufficient-scope step-up/reauthorization behavior;
- discovery state/issuer persistence requirements described by SDK v2;
- TLS/resource/audience validation required by MCP authorization profile.

HooshiX's own issued opaque access/refresh token model in document 10 remains the security policy. SDK/protocol integration must not reintroduce the bootstrap/master token as client bearer.

Do not infer future MCP authorization requirements from memory; implementation assistant must re-open the current official SDK/spec pages before coding this phase.

---

## 11. Protocol negotiation policy

Recommended release target:
- **modern 2026-07-28 preferred/primary**;
- optionally serve 2025 legacy stateless compatibility for a bounded migration period if supported safely by `createMcpHandler` and required by ChatGPT/client interoperability;
- no undocumented custom version hacks.

ADR-009 records the final compatibility choice.

Tests must exercise:
- modern negotiation/serving;
- allowed legacy negotiation if retained;
- intentionally unsupported era returns clear protocol failure;
- application semantics identical regardless of supported wire era.

---

## 12. Host/proxy/header behavior

External edge/proxy deployment (owned by the separate deployment project) must:
- preserve Authorization and required MCP headers;
- not log bearer tokens;
- preserve Content-Type/Accept requirements;
- route modern requests without relying on sticky transport sessions;
- use configured canonical public URL for resource/issuer metadata;
- reject Host/origin abuse as documented in HTTP security spec.

SDK v2 tightened media-type validation; E2E clients/tests must send proper `Content-Type: application/json` where required.

---

## 13. Tool registration redesign

MCP v2 adapter registers tools from canonical HooshiX OperationCatalog/schema mapping.

Requirements:
- MCP descriptor metadata generated from canonical catalog where appropriate;
- adapter Zod schema is not authorization policy;
- callback translates request -> application command -> response mapping only;
- every callback gets Principal/request context from infrastructure auth boundary;
- no callback imports filesystem/Git/package/SQLite adapter.

Catalog completeness tests must be rerun after SDK migration.

---

## 14. Test migration requirements

### SDK migration tests
- codemod leaves no unresolved markers;
- TypeScript/build passes;
- stdio v2 server works with v2 client fixture;
- modern HTTP v2 handler works with v2 client fixture;
- application fake-adapter tests unaffected by SDK version.

### Protocol tests
1. modern 2026 server discovery/connection succeeds;
2. supported legacy connection succeeds only if compatibility enabled;
3. modern request does not require/derive correctness from Mcp-Session-Id;
4. request cancellation behavior maps to application execution cancellation safely;
5. tools list/call uses canonical schemas;
6. correct Content-Type/Accept behavior;
7. auth issuer/scope/resource behaviors according to current v2 docs;
8. proxy/header fixture preserves required fields;
9. workspace context isolation uses application identity, not transport session;
10. no deprecated SDK logging/sampling feature is required for core runtime.

---

## 15. Dependency architecture rules after migration

Allowed imports:
- `@modelcontextprotocol/server` only under inbound MCP/infrastructure server boundary;
- `@modelcontextprotocol/core` only in adapter code where protocol types are truly required;
- `@modelcontextprotocol/client` only tests/tools that act as MCP clients;
- no MCP packages in Domain/Application.

Architecture CI fails if monolithic `@modelcontextprotocol/sdk` remains after final cutover.

---

## 16. Release documentation

Generate/update `docs/PROTOCOL_COMPATIBILITY.md` with:
- SDK v2 exact pinned package versions;
- primary MCP revision 2026-07-28;
- legacy era support window if any;
- stateless modern HTTP model;
- stdio mode;
- auth conformance options enabled;
- known unsupported/deprecated protocol features;
- proxy/header requirements.

README should link to this document rather than reproduce protocol internals.

---

## 17. Current official references

Implementation assistant must verify current versions/pages immediately before implementation:

- MCP 2026-07-28 release overview: `https://blog.modelcontextprotocol.io/posts/2026-07-28/`
- TypeScript SDK v2 home: `https://ts.sdk.modelcontextprotocol.io/v2/`
- v1 -> v2 upgrade: `https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2`
- 2026-07-28 support/migration: `https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28`
- protocol-era documentation: `https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions`

If these pages supersede any detail in this document, update this spec/progress ledger with the verified current requirement before coding rather than relying on stale text.

---

## 18. Definition of done

- production MCP server uses SDK v2 split packages;
- modern 2026-07-28 HTTP and stdio E2E pass;
- modern HTTP application correctness does not depend on transport sessions;
- auth issuer/scope/current spec opt-ins enabled and tested;
- v1 package removed after zero-import proof;
- no deprecated protocol subsystem is introduced as a new core dependency;
- OperationCatalog remains the only tool policy source;
- protocol compatibility doc is current;
- clean frozen build/test/CI passes.