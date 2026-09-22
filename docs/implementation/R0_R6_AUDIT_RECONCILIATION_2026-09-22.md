# R0–R6 audit reconciliation: verified discrepancies and corrective actions

Date: 2026-09-22
Repository: `D:/workspace/hooshix-agent`
Branch: `feature/r2-unified-tool-gateway-2026-09-20`
Starting HEAD: `412ca3e` (`test(r6): verify SQLite hot path and reconcile G6 evidence`)
Status: **audit discrepancies corrected in source/tests/traceability; G6 remains OPEN**.
This record does not certify deployment, production migration, or all R7–R10 findings.

## Reconciliation method and limits

The authoritative phase backlog is `21_PHASED_EXECUTION_BACKLOG.md`, gates are
`22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`, findings are
`20_FINDINGS_TRACEABILITY_MATRIX.md`, and the live phase summary is
`29_IMPLEMENTATION_PROGRESS_LEDGER.md`. Before changing implementation, inspect the
real workspace, tracked/untracked Git status, recent commits, current ledger and
actual task receipts. A historical record is dated evidence, not the current phase verdict.

The initial read-only R0–R6 audit task
`0ee713e5-373c-4a85-9e9d-e0b955faf30f` finished source+test TypeScript,
the full 163-file fixture suite (711 PASS + 3 expected RED), production build,
and strict G1 (189/0) successfully, but its final `git diff --check` step returned
`tool_handler_failure`; therefore the **task as a whole was not PASS**.
Do not relabel its partial successes or the executor error as a completed gate.
Subsequent scoped remediation and regression results are listed below.

## Finding 1 — previously closed MED-05 still had a live legacy file-audit defect

Observed in `src/services/filesystem/filesystem-service.ts`: the former
`audit()` wrapped both the business file effect and success-audit persistence in
one `try/catch`. If the success-audit sink rejected *after* a successful file
mutation, the catch attempted a failed-audit write and reported business failure,
risking a duplicate retry; a failed-audit sink could also mask the original
business error. Despite this, MED-05 was already marked VERIFIED_CLOSED.

Corrective action: isolate the business operation's own try/catch. Record success
or failure through `bestEffortAsyncTelemetry`, which increments the shared fixed,
non-sensitive degraded-telemetry counter/diagnostic without overriding a known
business outcome. Keep the original exception identity and do not add a retry.
`tests/core/r0-audit-failure-contract.test.ts` is now a **normal passing**
regression for successful mutation despite audit failure and for preserving the
original `Target already exists` error and original file contents despite
failure-audit rejection. The previously passing R3 telemetry tests remain active.

Evidence: task `b4b8cd85-822d-4bbe-b741-527b183cb6f8` 2/2 PASS; combined
task `69a9b49d-d0b0-43ba-960f-86acb1e9bbc6` 7/7 PASS.
MED-05's existing VERIFIED_CLOSED status is now supported along this legacy path;
it is not an additional finding-count increment.

## Finding 2 — HIGH-13 remained an expected-fail test after R3 claimed closure

The R0 legacy regression checked the obsolete
`task_execution_leases` table on an empty SQLite database without applying the
version-0 base schema. The R3.07 implementation actually creates `task_leases`
in version-12 migration with owner ID, unique lease token, monotonic version and
expiry. An obsolete `it.fails` on a nonexistent table cannot serve as evidence
that the product's new lease is absent.

Corrective action: initialize the disposable fixture with
`applyBaseSchemaMigration`, run the actual versioned migrator, assert the actual
`task_leases` table, and convert the old expected failure to a normal assertion.
Keep the independent *real* two-OS-process test
`tests/core/r3-durable-lease-multiprocess.test.ts`, which tests exactly one
winner and rejects the previous owner's fenced write after reacquisition.

Evidence: combined R0/R3 fixtures task `69a9b49d-d0b0-43ba-960f-86acb1e9bbc6`
7/7 PASS; independent production lease/fencing task
`97119ea3-382a-47c3-9c9e-0fb132b11488` PASS.
HIGH-13's already-closed status is not double-counted.

## Finding 3 — MED-25 was OPEN although R6.08's formatter and parser test passed

