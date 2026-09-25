# Integration Hub, Tool Registry adapters and external automation participants

**Requirements:** P-05/07/08/15/23. **Backlog:** B12/B13/B41/B42.

## Boundary
Integration Hub is a capability with audited, typed invocation and per-connection scoped identity; never treat it as core authorization authority or a backdoor into developer-host Ops/Desktop. MCP is an **interop tool protocol**, not HooshiX's service-to-service gRPC identity, durable workflow history, or device enrollment protocol. Support API/REST/OpenAPI-generated, gRPC, webhook, MCP, DB, email/calendar and SaaS connectors behind consistent ports, adding concrete adapters incrementally.

## Registry and connection aggregates
```text
ConnectorDefinition(connectorId, version, publisher, protocol, manifestDigest,
                    toolSchemas, outboundDestinations, requiredAuthTypes, dataPolicy)
Connection(connectionId, tenantId, ownerType USER|WORKER|ORG, ownerId,
           credentialRef, approvedScopes, allowlistedDestinations,
           status, health, createdAt, rotatedAt, revokedAt)
Invocation(invocationId, tenantId, actorRef, runId/stepId, toolId/version,
           connectionId, deadline, idempotencyKey, inputClassification,
           requestRef/digest, outcome, resultRef/digest, auditCorrelation)
Subscription(subscriptionId, tenantId, webhookSigningKeyRef, eventType,
             replayWindow, lastEventId, status)
```
Version and scope changes require a new immutable manifest version; ownership/credentials never become global when workflow shared. Only the designated connector owner may resolve its raw secret, preferably via existing OpenBao/secret authority; model and workflow databases store opaque references only.

## Invocation semantics
Registry discovery returns only tools permitted to the initiating human/worker and tenant policy. Policy checks *before* DNS/connect and *again* at material mutation; browser clients submit BFF-owned IDs, not arbitrary target URL or executable code. Validate input schema/size/encoding and allowed destination; protect SSRF against localhost/private/metadata/DNS rebinding unless an explicit scoped internal destination is approved. TLS identity, bounded redirects (default deny), timeout, concurrency, rate and egress budget. Response is bounded, provenance-tagged, classified, sanitized and treated as untrusted model context.

## MCP implementation
Register server URL/transport, owner, trust/publisher, tool manifest snapshot with version/digest, allowed tool IDs and mutation risk, tenant resource ACL, credential use and connection lifecycle. MCP discovery may change unexpectedly: revalidate manifest on invocation; no automatic wildcard tool permission. Map tool invocations to canonical structured arguments/results and classified errors. MCP resources/prompts are untrusted third-party content, never system instructions. Add durable task execution at Workflow layer, not hidden inside MCP connection.

## External AI agent vs provider
External NSN-like/n8n-like agent: registered *automation principal* with a task request/result contract and lifecycle; can own work under delegated bounded tenant scope, but cannot become employee identity/approver. OpenAI/Anthropic/local model: provider endpoint used by Model Gateway to produce content; cannot directly run arbitrary platform tools without approved Agent Runtime. Keep registration, billing/cost and policy distinct for each.

## Callback/webhook transaction
Require signed/mTLS/OAuth-backed sender identity, replay nonce/eventId, signature over exact canonical payload and timestamp, audience/tenant/run/step binding, short expiry, expected state+leaseGeneration, schema and output digest validation. Persist inbox dedup and state transition in one local transaction; return deterministic replay response; emit outbox event after commit. An external system's report of success is not equivalent to verified business side effect—run postcondition where feasible and classify ambiguity.

## Connector outage and revoke
Unhealthy or expired connection => fail/wait explicitly; remove scopes immediately from new requests and re-authorize pending activity. Never auto-retry ambiguous external mutations. Enforce data deletion/retention on connector copies where supported and record vendor constraints. Connector installation/update follows supply-chain manifest provenance, license/permissions review, test sandbox and staged rollout. Disconnect/rotate credentials without leaking them to dashboards.

## Verification
API read and API mutation with idempotency, MCP discovery drift, expired OAuth, forged callback, wrong tenant, DNS rebinding, redirected local address, malformed JSON/schema, output tool prompt injection, duplicate webhook replay, connector timeout and too-large payload, secret-redacted audit, offline connector failure without global service collapse.
