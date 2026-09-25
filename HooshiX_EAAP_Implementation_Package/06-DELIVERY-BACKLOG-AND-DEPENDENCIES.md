# Detailed execution backlog with dependencies and exit criteria

Tasks below are **work items inside the eight EAAP tracks in 05**, not extra top-level project phases. Each has deliverable, prerequisites, acceptance and forbidden shortcuts.

| ID / track | Dependency | Detailed implementation deliverables | Evidence to close |
|---|---|---|---|
| B00 /0 | verified Stage 9 | fresh current Git/ADR/code contract inventory; freeze preservation matrix; scoped EAAP RFC | exact HEAD+dirty+origin/main, owner sign-off on boundary differences |
| B01 /0 | B00 | domain events/dataflow and human/worker/external principal threat models; capability owners vs deployable map | cross-tenant, credential/egress, callback and device trust negatives documented |
| B02 /0 | B00 | independent workflow, model-local, device RPC and VM-session spikes with exit metrics | reproducible test inputs, resource/capability measurements, no adopted stack before ADR |
| B10 /1 | B01/02 | immutable workflow definition schema/version registry with policy-scoped publishing, execution aggregate and state transitions | schema compatibility, publish authorization, replay, crash/restart, cancellation |
| B11 /1 | B10 | activity lease, durable timers, idempotent effect checkpoints, bounded retry/timeout/dead-letter manual recovery | duplicate message/late result/restart/worker kill tests; no duplicate external mutation |
| B12 /1 | B10 | canonical Tool Registry manifests, resource permissions, typed request/result and effect classification | schema invalid/ambiguous/prohibited command rejected before adapter call |
| B13 /1 | B11/12 | server execution adapters: approved HTTP/API and read-only MCP proof, isolated browser worker stub if needed | successful one workflow via BFF and denied tenant/connector tests |
| B14 /1 | B02/12 | model gateway port and local model adapter with classified input policy | local test with no egress; explicit provider disabled/failure fallback |
| B15 /1 | B11–14 | limited bounded agent loop: plan→allowlist/policy→tool→verify→finish/escalate | injection, budget, tool postcondition, expiry, recursion/loop budget tests |
| B20 /2 | B01/B15 | memory owner aggregate, scopes, consent, edit/search/delete/export/retention, embeddings behind owner port | same-user cross-chat, tenant ACL and deletion/vector cleanup |
| B21 /2 | B10/B15 | Digital Worker principal, owner, model/tool/connection/device allowlist, budget, working hours, state | no-user-session run, permission revocation, self-approval denial |
| B22 /2 | B10/B11/B21 | scheduler and workflow canvas with visual DSL, validation, immutable active version and environments | DST/missed trigger/restart, version pin, unauthorized publish rejection |
| B23 /2 | B10/B11/B21 | human action/approval owner with immutable decision/expiry, notification, resume token | human-only approver, four-eyes where policy, double/late/forged decision rejects |
| B30 /3 | B01/B11/B23 | device identity enrollment/rotate/revoke/online capability, tenant device permission, gateway task lease | cloned cert and de-registered device rejects; capacity/backpressure |
| B31 /3 | B30 | Windows guest/physical agent, semantic/action/vision/screen adapters and session readiness; OS-local policy | interactive VM+physical GUI success, blocked Secure Desktop/MFA/captcha |
| B32 /3 | B30/31 | VM session capability labels, ephemeral guest lifecycle and secure clone provenance; evidence object handling | independent VM IDs, no-session wait, stale VM callback denied, evidence redacted |
| B33 /3 | B31/32 | teach-by-demonstration reviewable versioned skill and postcondition/run replay | UI drift recovery vs safe fail/approval, stable screenshot hashes and retention |
| B40 /4 | B11/B30–32 | hybrid execution, reservation/lock and uncertain-outcome recovery boundary | server→VM→server restart, duplicate result, process termination/manual recovery |
| B41 /4 | B12/B15/B21/B23 | approved external AI agent/workflow connector: mTLS/OAuth signed callback, owner/scopes/timeouts/budgets | forged callback, wrong tenant, looped delegation, duplicate webhook denied |
| B42 /4 | B12/B14 | connector registry/API/MCP/DB/SaaS/browser and tenant credential references, per-operation egress/DLP | secret stays out model logs; blocked host/IP/SSRF, credential rotation, scoped revoke |
| B43 /4 | B14/B41/B42 | model gateway multi-provider routing/cost/fallback/local-first per classification | deny illegal egress, per-tenant budgets, provider outage and local fallback tests |
| B50 /5 | B30–33 | OS bridges for macOS/Linux by capability, accessibility/screen/input semantics, VM compatibility matrix | platform-specific tests, denied permissions, no identical-coverage claim |
| B51 /5 | B14/B43 | air-gap bundles, signed offline models/updates, private registries/dependencies; no hidden telemetry | packet capture zero external egress in isolated exercise, signed update/rollback |
| B52 /5 | B10–51 | full DR, exact-digest release, staging/prod CI gates, capacity and HA option under current platform program | real backup/restore, load/soak, signed admission, profile-specific SLO |
| B60 /6 | B20/B42 | IDP pipeline, private document classification and human correction | bilingual evaluation, errors and confidence recorded, PII/retention |
| B61 /6 | B10/B33 | opt-in mining and process intelligence, provenance and access boundaries | no employee covert capture, consent/revoke, false positive baseline |
| B62 /6 | B15/B33 | bounded multi-agent delegation and self-healing with policy/evaluation | loop budget, no impersonation, verified action outcomes |
| B70 /7 | evidence from B52/60 | federation/scale/connector marketplace and OEM expansion through approved demand | regional residency, isolation, scale, upgrade/rollback, provenance |

