# Migration, Cutover & Rollback Strategy

**Purpose:** restructure the entire codebase without destroying the current heavily dirty working tree, while moving from the legacy mixed architecture to the final Hexagonal/Clean implementation.  
**Important:** migration safety here concerns source/code/database cutover. It does **not** authorize destructive Git reset/clean operations on the user's repository.

---

## 1. Migration principles

1. The current working tree is the baseline. Never assume branch HEAD represents the user’s intended code.
2. Do not run `git reset --hard`, `git clean -fd`, mass checkout/revert, or delete unknown files to “get clean”.
3. Build the new architecture beside the old one, migrate vertical slices, then delete legacy paths only after cutover tests pass.
4. At no point may two externally reachable routes execute the same operation with different authorization policy after a slice is declared migrated.
5. Every schema/data migration is tested against a copy, never the original DB first.
6. Rollback of a code migration means return routing/composition to the prior known path or restore a DB backup where necessary—not destructive Git manipulation of user work.
7. Compatibility shims are temporary, inward-delegating only, and assigned a removal phase.
8. Public deployment remains disabled until R10 passes.

---

## 2. Pre-change baseline capture

Before R0 implementation:

- `git status --short --branch`;
- staged and unstaged diff summaries;
- list untracked files relevant to project;
- Node/pnpm versions;
- package-lock/pnpm-lock hash;
- current DB schema/version on a copy;
- current build/test/coverage results;
- current externally registered MCP operation inventory;
- current runtime config/runbook paths.

Record in `29_IMPLEMENTATION_PROGRESS_LEDGER.md`.

Do not commit/stage unrelated existing changes unless the user explicitly asks.

---

## 3. Strangler migration model

For each vertical slice:

```text
Legacy inbound route
      |
      +-- temporary compatibility mapper --> New application use case --> New ports/adapters

After acceptance:
New inbound route --> New application use case --> New ports/adapters
Legacy execution/policy path removed
```

Compatibility mapper rules:
- validates legacy DTO only;
- converts to new application command;
- cannot duplicate authorization/workspace/retry policy;
- cannot call old concrete service after cutover;
- tagged with `REMOVE_BY_Rx` comment or tracked task.

---

## 4. Slice cutover order

1. Operation catalog/domain types (no behavior cutover).
2. Workspace + filesystem read/list/search.
3. Filesystem mutations/backups.
4. Process + Git.
5. Task runner/recovery/lease/idempotency.
6. Package management/manifest compensation.
7. OAuth/authentication + HTTP/MCP v2 serving.
8. Observability/metrics/retention.
9. Project/memory/control-plane operations.
10. Legacy deletion and docs.

This order is chosen so security boundaries stabilize before higher-level transports depend on them.

---

## 5. Per-slice cutover checklist

Before routing external traffic to new slice:
- application use case tests green;
- real adapter contract tests green;
- exploit/regression tests green;
- legacy/new behavior parity verified for behavior intentionally preserved;
- changed behavior documented for audited defect fixes;
- architecture import gate green;
- no old bypass route remains registered for the migrated operation;
- telemetry/correlation still produced;
- progress ledger updated.

After cutover:
- grep operation ID and verify all externally reachable paths converge at intended use case;
- run targeted E2E through direct MCP and Task path;
- run broader suite;
- mark old implementation removal task ready.

---

## 6. Database migration cutover

### Preflight
1. stop/quiesce test fixture runtime;
2. copy representative current DB to temp/migration fixture;
3. verify DB opens and integrity check passes;
4. record schema version and relevant row counts;
5. run target migrations on copy;
6. run semantic repository round-trip tests;
7. run application smoke against upgraded copy.

### Production/local user DB upgrade
Only when implementation phase explicitly reaches migration gate:
1. stop runtime cleanly;
2. make consistent backup to configured backup directory;
3. verify backup integrity;
4. apply migrations;
5. verify schema and repository/application readiness;
6. start runtime;
7. preserve backup until operator accepts upgrade.

### Database rollback
If migration/cutover fails before new writes are accepted:
- stop runtime;
- restore verified pre-migration DB backup;
- run prior software/config composition;
- verify health.

If new-version writes have already occurred, automatic rollback may lose new data. Require explicit operator decision and migration incident procedure. Do not pretend a down-migration is safe unless specifically tested.

---

## 7. MCP SDK/protocol cutover

Use staged SDK v1 -> v2 approach defined in document 31:

