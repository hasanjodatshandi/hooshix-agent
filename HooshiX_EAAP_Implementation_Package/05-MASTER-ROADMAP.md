# Master roadmap: preserve HooshiX stages, deliver EAAP capabilities

## Stage policy
The HooshiX application's actual live roadmap remains authoritative: at the observed 2026-09-20 snapshot, active Stage 9 implements private Conversation+ModelRun under ADR-0054/0057; Production Commissioning is explicitly DEFERRED. Do not jump ahead, insert EAAP code into Stage 9, declare it complete on the basis of this package, or auto-reactivate production.

EAAP's original **eight product phases 0–7 remain eight capability tracks**, *not replacement HooshiX implementation stages*. Work for an EAAP track starts only after current HooshiX milestone prerequisites and the relevant review/ADR/PR approvals. Track numbering is for EAAP scope traceability; within each track subitems are tasks, not top-level phases. No calendar commitment carries over automatically from the earlier standalone EAAP staffing assumptions.

## Mandatory pre-extension gate: reconcile existing HooshiX milestone
Snapshot exact Git/branch/HEAD and dirty state. Complete Stage 9 on its **existing** scope only (provider safety/data-control evaluation, telemetry and transport cancellation, approved activation path, release/evidence as currently prescribed; no workflow/agent/tools/RAG). Run all current source, strict service, frontend, contract, negative/security, model policy and protected CI gates. Leave production commissioning deferred. Produce a separate owner-reviewed EAAP extension RFC/ADRs after this gate. If current repo already completed Stage 9, do not replay it; prove completion from current Git and advance appropriately.

## Phase 0 — compatibility and engineering foundation
Purpose: preserve current HooshiX, freeze a source-proven integration baseline, identify all EAAP vs HooshiX conflicts. Deliver requirement→owner→contract→test matrix, active-ADR differential, bounded context/use-case map, tenant/actor/device threat and dataflow models, current capacity/SLO baselines, representative VM + server fixture, reversible spikes for workflow engine/local model/device RPC without production adoption. Reuse existing CI/contract registry/telemetry/PR process. **Exit:** architecture RFC reviewed, known incompatibilities resolved or owner-gated, one existing human-authenticated BFF→ModelRun and independent current security baseline verifiably intact. No new runtime required.

## Phase 1 — server automation and orchestrator foundation
Scope: versioned workflow definitions and durable server execution, canonical task/step contracts, typed Tool Registry, API/MCP connector adapters, bounded Agent Runtime skeleton, model/inference port and a local model in a gated test environment. Do not create new service for each node; use owner-driven bounded contexts and independently scalable workers only where justified. First vertical workflow: authorized BFF request → durable server API/mock operation → audit/timeline → result; restart/crash/duplicate/deadline tests. **Exit:** one server-only tenant-isolated durable workflow completes after worker restart; local-only model invocation path demonstrably works with network egress blocked; no current Conversation policy bypass.

## Phase 2 — memory, Digital Workers, workflow authoring and approvals
Scope: user/worker memory scopes and lifecycle, encrypted owned memory store and tenant-filtered retrieval, internal non-human worker identity and delegation limits, schedules, workflow canvas, action center, human approvals, waits/parallel/subflows/versions and promotions. First vertical: worker scheduled without chat → retrieves only own permitted memory → executes read-only server workflow → authorized human approval for mutation → resumes once. **Exit:** cross-chat recall + edit/delete + tenant leakage tests; scheduled worker success without active user session; human-only approval with durable restart/replay.

## Phase 3 — Windows endpoint and VM RPA
Scope: versioned device action protocol, device registry/enrollment/renew/revoke, outbound guest/physical endpoint agent, Windows accessibility UI automation, screenshot/vision fallback, local credential broker, attended/unattended/session policy, per-device lease/safe cancellation, evidence replay, Teach Mode prototype. Start with enrolled physical Windows and independent Windows VM. No remote-desktop privilege bypass. **Exit:** same authorized GUI workflow on physical and VM when interactive session present; no-session WAIT/DENY; clone-identity/tenant-crossing/endpoint-local-policy negative; postcondition and reconnect evidence.

## Phase 4 — hybrid execution and external integrations
Scope: durable SERVER→DEVICE→SERVER activity coordination; headless browser; approved SaaS/API/DB/REST/MCP ecosystem; externally managed agent/workflow as non-human principal; model provider policy routing, typed callbacks and limited DLP. First vertical: server analyzes artifact using allowed local or approved external specialist → gated human approval → virtual endpoint enters final values → result callback → audit and compensating/manual recovery when uncertain. **Exit:** one full hybrid workflow, retry and timeout safe, external agent collaboration with authenticated callback and explicit permission denied path; model egress policy blocks classified data before network call.

## Phase 5 — cross-platform and enterprise production hardening
Scope: macOS and Linux endpoint implementations behind same guest/action/capability contract; publish OS/Wayland/X11/VM capability differences; offline packaging and signed updates; local-only models; enterprise SSO mapping where not already supported; scale/HA optional expansion through existing HooshiX production profile program; load/DR/security/tenant isolation/evidence retention and Dev/Test/Prod promotions. Do not change initial production-single-server silently: validate that profile, then HA only via approved expansion decision. **Exit:** supported OS fixture tests; complete isolated-network install/update/workflow with no Internet; exact signed release, actual restore, load/security gates on accepted hardware/profile; distinct claims for single-server vs HA.

## Phase 6 — intelligence expansion
Scope: document extraction/classification/validation (IDP); opt-in task/process mining with redaction/consent; semantic action self-healing; bounded multi-agent work sharing; enterprise knowledge and CoE registry. Deliver independent module/service only where measured ownership and scale require it. **Exit:** representative data/locale accuracy and false-positive evaluation, retained audit and provenance, human correction path, data deletion propagation, governed mining opt-in/out and no cross-tenant insights.

## Phase 7 — scale and ecosystem
Scope: regional execution zones, large device fleets, independent inference scheduling, connector marketplace and capability-certified additional endpoint classes, advanced policy-as-code and OEM integration **only by observed enterprise demand**. **Exit:** SLO/load/soak/partition tests at accepted scale per region, marketplace permission/provenance/revocation, upgrades and disaster recovery without violating data residency. No arbitrary feature parity claim.

## Cross-track dependency graph
```text
Existing HooshiX active Stage 9 accepted and verified
  -> Phase 0 compatibility/security/boundary decisions
  -> Phase 1 workflow state + tool/agent model + approved model port
  -> Phase 2 schedule, memory, non-human identity, human approvals
  -> Phase 3 device registry/gateway/physical+VM
  -> Phase 4 hybrid, external agents, connector/ecosystem + routing
  -> Phase 5 OS/air-gap/release/HA conditional hardening
  -> Phase 6 IDP/mining/self-healing
  -> Phase 7 demand-driven scale/ecosystem
```
Parallelism: isolated design/benchmarks may run without changing active Stage 9. After Phase 0 sign-off, UI authoring, workflow ownership, local inference spike, device agent protocol test fixtures and security threat modeling may progress in parallel **only** when contracts and milestones are stable and current repo plan permits. No team may treat a Phase label as permission to bypass prerequisite PR/ADR.

## Roadmap deliverable contract
Every phase exits with: changed ownable capability and exact repo paths; accepted ADR/contract versions and compatibility; threat-model delta; tests positive/negative/restart/cancellation; local staging/evidence report; operational runbook/rollback; approval and PR status; status marked designed/source/local/staging/prod separately. See 06,17,19.
