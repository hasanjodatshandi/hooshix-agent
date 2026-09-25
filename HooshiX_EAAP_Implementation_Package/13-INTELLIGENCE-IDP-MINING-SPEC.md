# IDP, enterprise knowledge, task/process mining and skill improvement

**Requirements:** P-16/17/18. **Backlog:** B60–62. These are EAAP Phase 6 capabilities, not license to expand current HooshiX Stage 9.

## Intelligent Document Processing pipeline
Input uploaded/file/email object owned by a tenant/project/actor and retained with classification, malware/format checks, size/page/CPU/OCR quota and immutable source digest. Authorized pipeline: ingest -> validate -> text extraction/OCR (where appropriate) -> field classification/extraction with approved local/egress model -> schema + business-rule validation -> confidence/provenance coordinates -> optional human review -> canonical output and typed downstream workflow event. Distinguish deterministic parsing vs probabilistic extraction, avoid presenting model confidence as guaranteed correctness. Store artifacts in encrypted owner-controlled object storage with retention/deletion and access-proxy; do not embed large binary in Kafka/LLM prompt indiscriminately. Evaluate Persian/English, scan quality, invoice/contract variability, corrupt/encrypted/password-protected file, adversarial injected instructions and PII redaction. Never execute embedded macros, untrusted PDF JS, extracted prompt text as tool instruction.

## Enterprise knowledge/RAG
Per-source ACL/version/provenance, tenant/project permissions, chunk-level inherited policy, expiry, source-delete propagation and answer traceability. Rank/retrieve only after scope enforcement, then re-authorize result before model context assembly; separate non-human worker memory and shared enterprise knowledge. Provider routing honors document classification and residency, with offline local inference fallback or explicit fail-closed.

## Task Mining
Optional recording on registered authorized endpoints with org policy and explicit user/worker notice/consent where applicable; include allowlisted apps and activities only, no covert keystroke/password/MFA capture. Stream minimized structured event categories rather than raw screen by default. Evidence retention and redaction, local processing possible, per-tenant privacy boundaries and granular employee access. Pause/stop and purge must propagate to stores/indexes/export; legal-hold exceptions require explicit audit.

## Process Mining
Ingest only approved workflow/event logs with pseudonymous subject and tenant, stable case identifier, event time/version, source and consent. Detect bottlenecks, deviations, failure patterns and candidate automation tasks. Treat suggestions/ROI/time-saved as estimates with provenance, sample size and error bounds. No automatic rollout or employee performance scores from incomplete event data; human analyst reviews candidates and approves any new Workflow definition.

## Skill learning and self-healing
Recorded demonstration builds a reviewable semantic skill graph with preconditions/postconditions, permitted application/version/locator and human consent. AI-proposed locator adaptation never circumvents policy, app allowlist, or privileged/identity flows. Version pin, canary representative synthetic UI, fail safely on ambiguous targets, collect outcome evidence and explicit human approval for effect-changing repair.

## Dedicated acceptance evidence
Document extraction precision/recall and field-specific error budget on representative anonymized corpus; OCR failed/low-confidence correction routes; consent/opt-out deletion across task/process index; no cross-tenant case overlap; no secret in replay; prompt injection/corrupt-file denial; false-positive discovery analysis; skill version rollback and UI change tests; isolated-network processing where required.
