# Step-by-step engineering execution manual (for future AI implementer)

This playbook is a reusable procedure **inside** existing HooshiX milestones and the eight EAAP capability tracks. It is not a new project phase and cannot authorize implementation now. Current request produced documents only.

## Before first implementation PR
- Inspect `/home/coder/workspace/Hooshix` current Git branch/HEAD/dirty status, `origin/main` and protected PR. Run `make context-verify`, `make context-bootstrap`, `make baseline-verify` when available and accepted. Read AGENTS/current docs/ADR register/implementation-status/application+engineering roadmap/current code/tests/contracts. On a non-main active feature branch, do not switch/reset/merge/discard work without explicit compatible repo workflow and owner authorization.
- Compare current Stage 9 acceptance to code and protected CI; finish only that already-active stage and preserve deferred commissioning. If completed in latest Git, record proof and avoid reapplying past effects.
- Read entire self-contained EAAP package; produce traceability diff by requirement ID and one RFC documenting scope and conflicts, especially new principal/permission, new deployable/persistence, workflow runtime, guest/device trust, provider egress and air-gap.
- Mark decision candidates in 20 as pending; seek explicit approval for actual irreversible/destructive/security/product architecture choices, but carry out reversible safe design/tests in authorized scope.
- Generate approved capability→owner/service/module/contract/test/PR map. A new deployable is not required merely because this playbook gives a component a name.

## One coherent increment workflow
1. **Define:** name requirement/backlog IDs, exact user journey and one observable result; enumerate preserved current behaviors and release/negative gates.
2. **Inspect:** trace real request from browser BFF→owner service→DB/event/provider to response; inspect current behavior/validation/errors and tests; update threat model and compatibility map.
3. **Decide:** if no new ADR needed, document why within current contracts; if new trust boundary/data model/new service/technology or security behavior, draft reviewed HooshiX RFC/ADR and obtain approval before implementing the behavior. Never alter a settled decision by referencing original EAAP monolith.
4. **Design:** owner aggregate/state transitions + typed schemas/validation + permission/tenant/egress + effect classification + lifecycle/retention + timeouts/retries/idempotency/leases/observability + operational cost/capacity. Define positive and negative acceptance fixtures *before* code.
5. **Implement:** branch from current appropriate main per repository rules and scoped draft PR; service-owned migrations/ports/adapters/tests; avoid unrelated refactor. Preserve contract compatibility/expand-contract and feature flags disabled by default on sensitive provider/device paths.
6. **Verify:** unit/property/architecture/security/RLS/migration/contract/dual-version/browser/device/integration, realistic restart/duplicate/outage/PII tests; existing full baseline; local end-to-end; staging/OS/provider and production only when scope and environment authorize. Report exact commands/commit with Passed/Failed/Not verified.
7. **Review and release:** complete PR diff vs current main and owner/security approvals, CI, versioned doc/ADR/traceability/implementation status; use protected merge process. Rollback runbook, schema compatibility and no duplicate external effect on replay.
8. **Complete:** record feature evidence level, remaining risks and exact next backlog dependency; do not advance past an incomplete prerequisite. Send one coherent completion report.

## Exact first development packages (future only)
**Increment A — current-stage closeout:** no agent/workflow/tool/VM in existing Stage 9; accept only current Conversation model-eval, activation gate, telemetry, cancellation, privacy and existing tests. If already closed by current HEAD, report no-op and move to RFC.

**Increment B — capability architecture RFC:** source-evidenced matrix + authoritative owning contracts for execution, non-human actor, model gateway, device gateway, memory and approval; decide which existing owner modules can absorb each and which require new independently deployable boundary. Benchmark time/cost/airgap/run history, no premature framework replacement.

**Increment C — server-only durable vertical:** typed BFF task submission -> versioned workflow definition -> durable run/step -> approved mock API/tool -> postcondition -> timeline; exercise worker shutdown/resume, idempotency, tenant isolation and no forbidden connector egress.

**Increment D — internal worker + memory + human approval:** schedule independent of chat -> scoped memory read -> only allowed tool -> human approval before mutation -> resumable audited result. Explicit existing Identity/Authorization permission integration and key/retention.

**Increment E — Windows physical and VM:** independent tenant enrollment -> outbound device gateway -> session/capability discovery -> one accessibility-based action -> verified outcome -> audit. Distinct VM key; locked/absent session safe wait.

**Increment F — hybrid/external:** server -> policy-approved external agent -> await signed callback and human approval -> device VM -> server; replay/timeout/cancel + external egress tests.

**Increment G — enterprise release and intelligence:** OS matrix, offline+local model, signed exact-digest release, DR/scale, then later IDP/mining and scale tracks. Each increment is decomposed into PRs by coherent ownership, not arbitrarily one PR per node.

## Pull request template for implementer
```text
User journey / requirement and backlog IDs:
Exact HEAD/current ADRs and source inspected:
Ownership and boundary decision + approved ADR (if applicable):
Before/after request/data/control flow and compatibility:
Positive/failure/security/tenant test plan:
Contracts, auth scopes, DB migration and expected idempotency:
Deadline/retry/cancel/outage/observability/PII/egress:
Module and deployment changes; feature flags:
Build/lint/test/CI executed (exact SHA/artifacts):
Staging/OS/production evidence or NOT VERIFIED:
Rollback/DR/known risk/decision required:
```