## Standard work-item implementation checklist
1. Establish exact current source and owner; record requirement IDs and expected externally visible behavior.
2. Determine existing owning service vs proposed bounded context; analyze cross-service invariants, DB/event contract, workload identity and SLO; create ADR only if required and approved.
3. Write public/internal schema and consumer examples with versioning; define actor/tenant/data classification, deadlines, cancellation, retry ownership, idempotency and audit.
4. Add failing characterization/contract/security/tenant/migration/regression tests; implement minimal adapter/domain use case without unrelated changes.
5. Check observability/PII leak, quota/concurrency/backpressure and dependency outage; run required tests+architecture checks, show exact commit evidence.
6. Make PR with complete diff and rollback/expand-contract plan, protected checks and approval; publish accurate implementation status, not false Production claims.

## First usable vertical outcomes
- V1 (B10–B15): authenticated human → server-only read/mock HTTP activity → durable timeline → result, no public device or autonomous mutation.
- V2 (B20–B23): scheduled Digital Worker → scoped memory → audited task → human-only approval → terminal result after restart.
- V3 (B30–B33): registered physical/Windows VM GUI automation with postcondition, session fail/wait, no credentials exposed.
- V4 (B40–B43): hybrid server→human approval→VM→server plus external agent governed callback and local/external routing; no duplicate side effects.
- V5 (B50–B52): tested supported Windows/macOS/Linux matrix, isolated-network package, release/DR evidence.

## Work that must not be conflated
A persistent Conversation ModelRun is not a generic multi-node WorkflowRuntime. Git-native developer Context Engine is not user memory. Windows developer Desktop MCP is not a tenant-managed device agent. A server worker with an offscreen browser is not a GUI VM guest. An AI provider endpoint is not an external non-human employee. Existing local kind/staging evidence is not customer production approval.

## Estimation and capacity method
No invented dates: after B00 establish measured scope and estimates per owning team (backend 1–N, frontend, device/native, inference, security, QA/SRE) using work-breakdown per contract+UX+deployment+negative tests. Profile functional prototype, controlled pilot, enterprise v1 and mature tracks separately. Price hardware/GPU/storage, endpoint OS support, commercial licensing, air-gap/HA operations and legal data retention by customer environment. Rebaseline after workflow/device/local-inference spikes, not before.
