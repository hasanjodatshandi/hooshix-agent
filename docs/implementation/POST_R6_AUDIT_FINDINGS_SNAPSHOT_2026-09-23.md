# Audit findings parked for post-R6 execution — 2026-09-23

Workspace: `D:/workspace/hooshix-agent`
Branch at capture: `feature/r2-unified-tool-gateway-2026-09-20`
HEAD at capture: `2dd4837`

## Purpose and execution boundary

This is a **non-authoritative carry-forward snapshot** of the previously requested 54-finding audit recap, so its outstanding items are not lost while the existing R6 execution continues. The authoritative finding states remain in `20_FINDINGS_TRACEABILITY_MATRIX.md`; the phase plan and gates remain `21_PHASED_EXECUTION_BACKLOG.md`, `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md`, and `29_IMPLEMENTATION_PROGRESS_LEDGER.md`. Do not create another stage, reopen a closed finding without contradictory fresh evidence, or implement R7–R10 items as part of R6.

Original consolidated audit: `../HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md` (2026-09-06). Reconciliation: `R0_R6_AUDIT_RECONCILIATION_2026-09-22.md`.

At capture: **54 total, 30 VERIFIED_CLOSED, 21 OPEN, 3 TEST_ENCODED** (HIGH: 10 closed/3 test-encoded; MEDIUM: 19 closed/10 open; LOW: 1 closed/11 open). These are documented isolated-branch states, not deployed-runtime certifications. R0–R5 gates passed; R6.01–R6.09 code/fixture work recorded, **G6 OPEN**; R7–R10 not started; public deployment not approved.

## Finding register (snapshot; consult matrix for updated status/evidence)

| ID | Issue | Status at capture |
|---|---|---|
| HIGH-01 | Workspace scope mutation/unauthorized unrestricted sandbox | VERIFIED_CLOSED |
| HIGH-02 | Sensitive-file search denylist bypass | VERIFIED_CLOSED |
| HIGH-03 | Git diff --no-index external disclosure | VERIFIED_CLOSED |
| HIGH-04 | OAuth expiry/master-token/refresh contract | VERIFIED_CLOSED |
| HIGH-05 | Timeout before process termination confirmed | VERIFIED_CLOSED |
| HIGH-06 | Crash recovery duplicate uncertain side effects | VERIFIED_CLOSED |
| HIGH-07 | Incomplete crash Task hydration | VERIFIED_CLOSED |
| HIGH-08 | Dirty Git rollback destroys unrelated work | VERIFIED_CLOSED |
| HIGH-09 | Package rollback overclaims environment reversal | VERIFIED_CLOSED |
| HIGH-10 | Docker frozen-lockfile fallback | TEST_ENCODED (R7) |
| HIGH-11 | Auth env drift and static secret examples | TEST_ENCODED (R7/R5) |
| HIGH-12 | Protected /health vs unauthenticated health probe | TEST_ENCODED (R7/R5) |
| HIGH-13 | Process-local duplicate Task execution guard | VERIFIED_CLOSED |
| MED-01 | Query-string bearer token | VERIFIED_CLOSED |
| MED-02 | Separate secret argument leaked to audit log | VERIFIED_CLOSED |
| MED-03 | HTTP rate/concurrency budget missing | OPEN (R5/R6) |
| MED-04 | Shell cwd not scope validated | VERIFIED_CLOSED |
| MED-05 | Audit sink masks completed business effect | VERIFIED_CLOSED (reconciled) |
| MED-06 | Direct MCP file CAS/idempotency parity | VERIFIED_CLOSED |
| MED-07 | Noncanonical Project identity | VERIFIED_CLOSED |
| MED-08 | Task idempotency payload hash omitted | VERIFIED_CLOSED |
| MED-09 | Terminal Task append allowed | VERIFIED_CLOSED |
| MED-10 | Reused absent-backup makes empty file | VERIFIED_CLOSED |
| MED-11 | Restore revision guard missing | VERIFIED_CLOSED |
| MED-12 | Restore target tied to mutable workspace | VERIFIED_CLOSED |
| MED-13 | Root/mutable-tag container | OPEN (R7) |
| MED-14 | No required CI gate | OPEN (R7) |
| MED-15 | NVM/PATH bootstrap not reproducible | OPEN (R7) |
| MED-16 | Incompatible production runbooks | OPEN (R7/R9) |
| MED-17 | Actual Metrics queries under-indexed/under-benchmarked | VERIFIED_CLOSED (G6 write trade-off separate) |
| MED-18 | Startup-only/incomplete retention | VERIFIED_CLOSED |
| MED-19 | Unbounded historical session metrics | VERIFIED_CLOSED |
| MED-20 | Schema PRAGMA on every tool call | VERIFIED_CLOSED |
| MED-21 | Missing permanent exploit regressions | OPEN (R8) |
| MED-22 | HTTP/OAuth transport tests insufficient | VERIFIED_CLOSED |
| MED-23 | Global coverage masks critical per-file gaps | OPEN (R8) |
| MED-24 | Multiworker test fixture collisions | OPEN (R8) |
| MED-25 | Invalid Prometheus HELP/TYPE format | VERIFIED_CLOSED (reconciled; external promtool not run) |
| MED-26 | Incomplete dependency inversion | OPEN (R1–R9) |
| MED-27 | Oversized Task runtime/loop responsibilities | OPEN (R1–R9) |
| MED-28 | Direct MCP vs durable Task adapter drift | VERIFIED_CLOSED |
| MED-29 | Host-header trust/CORS wildcard | VERIFIED_CLOSED |
| LOW-01 | Absolute paths in search results | VERIFIED_CLOSED |
| LOW-02 | Silent schema-drift catches | OPEN (R6/R9) |
| LOW-03 | Duplicate audit/recovery legacy layers | OPEN (R9) |
| LOW-04 | Fragile git-log flag argument construction | OPEN (R2/R9) |
| LOW-05 | Dead config/config.json | OPEN (R7/R9) |
| LOW-06 | Repository runtime-data noise | OPEN (R9) |
| LOW-07 | Bootstrap token file mode / platform ACL | OPEN (R5/R7) |
| LOW-08 | Missing persistent property/fuzz suite | OPEN (R8) |
| LOW-09 | lint script only invokes typecheck | OPEN (R8) |
| LOW-10 | Whitespace/line-ending churn | OPEN (R9) |
| LOW-11 | README tool catalog incomplete | OPEN (R9) |
| LOW-12 | Documentation/repository source of truth unclear | OPEN (R9/R10) |

