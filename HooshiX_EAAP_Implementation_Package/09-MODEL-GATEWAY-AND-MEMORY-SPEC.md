# Model gateway, private AI and durable user/worker memory

**Requirement IDs:** P-03/09/15/17/19/24. **Backlog:** B14/20/43/51.

## Preserve existing Conversation boundary
Existing private Conversation/Message and first fixed stateless OpenAI ModelRun retain accepted semantics, auth, budgets, AES-GCM at-rest encryption, tenant RLS, no-provider-side persistence and rollout/evaluation gates. Build new provider-neutral execution as an evolution via reviewed port/contract and new owned capability where justified. Do not expose model tools via current no-tools call or silently enable provider runtime/canary/eject data.

## Model gateway contract
`InvokeModel(tenantId, actorRef, invocationId, capability, modelPolicyId/version, dataClassification, residency, redactedInputRef, outputSchemaVersion, token/time/costBudget, traceRef)` returns typed text/structured/vision result or classified error, usage, cost, policyVersion, provider/model digest and auditRef. A provider adapter is replaceable and must never know passwords, direct DB schema or user refresh JWTs. Registry stores model capabilities: language, vision, structured output, tools when separately approved, output constraints, context limit, observed quality/eval version, latency, cost, health, locality and egress destination. Normalize token accounting, streaming/error and invocation idempotency where supported; provider-side repeat may incur cost, so ambiguous attempt is reconciled conservatively, not blindly retried.

## Routing precedence
1. Tenant/organization classification and egress/legal/residency policy.
2. Consent, approved provider/region/model/version, safety evaluation and DLP outcome.
3. Capability compatibility and scoped task.
4. Quota/deadline/budget/admission and measured resource constraints.
5. Quality/latency/cost preference within legal allowed set.
Sensitive LOCAL_ONLY => no external DNS/request/log; if no permitted local model, fail closed. Allow approved fallback only within original classification, region, capability, retention and budget. No hidden metrics/license/model-discovery internet calls in air-gapped profile.

## Local inference adapter/worker
Candidate llama.cpp or vLLM/private OpenAI-compatible endpoint: evaluate licensing, OS/GPU/CPU, deterministic asset identity, offline signed model artifact, prompt/system-policy binding, model context isolation, per-tenant budgets/rate and safe concurrency. Isolation is a deployment and serving contract, not reliance on a single shared process's benign behavior. Protected worker uses no direct BFF/public exposure; submit bounded tasks through Gateway. Add adversarial bilingual evaluation, PII canaries, synthetic tool-output injection, regressions and explicit rollout/rollback before candidate approved. Hardware resource sizing must include concurrent model/chat/workflow demand on selected HooshiX single-server host.

## Persistent memory aggregate
```text
Memory(id, tenantId, ownerType USER|WORKER, ownerId, projectScope?,
 kind FACT|PREFERENCE|TASK_STATE|KNOWLEDGE_REFERENCE,
 sanitizedContentCiphertext, sourceProvenanceRef, consentPolicy,
 dataClassification, lifecycle ACTIVE|SUPERSEDED|DELETED, version,
 createdAt, expiresAt, indexVersion, redactionRules)
```
Separate durable memory from Conversation transcript, LLM context and developer Git-native Context Engine. Only policy-approved memory extraction is committed, with explainable provenance, purpose, retention and edit/delete UI. Retrieval checks Identity/AuthZ and service-local owner/share ACL **before** vector/keyword result disclosure; enforce tenant filters inside SQL/vector path and recheck on read. A worker has its own private scope plus explicit delegated access; service/agent memory must not automatically become global tenant memory.

## Memory lifecycle and consistency
Write: explicit actor permission -> classify/extract candidate -> scrub sensitive raw secrets -> owner approval/consent if required -> encrypt in owner DB -> transactional canonical row/outbox index request. Index asynchronously with versioned embeddings and tenant/owner ACL fields; stale index entry never authorizes retrieval. Edit increments version and invalidates old index; delete creates durable tombstone and propagates to vector/object/cache/backup retention according to policy; deletion completion ack/metrics and retry. Cross-chat retrieval fetches top bounded candidates then owner-validates per row and assembles minimal context; user can inspect, edit/export/delete. Keep retriever version/eval and filter criteria in redacted audit; never dump all conversations into LLM context.

## Knowledge/RAG
Separate user memories from enterprise documents and permissions. Source docs have tenant/project ACL, classification, connector provenance, revision and expiration, per-chunk inherited ACL; prevent stale revoked source retrieval, injected document tool commands, hallucinated citation and external model egress outside classification policy. Choose pgvector only within owner-owned DB after representative retrieval accuracy/corpus and RLS benchmark; no global shared vector table or cross-service SQL access.

## Validation
Provider disabled => denied; classified LOCAL_ONLY request with external-only provider => no egress; budget exhaustion before send; provider timeout/ambiguous charging; tenant-index poisoned record never returned; user edits/deletes and re-query in new chat/provider; worker suspended cannot access old memory; encrypted dump cannot reveal content; air-gapped local-only full workflow; model candidate canary rollback on failed evaluation without losing authoritative stored state.