The source `src/mcp/metrics.ts` already emits one HELP/TYPE per family, escaped
sample labels, bounded series and lifetime counters. The permanent
`tests/core/r6-prometheus-exposition.test.ts` includes a local golden-grammar
parser-contract and optionally calls `promtool check metrics` when it is installed.

The matrix MED-25 row was corrected from OPEN to VERIFIED_CLOSED using the
existing source/fixture proof. Focus task `afbef316-bd0f-4639-b160-76823f7ba939`
rechecked the formatter and session metrics tests (4/4 PASS), followed by source
and test TypeScript PASS. **Do not claim external promtool ran**: its optional
branch skips when the executable is unavailable. Closure is based on the
always-executed local golden grammar and lifetime/escaping tests.

Finding totals after this correction: 30/54 VERIFIED_CLOSED (HIGH 10, MEDIUM 19,
LOW 1), 21 OPEN and 3 TEST_ENCODED. G7 HIGH-10 remains the only expected-fail
test in the current full suite; it is not a passing security regression.

## Finding 4 — R6 phase summary contradicted committed evidence

The R6 summary incorrectly said R6.07 was uncommitted and that the test-project
TypeScript compiler was still blocked with `tool_handler_failure`, even though
HEAD `412ca3e` already contains the R6.07 checkpoint and task
`0e6308a3-37a7-4064-a1ac-c156bbdc0c1d` successfully ran both
`tsconfig.r1.json` and `tsconfig.test.json`. The outstanding
`SearchBudgetLimits` source type-widening correction is retained and tested,
rather than dropped or silently claimed committed.

The live R6 status/current-task rows and matrix counts were reconciled; historical
dated `tool_handler_failure` records are retained as factual history, not as
the current gate verdict.

## Current validation and exact gate boundary

Task `055c74e0-53b1-4008-bfd7-38d45527b140` on the corrected candidate:
source and test TypeScript PASS; complete suite **163 files / 714 PASS +
1 expected HIGH-10 R7 failure / 0 unexpected failures**. This includes the
corrected ordinary MED-05 and HIGH-13 tests. The dedicated real production-lease
two-process test also passed. On the corrected candidate, task `b972b734-12f6-436f-aef5-c5b61c677a8b`
completed production build (PASS) and strict G1 (189 scanned files, 0
candidates); its final Git whitespace-check step returned
`tool_handler_failure` and is **not** claimed PASS. Verify the staged patch
independently before committing and keep the whole task's failed state visible.

**G6 is still OPEN.** The R6.04 version-17 index yields a measured
45–76x task-filtered Metrics query improvement but +54–128% synthetic
3,000-row insert latency. This >20% write trade-off is known and documented,
not a zero-regression claim or an authorization to change the live workload.
Production workload acceptance and release/migration rehearsal remain separate.
Do not mark G6 PASS merely because TypeScript and functional tests pass.

## Isolation and resumption

Only the approved reconciliation source, fixture, matrix and progress-ledger
changes may be included in the next scoped checkpoint. Preserve untracked EAAP,
`data/backups/`, prior recovery diagnostics, active OAuth clients, and all live
SQLite and MCP server state. Do not reset/clean the worktree, deploy, restart,
push or merge during this correction. A new chat/task must first read the
current Workspace, Git status/head, phase ledger, this evidence record and any
pending Task receipt; never infer success from a prior message or a timeout.

## Final reconciliation patch integrity

- The only tracked source/test changes in this audit are the MED-05 asynchronous audit telemetry boundary, the type-safe SearchBudget limit definition, and the formerly obsolete R0 MED-05/HIGH-13 regression tests. Changes to the findings matrix and progress ledger reconcile evidence and do not retrospectively alter old task receipts.
- After removing four surplus blank lines from the ledger EOF, approval-gated task `04c42d0f-59a5-45bc-aa1c-65d59f90f6b3` completed `git diff --check` with exit code 0 and no whitespace errors. Prior attempts that failed at the executor remain recorded as failed; they are not retroactively converted to success.
- Real source/test TypeScript, full 163-file regression (714 PASS, one intentionally expected R7 HIGH-10 failure), production build and strict G1 (189 source files, zero verified violations) are individually PASS in the tasks cited above. The outstanding G6 performance acceptance remains OPEN pending a workload-representative write/query decision; the source fixes may be committed as a limited reconciliation checkpoint without closing G6.
