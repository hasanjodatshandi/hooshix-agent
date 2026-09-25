# Workflow orchestration, deterministic execution and scheduler — technical specification

**Requirement IDs:** P-06, P-10, P-13, P-14, P-22–24. **Backlog:** B10/11/13/22/23/40. New capability, not the existing Conversation ModelRun worker. Select runtime technology by scoped ADR; do not directly replace a HooshiX service, transport or queue.

## Aggregate model and data ownership
Definition(id, tenantId, ownerPrincipalId, name, immutableVersion, compiledSchemaDigest, publishedBy, publishedAt, policyVersion, lifecycle[DRAFT|PUBLISHED|RETIRED], environment); Nodes are typed, no executable free-form scripting by default. Run(id, tenantId, definitionId/version, triggeringActor, effectivePrincipal, startReason, classification, deadline, maxCost, state, stateVersion, currentNodes, timestamps, evidenceRef). Step(id, runId, nodeId, attempt, location, capability, resource binding, idempotencyKey, lease owner/expiry, inputRef/outputRef, state, outcomeVersion, exceptionClass, retryAfter); Timer; ApprovalWait; TaskOutbox and inbox/dedup as appropriate.

Each aggregate belongs to one owning bounded context/database; other services use authenticated contracts and immutable events. All tenant-scoped relational state uses forced RLS and transaction-local tenant context, immutable published versions, bounded indexed pagination and service-owned Flyway.

## DSL canonical node shapes
```json
{"schema_version":"1","workflow_id":"uuid","definition_version":1,
 "entry":"trigger-1","nodes":[
 {"id":"trigger-1","kind":"trigger.manual","next":["step-1"]},
 {"id":"step-1","kind":"action.http","config_ref":"registered-connector-action-id","next":["approval-1"]},
 {"id":"approval-1","kind":"human.approval","policy_ref":"approval-policy-id","next":["step-2"]},
 {"id":"step-2","kind":"action.device","capability":"desktop.element.invoke","next":[]}
 ],
 "limits":{"max_steps":100,"max_parallel":8,"deadline_seconds":3600}}
```
The JSON is illustrative; canonical Protobuf/JSON schema must be accepted via current HooshiX contract governance. Validate DAG/start/reachability, typed inputs/outputs, explicit limited loops (cycles disallowed except bounded loop node), join/parallel semantics, no privilege escalation by subflow, no env-dependent unversioned refs, deterministic conditional expression subset, and publish-time credential/connector/device capability authorization. Support trigger/manual/schedule/webhook/integration/device-online; action HTTP/MCP/DB/file/browser/device/skill/document; AI prompt/agent/vision/classify/memory; logic switch/loop/parallel/join/wait/subflow; human approval/review/escalation. Later optional nodes enter through versioned schema extension, not ad hoc evaluator behavior.

## State machine and transitions
Run: CREATED -> QUEUED -> RUNNING -> SUCCEEDED/FAILED/CANCELLED; RUNNING -> WAITING_TIMER/WAITING_DEVICE/WAITING_HUMAN/WAITING_EXTERNAL/RETRYING/COMPENSATING -> RUNNING/terminal. Enforce monotonic aggregate version, terminal immutability and explicit typed actor at each transition. Step: READY -> CLAIMED -> EFFECT_PENDING -> EFFECT_OBSERVED -> COMMITTED; on ambiguous external result -> OUTCOME_UNKNOWN/manual reconciliation, never blindly replay mutation. Cancellation from any nonterminal state requests workers/agents cancel and releases future work; a committed external side effect is not magically rolled back. Compensation is explicit business action, not database rollback or implied exactly-once delivery.

## Atomic acceptance/dispatch
Submission: authorize current tenant/principal/version/tool budgets, validate requestId UUIDv4 and canonical input digest, atomically persist Run+task/outbox; equal requestId+payload returns prior run; same key/different payload returns CONFLICT; transaction contains **no** remote IO. Dispatcher claims with a short transaction + lease/token/version, performs external call outside transaction, records result conditionally with lease fencing. Timers and device/human waits persist and consume zero request thread. A dead worker's lease can be reclaimed with retry/backoff, but external uncertain mutation requires idempotency API, verifiable postcondition or manual action—not duplicate execution.

## Retry ownership and deadlines
One owner per failure edge; classify timeout, unavailable, rate-limit, permanent validation, policy denial, uncertain external commit. Persist next retry/max attempts with bounded exponential backoff+jitter. End-to-end run deadline caps step provider deadline, transport deadline, retries and wait expiry. Distinguish retryable transport failure from nonrepeatable business effect. On cancellation propagate step/connector/device attempt identity; late results require matching run/step/lease version and must never undo a newer state.

## Scheduling
Store schedule definition/version, IANA timezone, DST gap/fold policy, nextFire, misfire window and backfill limit; atomically accept unique (scheduleId, plannedFireTime, version) run; repeated scheduler ticks/leader switchover do not duplicate run. An offline device leaves explicit WAITING_DEVICE until deadline/owner revocation, then fail/escalate. Waiting for human expiry is terminal or uses a documented escalation route; never defaults to approval.

## Execution placement and capability match
SERVER runs isolated HTTP, browser, document, local inference or bounded code tasks with quota and SSRF controls. DEVICE targets a registered eligible PHYSICAL/VM/VIRTUAL_DESKTOP endpoint with supported OS, health, local policy and required interactive session. AUTO chooses only from authorized capability/tenant targets with recorded selection rationale; no fallback from denied DEVICE to privileged SERVER.

## API and event sketch (subject to ADR)
SubmitExecution(definitionId,version,inputRef,requestId,actorRef) -> runId,state; GetExecution(runId, cursor) -> tenant-redacted timeline; CancelExecution(runId,requestId) -> observed state; PublishDefinition(draftId,expectedVersion,approvalRef); ListReadyActivity(workerCapability, maxItems) internal only. Events: RunAccepted, StepWaiting, StepFinished, RunFinished, ApprovalRequested; carry opaque IDs/schema version/correlation, never prompts/secret values in Kafka. BFF converts to typed OpenAPI, enforces anti-CSRF/browser auth; no browser direct access to internal gRPC/worker endpoints.

## Failure scenario acceptance
Kill scheduler after acceptance; kill worker just before/after external effect; replay webhook x10; two workers claim same step; device reconnect; expired human approval; revoked tenant; migrate workflow version while old run active; quota saturation; Kafka loss; object store outage; provider timeout; dead-letter manual reconciliation. Assert a single durable business effect or explicit OUTCOME_UNKNOWN, no unauthorized cross-tenant read, correct timeline and no secret in metrics/logs.

## Architecture spike for runtime engine
Compare current HooshiX existing durable primitives vs candidate Temporal behind port vs equivalent: restart/determinism, Java SDK/version compatibility, workflow schema history, long waits, replay/upgrade, SQL/queue footprint, per-service DB ownership, single-server resource/headroom, air-gap packaging, licensing/SBOM/admission, HA expansion and DR. Adopt only after ADR, representative proof and rollback path. Avoid assuming Temporal equals the external business-effect idempotency guarantee.
