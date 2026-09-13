# Changeset, Branch & PR Strategy

**Purpose:** make a full architectural restructuring reviewable and recoverable without destroying the known dirty working-tree baseline.  
**Important:** this document defines logical changesets even if the implementation assistant cannot or should not create actual PRs during every phase.

---

## 1. Core principles

1. Never normalize the existing dirty tree with reset/clean/revert.
2. Separate architecture scaffolding, behavior fixes, migrations and formatting.
3. Every changeset has explicit finding/task IDs.
4. A changeset should be reversible by its own patch where practical without relying on branch HEAD.
5. No phase mixes broad whitespace/line-ending cleanup with security/data-integrity changes.
6. Database migrations and code that requires them land together or behind compatibility sequencing documented in migration plan.
7. Do not delete old path before new path has E2E acceptance coverage.
8. CI remains green at changeset boundaries except intentionally failing regressions during R0, which must be clearly marked and eliminated by corresponding phase.

---

## 2. Branch strategy recommendation

Because current branch/working tree is heavily modified, the implementing assistant must first inspect the user’s Git intent.

Preferred if user allows branch creation from current work:
- create a dedicated redesign branch **without discarding current changes**;
- preserve current worktree state exactly;
- commit/stage only redesign-owned changes after reviewing staged diff.

If branch/commit operations would mix pre-existing uncommitted work, do not force a branch workflow. Use documented changeset batches and ask owner only when an actual commit/PR boundary requires it.

Never commit all existing dirty files merely to make a baseline unless explicitly instructed.

---

## 3. Logical PR/changeset sequence

### CS-00 — Test fixtures + audit regressions
Scope: R0 only. No behavior fixes.

### CS-01 — Domain/Application/Ports skeleton + architecture gates
Scope: R1 core architecture types, fake composition, import rules.

### CS-02 — MCP SDK v2 migration foundation
Scope: package split/codemod review, isolated modern server adapters/tests; no auth redesign mixed unless necessary.

### CS-03 — Operation catalog + centralized authorization/workspace
Scope: HIGH-01/02/03 and MED-04/28 foundation; filesystem read/search vertical slice.

### CS-04 — File mutation + CAS/idempotency gateway
Scope: direct/Task parity and new FS adapter/application handler.

### CS-05 — Process/Git authorization migration
Scope: safe command policy, cwd/path args, Git adapter.

### CS-06 — Task repository/use cases + canonical hydration
Scope: split old runtime, preserve behavior before recovery change.

### CS-07 — Execution receipts/reconciliation/timeout/lease/idempotency
Scope: HIGH-05/06/07/13, MED-05/08/09.

### CS-08 — Backup/restore/Git snapshot/package compensation + schema
Scope: R4.

### CS-09 — OAuth issued-token persistence/application policy
Scope: HIGH-04; fake-clock tests.

### CS-10 — MCP modern HTTP/stdio + auth integration
Scope: SDK v2 production cutover, modern protocol, host/scope/issuer behavior.

### CS-11 — HTTP rate/dashboard/health/config integration
Scope: MED-01/03/29, HIGH-11/12 integration.

### CS-12 — Persistence cleanup/retention/performance indexes
Scope: R6 DB lifecycle; evidence-backed indexes only.

### CS-13 — Observability/redaction/Prometheus/session metrics
Scope: MED-02/05/19/20/25.

### CS-14 — Typed configuration + services/runbooks migration
Scope: R7 config/PATH/docs scripts.

### CS-15 — Docker + CI/supply-chain gates
Scope: HIGH-10, MED-13/14 and release checks.

### CS-16 — Test isolation/property/coverage hardening
Scope: R8.

### CS-17 — Legacy deletion + final docs generation
Scope: R9; no functional changes unless required to remove compatibility shim.

### CS-18 — Final release-validation evidence only
Scope: R10 fixes limited to validation-discovered defects; larger changes return to appropriate logical changeset/review scope.

Actual PR count may combine adjacent low-conflict changesets, but do not collapse the entire redesign into one unreviewable patch.

