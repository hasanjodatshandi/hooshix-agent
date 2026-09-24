# MCP Protocol Compatibility

This document states the exact SDK and protocol versions shipped. The registry and negotiation code are the source of truth; `tests/core/r1-strict-boundary.test.ts` enforces that the MCP SDK may only be imported inside `src/adapters/inbound/mcp/`.

## SDK packages

| Package | Version | Role |
|---|---|---|
| `@modelcontextprotocol/server` | 2.0.0 | Server + stdio transport (production) |
| `@modelcontextprotocol/node` | 2.0.0 | Node streamable HTTP transport (production) |
| `@modelcontextprotocol/client` | 2.0.0 | Test client (dev) |
| `@modelcontextprotocol/sdk` | 1.30.0 | Legacy monolithic SDK — **still present**; see below |

**Open item (checklist §3.2):** the monolithic v1 SDK remains a production dependency and `tests/helpers/mcp-client.ts` still imports `@modelcontextprotocol/sdk/client/stdio.js`. Production code is fully migrated to the v2 split packages; the dependency and the test helper are not. This must reach zero v1 imports before release.

All v2 imports are funneled through `src/adapters/inbound/mcp/legacy-sdk-bridge.ts`, which re-exports `McpServer`, `NodeStreamableHTTPServerTransport` (as `StreamableHTTPServerTransport`) and `StdioServerTransport`.

## Protocol versions

| Version | Status |
|---|---|
| `2026-07-28` | **Primary.** The HTTP server branches on the `mcp-protocol-version: 2026-07-28` header; modern requests are POST-only (405 `modern_post_only` otherwise) and subject to the context cap (429 `modern_context_limit`). |
| `2025-06-18` | **Legacy, adapter-only.** Supported for compatibility, negotiated via raw `initialize`. Must not change application semantics. |

Governing decision: `docs/implementation/adrs/ADR-009_MCP_2026_SDK_V2.md` (MCP TypeScript SDK v2 & 2026-07-28 Modern Protocol, accepted 2026-09-06).

## Session semantics

Modern HTTP does not depend on `Mcp-Session-Id` for application correctness. Principal context is bound to the HTTP transport (`HttpPrincipalContexts`), with caps (64 contexts / 30 minutes idle / 8 hours max) proven by a fake-clock regression.

## Auth

Current official MCP auth opt-ins are enabled and tested: RFC 9207 `iss` stamp, wrong-resource rejection, PKCE S256, single-use authorization code, atomic refresh rotation and replay detection (`tests/e2e/r5-http-session-fakeclock.test.ts`, `tests/security/r5-issued-credentials.test.ts`).