1. add v2 packages while v1 remains;
2. migrate isolated adapters/tests;
3. v1 objects never cross into v2 code;
4. modern v2 HTTP/stdio E2E green;
5. route production composition to v2;
6. preserve explicit legacy protocol compatibility only if ADR-009 says so;
7. grep remaining monolithic v1 package imports;
8. remove v1 dependency only after zero imports and full E2E;
9. record supported protocol eras in generated docs.

Rollback during staging can route composition back to old adapter **only before** database/auth-token state changes make old server incompatible. Once OAuth token schema/semantics are live, rollback requires a compatibility plan or DB backup.

---

## 8. OAuth/token model cutover

The old bootstrap/master bearer cannot silently continue as the new client access token.

Safe transition:
1. introduce bootstrap token concept and issued-token tables;
2. run migration preserving operator secret source but not copying it into access-token table;
3. optionally accept legacy `MCP_ACCESS_TOKEN` only as deprecated bootstrap alias for one release;
4. old OAuth access tokens/master bearer are invalidated at cutover unless an explicitly bounded compatibility mode is implemented and security-reviewed;
5. notify operator/client that re-authorization is required;
6. dashboard sessions re-created under new model.

Do not maintain indefinite dual-auth acceptance.

---

## 9. Workspace-context cutover

Current global workspace state must not be copied into transport-session correctness state.

Transition:
- stdio composition creates one explicit local context initialized from config/current intended workspace;
- modern HTTP uses principal/application context rules from docs 08/31;
- new Tasks capture immutable WorkspaceScope at creation;
- old persisted Tasks without scope-version fields migrate conservatively using recorded executionContext where available;
- if historic task scope cannot be reconstructed safely, task is not auto-resumed and requires operator reconciliation/migration decision.

---

## 10. Task/recovery cutover

Before enabling new crash recovery:
- canonical mapper migration complete;
- existing interrupted tasks classified from DB copy fixture;
- unknown active/running legacy mutating steps are never automatically retried merely to migrate them;
- startup migration marks unsafe ambiguous legacy states as `outcome_unknown`/manual reconciliation according to migration rule;
- execution leases initialized without implying old running task succeeded/failed.

First startup after new recovery logic should produce an operator-visible safe summary of migrated interrupted/unknown tasks.

---

## 11. Tool catalog/API cutover

- generate current legacy operation inventory;
- map each to canonical OperationId;
- preserve names unless security/contract issue requires rename/deprecation;
- package restore should become truthful `package_manifest_restore` terminology; legacy alias can map inward with deprecation text during bounded window;
- no operation silently disappears without explicit owner-approved deprecation;
- generated `docs/TOOLS.md` becomes catalog authority.

---

## 12. Deployment cutover

Do not modify network-exposed production (owned by the external deployment project) automatically.

Local release candidate sequence:
1. build container/production runtime locally;
2. non-root/health/config/auth smoke;
3. modern MCP compatibility E2E;
4. migration copy test;
5. R10 report;
6. owner reviews and explicitly approves deployment.

Only then update service/watchdog deployment assets (tunnel/proxy assets live in the external deployment project). Keep a known previous binary/image/config backup for operational rollback, while recognizing DB/auth schema compatibility constraints.

---

## 13. Source rollback policy by phase

Because working tree is dirty, source rollback must be surgical:
- use file-level backups/patch history produced by tooling where available;
- revert only files changed by the current implementation changeset;
- never restore entire repository state from HEAD;
- before any rollback, compare current file to phase baseline to avoid erasing concurrent/user edits;
- if concurrent edits conflict, stop automatic rollback and document manual merge requirement.

Changesets/PR strategy in document 30 minimizes this risk.

---

## 14. Stop conditions

Stop a phase and mark gate FAIL if:
- regression cannot be reproduced safely or expected fix is ambiguous;
- architecture change introduces outward dependency into Domain/Application;
- DB migration cannot preserve/explicitly reconcile existing data;
- new path weakens any audit-preserved control;
- old and new routes remain externally executable with different security policy;
- test failure indicates possible user data loss;
- protocol SDK behavior differs from current official documentation and cannot be resolved from source/docs;
- public deployment would be required to validate a change without explicit user approval.

Do not push through a failed gate by disabling tests.

---

## 15. Final cutover requirements

R9/R10 cutover is complete only when:
- no legacy execution bypass path remains;
- all production imports follow target architecture;
- DB upgraded safely on representative copy;
- v2 MCP production path active and documented;
- legacy auth/config values removed or bounded migration alias documented;
- all traceability rows verified closed;
- clean-checkout CI passes;
- release artifacts/provenance recorded;
- owner receives final implementation report and explicit deployment decision remains pending.