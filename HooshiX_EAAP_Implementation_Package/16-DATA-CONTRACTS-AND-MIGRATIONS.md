# Data ownership, typed contracts, persistence and safe migrations

## Non-negotiable persistence rule
Preserve HooshiX independent service DB credentials, migrations, release lifecycle, tenant forced-RLS, prohibition on cross-service SQL/sharing mutable tables and online authorization. New capability stores only its owned aggregates in its designated owner DB; owner may be existing service where use-case coherence supports it. No 'EAAP canonical shared database' or global foreign keys across boundaries. pgvector, object storage and workflow runtime persistence are capability-local candidates behind ports; measure actual need/backup/offline impact first.

## Candidate schema catalog (ownership subject to ADR)
| Aggregate | Owner / fields | Not permitted |
|---|---|---|
| WorkflowDefinition/Version | workflow owner; tenant, immutable definition digest, publisher, env, policyVersion | replacing existing Conversation rows, dynamic schema without migration |
| Execution/Step/Timer | execution owner; tenant, actor, run+step ID/version, lease, state, idempotency, evidenceRef | external effects in same DB transaction |
| DigitalWorker/Delegation | worker owner; owner principal, scope/budget/tools/devices/model policy/version | reusing human auth credentials |
| ToolManifest/Connection | integration owner; signed schema, owner scope, credentialRef, allowlist, lifecycle | raw secret in model/query payload |
| Endpoint/Session/DeviceTask | device owner; tenant, certRef, VM type, capability, session, lease generation | copied clone identity, host-wide secret |
| Memory/MemoryIndexJob | memory owner; tenant, user/worker scope, ciphertext, source, consent, version, deletion | shared cross-tenant vector without RLS |
| ApprovalRequest/Decision | approval owner; tenant, human approver, immutable action digest and expiry | agent-supplied approval signature |
| ModelRegistry/Invocation | model execution owner; provider/model version, classification, prompt digest, usage/cost | provider as user/session authority |
| Audit/EvidenceIndex | audit/evidence owner; opaque refs, actor, policy, immutable digest, retention | PII in Kafka/metrics/trace labels |

## Contract envelopes
Use current neutral Protobuf governance for internal RPC/events, current BFF OpenAPI/generator for public endpoints; preserve existing versioning and validation/negative tests. Candidate internal contracts:
```text
RequestContext {
 tenant_id, actor_id, actor_kind, delegation_ref?, run_id?, step_id?,
 request_id, schema_version, deadline, classification, policy_version
}
ExecutionCommand {context, workflow_id, immutable_version, typed_input_ref, idempotency_key}
ToolInvocation {context, manifest_digest, connection_id, action, typed_parameters_ref,
                effect_class, expected_postcondition}
DeviceDispatch {context, endpoint_id, session_requirements, lease_generation,
                action_schema_version, argument_ref, expected_postcondition}
ApprovalDecision {context, approval_id, decision, expected_version, human_proof_ref}
ExecutionOutcome {context, attempt, observed_effect, output_ref, output_digest, failure_category}
```
Context fields are **transport claims validated against authenticated workload, token audience, source owner and current policy**, never standalone authorization. Assign exact stable field numbers, enum compatibility, reserved removed fields, example fixtures, maximum payload sizes, endpoint/source ownership and result taxonomy via standard contract review. Encrypt sensitive content in owner storage; events carry opaque IDs/digests only.

## State and exactly-once effect semantics
Persist business intent + Outbox atomically; network/broker at-least-once delivered; consumers Inbox dedup with effect in same owner transaction. For remote HTTP/GUI calls, exactly-once *delivery* is impossible to assume; require idempotency support, postcondition check or explicit OUTCOME_UNKNOWN reconciliation. Fence stale leases with monotonically increasing generation and aggregate version. Unique constraints on (tenant, requestId, canonical inputDigest) or precise owner-specific key. Retain idempotency evidence through retry horizon and disaster restore as required; do not delete proof before replay window ends.

## Migration protocol
1. Confirm target owner service and Flyway/db-role scope; document current schema, data classification, retention and indexes/representative query plans.
2. Expand-compatible schema with default deny/mandatory tenant columns, RLS policy and separate migration role; compatibility test old and new app versions.
3. Deploy reader/writer dual compatibility where needed; backfill in finite batches under scoped tenant context and limited resource budget, with checkpoint/outbox and no lost deletes/revocations.
4. Verify row counts, uniqueness, ciphertext/key mapping, RLS negative tests and backup/restore; then contract-remove old columns only in a later explicitly reviewed PR, never modifying an executed Flyway migration.
5. Rolling rollback: revert application behavior through feature flag and compatible schema; **not** a blind database down migration of accepted business effects. Document irreversible changes with owner authorization.

## Tenant delete and retention
Existing Identity-driven erasure coordination remains authority; new participants register versioned command/receipt participation only after reviewed current policy, with atomic inbox/state+receipt outbox, finite retry, legal-hold and restore reconciliation. Delete user/worker memory, vector index, owned docs/evidence and connection tokens with scoped policy; retained security audit legal exceptions must be documented. Separate lifecycle for device transfer, tenant ownership transfer, webhook revocation and local/air-gapped update.

## API consumer and operational evidence
Proto compatibility check, BFF route parity/generated frontend types, unknown field handling, old/new producer-consumer matrix, schema fuzz, rollback, Flyway checksum, concurrent writers, dual-release skew, fail-closed migration startup, RLS pooled-connection tests, Kafka duplicated/reordered/poisoned events, object store outage, dead-letter manual repair and post-restore idempotency.
