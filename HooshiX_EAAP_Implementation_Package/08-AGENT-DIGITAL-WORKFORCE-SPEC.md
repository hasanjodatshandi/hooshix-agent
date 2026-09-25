# Agent Runtime, internal digital employees and external agent collaboration

**Requirement IDs:** P-04/05/07/14/15/21/24. **Backlog:** B12/15/21/41/62.

## Principal model
Human: existing Identity membership and session. Internal Worker: own opaque tenant-scoped principalId, human owner/reference and purpose, lifecycle DRAFT/ACTIVE/SUSPENDED/REVOKED, instruction digest/version, memoryScopeRef, allowedToolIds/connectorIds/deviceSelectors/workflows/modelPolicies, dataClassificationMax, maxRunBudget, maxDepth/steps, schedules/workingHours/timezone, approvalRules, secret refs (never raw), spend/telemetry limits. External Principal: dedicated tenant-bound integration identity, verified issuer/subject/client certificate/key, owner, allowed operations, callback contract, rate/expiry/rotation/revocation; it does not gain a human membership or login MFA bypass. A model provider is neither principal nor approver.

Authorization: existing online Authorize remains authority; extend permission/resource catalog and identity representation through reviewed ADR/contract. Actor, onBehalfOf, owner, tenant and resource scope are separate signed/verified fields; audit distinguishes initiator, delegated actor, execution worker and device. No user JWT copy to remote agent. An internal agent can invoke only intersection of its assigned scope, owner-delegated scope, workflow-approved scope and current resource policy; revocation checked at each material mutation. Default deny; no self-approval.

## Agent runtime bounded loop
```text
Goal + actor/context refs
 -> gather minimum authorized memory/knowledge and typed tool catalog
 -> bounded plan (steps/deadline/token/cost)
 -> validate against current policy + classification + budget
 -> select one registered typed action/model specialist
 -> verify canonical arguments and scoped target
 -> execute under durable run/step attempt
 -> independently verify postcondition and update budget/evidence
 -> stop | bounded replan | wait for human | fail safely
```
Cap reason/model iteration, tool invocations, parallelism, wall time, delegated depth and cumulative cost. Unknown tool, untrusted content instructions, uncontrolled shell, broad filesystem access, ambiguous UI or denied resource => reject/escalate. Model output is untrusted proposed parameters, not permission. Planner must not forge decision/permission proof or emit secret refs outside allowed tool context. Configure advisory/assisted/autonomous-bounded/workflow-owned modes; autonomous permissions are narrower than administrator.

## Tool manifest (canonical schema sketch)
```json
{"tool_id":"device.element.invoke","version":"1.0.0","owner":"device",
 "input_schema_ref":"protobuf-or-JSON-schema-digest","output_schema_ref":"...","effect":"MUTATION",
 "required_permissions":["device.control","application.invoke"],"execution_location":"DEVICE",
 "classification_ceiling":"INTERNAL","idempotency":"REQUIRES_PRECONDITION",
 "default_timeout_ms":10000,"max_concurrency":1,"policy_ref":"tool-policy-id"}
```
Registry lifecycle: reviewed manifest, signed/provenance where appropriate, semantic version, scoped enable/disable and revocation, deterministic schema normalization, allowed connector scopes, typed errors and postcondition, no direct provider SDK/domain entanglement. Read and mutation grants are separate. Tool output/connector web content is data and susceptible to prompt injection; encode provenance, redaction and content filtering before putting in model context.

## Worker execution examples
- Scheduled reconciliation: service emits wakeup -> worker authenticated principal + per-tenant quota -> read-only API activities -> human-approved ERP mutation via qualified VM -> audit.
- Specialist delegation: writer/model returns draft (no authority), code model returns patch proposal (no arbitrary merge), separate validator checks artifacts/policy; human approves restricted action. Multi-agent coordination shares only explicitly scoped context and cannot bypass action count or egress classification.

## External system adapter contract
Support API/MCP/webhook/grpc where the external system (NSN or n8n-like) has documented interfaces. Register one agent instance/endpoint/contract; require registered tenant and owner; request signed or mutually authenticated `taskId, invocationId, nonce, expiresAt, capability, classification, inputRef, outputContractVersion, maxCost`. Callback supplies `taskId, invocationId, attempt, eventId, outcome, outputRef/digest, completedAt`; authenticate integration identity and match pending lease/run tenant/version/deadline; persist dedup eventId and reject unsolicited/late/cross-tenant callbacks. Never accept approval decisions through ordinary external-agent callback. Polling allowed only with bounded schedule and quota if callback unavailable. Circuit-break/timeout/revoke connector and force manual recovery for uncertain mutations.

## Policy and failure cases
Worker owner suspended; tenant deleted; allowed device offline; tool manifest revoked; model routing blocked by classification; external agent loops back into its own task; same webhook replay 100x; worker tries approving own queued action; external adapter injects a new system prompt; credential exfiltration; two tenant claims share integration URL; model emits broad wildcard resource; "agent is human" forged role. Every case must fail closed, result in no prohibited external call, and leave sufficient redacted audit/diagnostic evidence.

## Versioning/UI
Digital Worker definition edits create a new version; active runs remain pinned; changed scopes require reauthorization before subsequent effects. UI distinguishes person, internal worker and external agent with explicit owner, tools/permissions, budget, memory policy, last run, revocation and approval queue. Bulk rollout and scheduled worker may never inherit a selected browser session silently.

## Non-goals
General autonomous OS administrator, bypassed MFA/CAPTCHA/Secure Desktop, raw shell over all endpoints, identity substitution, autonomous security policy update, unbounded cross-worker replication or automatic trust of arbitrary MCP server claims.
