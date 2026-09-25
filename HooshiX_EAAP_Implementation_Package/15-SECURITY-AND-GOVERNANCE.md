# Security architecture delta: EAAP features on current HooshiX foundations

## Authority / trust-zone inventory
Existing: edge/WAF, BFF, Identity, Authorization, private service-to-service gRPC identities, tenant DB RLS, encryption/key management, Kafka, signed/release-gated workload, telemetry and operator JIT. Proposed additional zones: approved external agent/MCP/SaaS, model providers/private inference, Workflow/Agent workers, Device Gateway, endpoint local policy/credential store, VM guest/hypervisor, browser automation, evidence/object storage and approval operator. A new zone is **untrusted by default** even if it resides on the same physical host or within one tenant. Co-location is not authorization.

## Identity/authorization invariant extension
- Non-human Worker, external integration and endpoint identity are separate typed principals with lifecycle, owner, tenant binding, audience, scopes, short-term credential, revocation and audit. A non-human identity **never** impersonates human MFA/JIT approval.
- Service-to-service/workload trust uses current HooshiX mechanism; caller JWT audience is exact and non-transferable. Every material mutation checks authoritative online permission and owner resource invariant; no locally cached grants. Authorization transport expiry/failure fails closed using current 300ms/one-attempt rule where applicable.
- Tenant RLS on new owner DB tables is forced; connection-pool transaction-local tenant setup/cleanup tested on commit/rollback/reuse. Kafka record IDs/correlation are non-PII and never authorize data access.
- Workflow role, run actor and connector/device principal are distinguishable. Delegation requires scope intersection + replay-proof task ID + current owner policy + time/budget caps. Owner removal/suspension cancels or pauses pending work; no inherited user browser cookies.

## Connector/model threat control
Outbound destination allowlist bound to exact DNS/IP/port/protocol under policy, protection from SSRF/metadata/DNS rebinding/private-network pivot, TLS verification and bounded response. MCP tool output, email/web page, retrieved knowledge and model output are untrusted **data**, never platform instructions. Typed schema/allowed action checks before dispatch, JSON size/depth/recursive limits, Unicode normalization where needed and output encoding/redaction. Prompt injection must not alter tool permissions or turn provider policy off. External model receives minimum necessary classified context only after egress/DLP gate; local fallback is allowed only where approved.

## Device/VM threat control
Enrollment attests tenant binding and unique guest key minted after VM clone. Require mTLS and certificate rotation/revocation; no wildcard admin remote-control session. Gateway checks device capability+health+active lease+app allowlist; endpoint enforces independent local permission and secure UI boundaries. Screen capture/input only in allowed interactive user session. Credentials resolved via endpoint-local broker/use-without-disclosure; never sent to LLM, screenshots, replay or central logs. Prevent stale VM callback after destroy/reprovision with lease generation and device identity rotation; avoid host/hypervisor escape by restricting guest privileges. Ephemeral VM provisioning is an independent risk decision, not a required first feature.

## Secrets, audit and evidence
Store service keys in existing approved secret authority; per-tenant/user/worker data keys and rotation policy per owner, envelope encryption for sensitive evidence, time-limited signed object URLs only behind current AuthZ and tenant check. Redact Authorization, cookie, OTP, vault, app form passwords, MFA and PII fields before logs, traces, model invocation, tool result and image/vector index. Separate audit from operational telemetry; append-only/tamper-evident audit in approved durable custody, with immutable decision inputs/digest, actor+delegation+resource+policyVersion and rollback/incident lineage.

## Security test plan
| Vector | Required negative outcome |
|---|---|
| Cross-tenant UI/API/gRPC/DB/vector/device object | AuthZ+RLS reject; no data returned |
| External agent forged callback/role/approval | authenticated actor/resource version checks reject |
| Replay x100 after timeout/cancel | one accepted result/effect or OUTCOME_UNKNOWN |
| MCP prompt injection in tool result | no new permissions/tool invocation |
| Classified prompt to blocked provider | zero outbound packets/requests |
| Endpoint clone with old cert/secret | not automatically enrolled or authorized |
| User session locked/Secure Desktop | no bypass or GUI mutation |
| Screenshot/trace/metric secret canary | no canary in emitted or retained evidence |
| Expired human approval/model policy | cannot authorize changed operation |
| Malicious URL/redirect/DNS rebound | connector blocks SSRF and private metadata access |
| DB pool tenant switching/recovery | no cross-tenant row visibility on reused connection |
| Runtime/dependency outage | deliberate fail-closed auth, graceful non-authority telemetry failure |

## Review and production isolation
Run threat-model update in Phase 0 and every new service/trust boundary; critical security review for devices, worker principal, approvals, provider egress, object evidence and workflows. Reuse current Semgrep/Gitleaks/OSV/ArchUnit, SBOM/Grype/Cosign/Kyverno release gates and current audit/restore requirements. Never claim Air-gapped or HA before real test on approved physical host/network and offline artifact path.
