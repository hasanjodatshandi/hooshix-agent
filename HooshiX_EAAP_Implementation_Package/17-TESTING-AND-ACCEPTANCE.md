# Verification matrix, quality gates and release definition of done

## Evidence ladder
D = documentation only; S = source + static/build/unit; L = executable local integration and negatives on exact commit; ST = staging/real OS/provider fixtures; P = approved production release/ops/DR/air-gap and SLO evidence. Never turn a documented TARGET into IMPLEMENTED or a local integration PASS into Production READY. Every finding names exact commit/branch, test command, artifact timestamp, target OS/hardware/profile and meaningful result; past pass does not prove current commit.

## Current baseline regression (must stay green)
Existing six Java service security suites, frontend typecheck/build/Playwright and accessibility, neutral Protobuf/Buf compatibility, BFF OpenAPI generated parity, Identity registration/MFA/tenant, Authorization online decision/denial, Conversation encryption/ModelRun budget/cancel/no-tools first-slice and erasure, Notification/idempotency, HIBP, tenant RLS/migrations, Kafka/outbox/inbox, existing repository baseline/Context Engine guards, source secret scans and current release/admission gates. Execute exact current `make baseline-verify` and service tests according to current HooshiX instructions; no disabled gate/suppression to pass.

## Traceability acceptance matrix
| IDs | Positive scenario | Mandatory negative/failure scenario | Minimum evidence |
|---|---|---|---|
| P01,P02 | BFF authenticated chat/task in tenant | other tenant/session/user cannot list/run | contract + browser + live AuthZ/RLS L |
| P03 | scoped recall in new chat, manual edit/delete | revoked owner, stale vector index, cross-tenant result | DB/index lifecycle L |
| P04,P07 | bounded worker runs scheduled with no live chat and typed tools | self-approve, tool not allowlisted, infinite loop, owner revoked | durable/safety L |
| P05,P08 | external agent invocation/callback over approved protocol | forged signer, wrong tenant, duplicate replay, timeout | connector mock and test integration L/ST |
| P06,P10,P22 | immutable workflow runs through restart and scheduler failover | double worker claim, changed active version, repeated effect | crash/soak L |
| P09 | classified local inference and allowed external specialist | LOCAL_ONLY egress, disabled provider, token/cost overspend | packet/test local L; offline ST |
| P11,P12 | same semantic task physical+VM Windows guest | cloned key, locked/no session, wrong OS capability | real physical+VM ST |
| P13 | server→device→server run with verified result | reconnect/late cancel and duplicate mutation | full hybrid ST |
| P14,P15 | human-only approval and protected secrets | external agent forged human signature, changed action hash, leaked prompt/secret | negative auth/PII L |
| P16,P23 | recorded/reviewed skill semantic + browser/API-first | UI drift, uncertain coordinate/privileged prompt bypass | OS/device ST |
| P17 | IDP fields extracted and corrected | corrupt/scanned/PII/injected document | corpus accuracy + security ST |
| P18 | consented mining isolated by tenant | opt-out, revoke/delete, case cross-contamination | policy/privacy L/ST |
| P19 | offline signed install/update/local inference/workflow | DNS/telemetry/license/provider hidden egress | isolated network capture ST |
| P20,P24 | workload budgets, profile SLO/load and approved HA where enabled | partition, noisy tenant, CPU/GPU exhaustion, restore failure | profile-scale load+DR ST/P |
| P21 | redacted audit/replay supports operator investigation | unauthorized artifact URL or PII in logs | evidence retention/audit L/ST |

## Test portfolio and layering
- Unit/property: state transition, retry/deadline budget, policy precedence, memory scoping, model/connector normalization, scheduler DST, logic/DSL validation.
- Architecture/contract: ArchUnit ports, DB ownership, protobuf semantic version, schema examples/protovalidate, OpenAPI controller parity, endpoint agent forward/backwards compatibility; prevent dev MCP code import into application runtime.
- DB/integration: transactional acceptance, exact-once local commit, Outbox/Inbox replays, forced RLS/pool leak, migrations/restore, key rotation, index delete, concurrent approval.
- Security: abuse-case matrix in 15 incl prompt-injection, SSRF, cloned VM, forged callback, DLP packet captures, secret canaries; independent endpoint policy denies.
- Browser/accessibility: Persian/English RTL/LTR, keyboard actions, stale state and abortable polling, generated API types, redacted evidence viewer.
- E2E: V1–V5 in 06, including stopped worker/VM, provider and object-storage outages, human approval wait, durable history and compensation.
- Scale: real per-tenant/risk quotas, RPS vs long-running workflows/device concurrent sessions/model tokens/object evidence, soak, noisy neighbors, saturation refusal/headroom; measure on selected hardware/profile.
- Operations: signed exact-digest promotion, canary/rollback, backup/PITR and file/object evidence restore, offline updates, air-gapped model import, DNS/NTP/identity offline dependencies, failure-domain exercise.
- Evaluation: tool selection, action postcondition, plan repair/escalation, bilingual Persian/English model/vision/IDP sample, memory ACL precision and safety red-team; pin dataset/model/prompt version.

## Acceptance report template (per work item)
```text
Requirement IDs / owner / contract versions / tested commit / PR:
Architecture and security decisions / changes:
Implementation presence: NOT PRESENT | PARTIAL | IMPLEMENTED
Test evidence: NOT RUN | FAILED | PARTIALLY VERIFIED | PASSED
Production evidence: NOT VERIFIED | PASSED (with artifact/environment)
Positive + negative cases (commands, output/artifact):
AuthN/AuthZ/RLS/secret/model-egress findings:
Deadline/retry/lease/idempotency and recovery:
CPU/memory/GPU/device capacity headroom:
Migration/rollback/DR and release provenance:
Residual risk and named owner/next gate:
```

## Stop-the-line failures
Cross-tenant data leak, unauthorized device control, forged human approval, raw secret/OTP exfiltration, irreversible duplicate action, unreviewed egress, unverified signed artifact admission, incomplete retention/erasure or false production claim. Fix and re-run affected gates without weakening them. If a production-specific gate is deferred in HooshiX's active plan, leave status NOT VERIFIED and do not release to production.