## R0–R6 audit reconciliation (not four additional finding IDs)

1. MED-05: previously marked closed while legacy file success-audit failure could mask the committed effect; legacy failure/success telemetry isolation and permanent passing regression were corrected.
2. HIGH-13: old expected-fail fixture asserted a nonexistent legacy table instead of migrated `task_leases`; actual schema fixture and two-process fencing regression now pass.
3. MED-25: formatter/golden grammar fixture already passed while matrix remained OPEN; state reconciled. External optional `promtool` was **not** run.
4. R6 ledger: stale R6.07 commit/compiler status corrected; full corrected suite 163 files / 714 passing + one expected R7 HIGH-10 red, source/test TypeScript, build and G1 pass. Historical executor failures remain historical failures, not retroactive passes.

## R6-specific outstanding gate, not to be confused with R7–R10

G6 remains OPEN because v17 `idx_tool_calls_task_category_created_at` produced a measured 45–76x filtered Metrics query improvement but **+54–128% synthetic 3,000-row insert latency** in the isolated 250k-row A/B benchmark. Non-filtered query profiles were noisy. This exceeds the gate's material-regression threshold; acceptance requires documented representative workload reasoning/evidence and appropriate ownership of the trade-off. Do not imply benchmark acceptance, modify the live DB, or advance to R7 on a merely passing functional suite.

Relevant evidence: `R6_03_METRICS_QUERY_BENCHMARK_2026-09-22.md`, `R6_04_METRICS_INDEX_AB_REPORT_2026-09-22.md`, and `R0_R6_AUDIT_RECONCILIATION_2026-09-22.md`.

## Later execution

Once G6 is honestly resolved, resume the **existing** R7→R8→R9→R10 plan, retaining original phase count, finding IDs and acceptance gates. Re-read the live matrix and progress ledger at that time rather than trusting this dated snapshot. No changes to findings, their authority, priorities or implementation stages are authorized by this reminder file.