---

## 4. PR description template

```text
## Scope
Implementation tasks: R?-??
Audit findings: HIGH-.. / MED-.. / LOW-..
ADRs: ...

## Architecture
Layers changed:
Dependency direction impact:
Legacy paths removed/temporarily retained:

## Behavior changes
- ...

## Security/reliability rationale
- ...

## Data/schema migration
- none / migration IDs + upgrade/rollback notes

## Tests
Regression-first tests:
Commands/results:
Coverage/benchmarks:

## External docs rechecked
- official URLs/date if protocol/dependency-sensitive

## Dirty-tree safety
Pre-existing changes preserved:
Unrelated changes included: NO / explain

## Compatibility/deprecation
- ...

## Traceability
Progress ledger updated: YES
Finding matrix statuses updated: YES

## Review focus
- ...
```

---

## 5. Commit discipline

If commits are requested:
- conventional concise messages where practical;
- one purpose per commit;
- do not commit generated secrets/DB/logs/test runtime artifacts;
- inspect `git diff --staged` before commit;
- never use `git add -A` blindly in dirty repository;
- stage explicit paths/hunks owned by current changeset;
- avoid rewriting user history/amending unrelated commits.

Suggested messages:
- `test(security): encode workspace and search exploit regressions`
- `refactor(architecture): add domain application and port boundaries`
- `fix(authz): centralize workspace and tool authorization`
- `fix(recovery): reconcile unknown effects before retry`
- `fix(oauth): issue expiring resource-bound access tokens`
- `build(mcp): migrate server adapters to sdk v2`

---

## 6. Migration compatibility commits

When a schema migration changes both old/new compatibility:
- migration must land before code that assumes new columns, or same atomic release changeset if application runs migrations before repository access;
- adapter code should tolerate only intentionally supported old schema through migration runner, not broad catch-ignore fallbacks;
- DB version gate at startup makes partial deployment explicit.

Do not create a commit where old binary corrupts new schema or new binary silently misreads old data without documented rollout sequencing.

---

## 7. MCP v1/v2 changeset safety

During staged SDK migration:
- package manifest may contain both v1/v2 temporarily;
- files are clearly v1 legacy vs v2 new adapters;
- no v1 SDK object passes into v2 API;
- production composition remains on one side at a time;
- after v2 cutover and compatibility tests, remove v1 in a dedicated changeset with grep proof.

This keeps protocol upgrade review distinct from application business-rule changes where possible.

---

## 8. Review ownership by risk

Highest-risk changes requiring focused review:
- authorization/workspace/command policy;
- OAuth/token lifecycle;
- timeout/crash/reconciliation/lease;
- migrations/data compensation;
- Docker/config/auth public deployment;
- MCP protocol/SDK migration.

Architecture-only file moves without behavior must still pass import tests but should not be used to hide functional security changes.

---

## 9. Formatting/renaming policy

Large renames make behavioral diff review harder.

Strategy:
- first introduce target abstraction/use case with minimal moves;
- migrate behavior;
- then mechanical move/delete legacy file in a distinct changeset if possible;
- isolate line-ending/format normalization near R9.

Use `git diff --find-renames`/review tooling if available, but do not depend on Git history as the only evidence of safe migration.

---

## 10. Failed changeset recovery

If a changeset breaks gate:
1. do not reset whole repository;
2. identify files/hunks introduced by that changeset from ledger/diff;
3. restore only those changes using tool backups/targeted patches if safe;
4. verify pre-existing user edits remain;
5. record failure/reason in ledger;
6. revise spec/ADR if design assumption was wrong.

---

## 11. Final merge/release conditions

The final redesign branch/change series is ready for owner review only when:
- R10 passes;
- matrix 54/54 verified closed;
- no temporary expected-fail tests;
- no stale compatibility shim past deadline;
- final docs generated/current;
- intended changes are reviewable separately from pre-existing unrelated dirty work;
- no public deployment occurred automatically.