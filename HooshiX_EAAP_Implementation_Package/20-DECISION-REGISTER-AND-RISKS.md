# Target decisions, non-decisions, critical dependencies and risks

This is an **EAAP extension planning register**. It does not modify HooshiX's effective ADR register. Technical selections requiring new security, product, deployment or ownership behavior must be decided under the live HooshiX process **before** implementing dependent code.

## Decisions already fixed by user/current HooshiX
- Preserve existing HooshiX microservices, DDD/Hexagonal, service-owned data/versions/migrations and the existing identity, authorization, frontend, security and operations baseline; EAAP capability scope is added without a monolith rewrite.
- No code change in the current documentation assignment; original EAAP documents untouched.
- EAAP supports human and digital/external workers, physical/VM/virtual-desktop endpoints, server-only and hybrid workflows, optional external and local models, governed memory, air-gap final target.
- Current HooshiX stage order and deferred Production Commissioning remain in force until explicitly changed; EAAP tracks do not replace them.
- Current source+effective ADRs control implementation when a dated baseline conflicts.

## Decision queue: open, not approved
| Key | Question / alternatives | Required evidence and approver | Interim safe behavior |
|---|---|---|---|
| D01 | workflow runtime existing durable primitives vs Temporal behind port vs other | long waits, history replay, cost/airgap, Java SDK, rollback, SRE ownership; architecture owner | schema/interface and isolated spike only |
| D02 | which EAAP capabilities belong inside existing services vs new service/deployable | aggregate ownership, reliability/security/independent release/scale and current ADR compatibility; architecture owner | no new production service |
| D03 | worker/external/device non-human identity token and Authorization permission model | issuer/audience/revocation/tenant/owner/fresh decision design, negative proofs; security+identity owners | no non-human mutation authority |
| D04 | endpoint transport and native agent language/packaging on Windows/macOS/Linux | per-OS capability, certificate/guest session, supply chain, lifecycle, support matrix; device/security owners | registered Windows VM proof fixture only |
| D05 | local inference runtime/model distribution and signed assets | language/vision eval, GPU/CPU budget, airgap license, private data; model/security/SRE owners | existing gated Conversation policy unchanged |
| D06 | memory vector backend, storage retention, encryption and user consent | tenant RLS/vector ACL, corpus/latency/load, erase/restore, legal policy; data/privacy owners | no implicit memory from chat logs |
| D07 | approval/Audit evidence owner and tamper-evidence/retention | segregation of duties, durable record, off-host custody, laws; security/compliance owners | human-only, policy denied absent authority |
| D08 | connector/MCP/external agent protocols, onboarding, callback, secret rotation | real external service contract (including NSN), license, SSRF/egress, replay; integrations/security owners | adapter disabled without approval |
| D09 | VM provisioning scope (connect existing guest vs auto-create cloud/hypervisor VMs) | owner explicit product/infrastructure choice, identity/cleanup/cost; product/security owners | connect pre-existing VM only |
| D10 | object storage/vendor and session replay format | encrypted retention, read ACL, airgap, throughput, storage migration; SRE/privacy owner | opaque evidence refs and local synthetic fixtures |
| D11 | air-gap edition and external provider availability/UX | local model parity, offline identity/license/updates, security sign-off; product/security owner | offline mode denies external route |
| D12 | HA profile activation, external infrastructure and commercial capacity | actual workload/SLO/RPO/RTO, owner budget, ADR-0042 expansion; owner/SRE | current single-server profile, no HA claim |
| D13 | first three representative desktop applications, supported OS/VM matrix and industries | representative customer fixtures/licenses, security and device reliability; product owner | Windows physical+VM synthetic fixture |
| D14 | EU/sovereign data residency, FIPS/compliance and audit retention | applicable customer regulation and legal/security decision | never claim compliance from generic controls |
| D15 | model-provider BYOK, external AI spend ownership and fallback policy | secret authority, tenant billing quotas, supply chain and data control | no unmanaged user keys or silent external fallback |

## Risk register and mitigation
| Risk | Trigger / consequence | Gate/mitigation |
|---|---|---|
| R01 Existing HooshiX overwritten by historical EAAP monolith/shared-DB guidance | incompatible ownership and migration/data loss | 01 invariants, owner-reviewed D02, ArchUnit/DB boundary gates |
| R02 Current Stage 9 scope creep | breaks accepted Conversation no-tools/disabled provider | current repo roadmap/ADR review and protected acceptance before dependent extension |
| R03 Impersonated employee via Digital Worker or external callback | unauthorized action/approval/tenant crossing | D03, human-only approval, revocation, AuthZ+RLS negatives |
| R04 VM image copies enrolled credentials | identity collision and cross-tenant control | guest key after clone, certificate rotation and D09 test |
| R05 Workflow duplicate after crash/provider timeout | irreversible duplicate business effects | durable keys/fencing, postcondition and OUTCOME_UNKNOWN/manual reconciliation |
| R06 Prompt injection from tool/document/connector | permission change/exfiltration | model output untrusted, schema/allowlist, egress gate and eval red-team |
| R07 Single host overloaded by inference+device gateways | security/DB/telemetry starvation | actual complete-stack profiling/headroom, admission/quota, scale under approved HA decision |
| R08 Air-gap promise fails hidden runtime dependency | offline outage/data egress | isolated network exercise with DNS+packet capture, signed offline assets |
| R09 Desktop GUI portability overclaimed | customer task failures | platform/session-specific matrix and transparent unsupported state |
| R10 Consent/retention/memory deletion mismatch | PII leak or illegal retention | owned lifecycle, tombstone, index/object/backup and audit policies |
| R11 Developer MCP reused as production admin device | host authority/data compromise | separate trusts, reviewed production device design, no imported developer keys |
| R12 Documented target mistaken for shipped system | deployment with inadequate evidence | explicit evidence ladder in 17, production gate in 18 |

## Decision artifact format
Each accepted decision must record: current source/ADR refs, affected user journey/requirement IDs, alternatives rejected with reasons, boundary owner, transport/schema and data model, threat/egress/secret and compliance impact, operational/airgap/HA impact, resource benchmarks, migration and rollback, version compatibility, tests and reviewer/owner approval. Update current HooshiX source documents and decision register *in the same authorized coherent PR* as the accepted implementation change, never retroactively editing the source EAAP baseline.
