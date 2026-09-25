# Policy, approval, governance, budgets and auditable execution

**Requirements:** P-02/14/15/21/24. Existing HooshiX Identity, Authorization and security invariants retain authority. New product policies extend them; no shadow auth database.

## Policy evaluation order (deny-first)
1. Authenticate actual principal and verify tenant/org/owner binding via existing Identity/workload identity.
2. Online authoritative Authorization check for requested resource/action under current HooshiX one-attempt/deadline/fail-closed requirements.
3. Product policy: actor mode and delegated scope, device and application allowlists, connector/tool manifest/risk, data classification/residency, model approval/egress, time/working-hours, quota and approval requirement.
4. Endpoint-local independent policy for DEVICE actions (both server and endpoint must allow).
5. Execute only when all required authorizations current; record policy version and decision reference without raw secrets/data. A local resource owner may reject additional domain invariants, never grant beyond AuthZ.

## Approval aggregate
ApprovalRequest(id, tenantId, run/step/version, requesterPrincipal, owner, requiredAssurance, actionDigest, classification, resourceRef, effectSeverity, approverPolicyRef, expiry, state PENDING|APPROVED|REJECTED|EXPIRED|CANCELLED, decisionByHuman, decisionTime, decisionProofRef, version). Generate before high-impact tool invocation. Only authorized *human* with required recent MFA/four-eyes separation may decide; worker/external callback cannot approve even if it carries a real-looking user ID. Approver sees exact safe action preview and immutable hash; approval invalid if action/version/resource changed. On return from WAITING_HUMAN, recheck current tool/device/tenant/authz/egress restrictions: old approval does not override revocation. API must use expectedVersion + idempotency; duplicate decisions deterministic; replay/expiry cannot reauthorize.

## Cost/quota
Per tenant/user/worker/workflow/device/provider budgets tracked as integer units where possible, with worst-case reservation before remote call, conditional reconciliation and conservative ambiguous-outcome accounting. Fair-queue and bounded per-tenant/integration/device concurrency; no hiding expensive retries in adapter. Device and external agent delegated budget cannot exceed parent's limits. Rate-limit cardinality and fail-closed clock and Redis capacity semantics follow current HooshiX security ADRs, not generic weaker caches.

## Credential and data handling
Existing OpenBao/host secret authority is target; preserve current key boundaries and encrypted-at-rest stores. Model context uses only task data and opaque credentialRef where policy permits; actual credential resolves in trusted connector/device local broker and is never returned to model or browser. No raw OTP/TOTP/MFA bypass. Before every external provider/connector call evaluate data classification, consent, egress allowlist, region and DLP/redaction; perform DNS/URL validation at transport. Offline profile must have zero external calls including crash telemetry/license checks.

## Audit model
Durable AuditEvent(eventId, tenant, eventType, actorType/opaqueActorId, owner/delegation, resourceType/ref, run/step/attempt, policyVersion, decision, immutable input/output digest/ref, timestamp, effectOutcome, correlationId, retentionClass, chain/signature metadata where required). Audit security-sensitive actions and changes to model/device/tool/approval/retention policies. Append-only or tamper-evident storage under ownership/tenant controls, off-host durable custody according to active HooshiX requirement. Trace/log correlation keys are not identity/authority; redact user prompts, screenshots, tokens, passwords and endpoint credentials. Screen/video evidence stored separately with shorter retention and masking. Audit deletion/legal hold and access to evidence must be explicitly documented and tested.

## Attack scenarios
Cross-tenant run injection; malicious external agent claims human role; user token copied to endpoint; approval replay after edited payload; synthetic provider answer attempts privileged tool; DLP bypass via base64/document/URL; tenant switching mid-run; device cloned certificate; long-lived approval after policy revoke; duplicate workflow event causing repeated payment; evidence download without tenant ACL; Kafka/log/telemetry leaks; model secrets in trace. Each must have failing assertion before implementation accepted.

## Governance UX
Tenant security admin sees reviewed permission changes, two-person approval exceptions, configured model/tool/device policies, retention, egress and cost. Agents have no autonomous authority to change their own policy or delete audit. Risk/exception owner and ticket/proof required for any production privilege exception and it must not bypass current HooshiX production security standards.
