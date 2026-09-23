# R6 G6 continuation — pinned A/B rerun and unresolved workload acceptance

Date: 2026-09-23
Workspace: `D:/workspace/hooshix-agent`
Feature branch at start: `feature/r2-unified-tool-gateway-2026-09-20`
Starting HEAD: `2dd4837`
Scope: existing R6 persistence/performance/observability only; **no new phase**.
Execution Task: `608d498c-3717-4e42-b503-2dd719b3798b`.

## Blocker diagnosed and minimal repair

The R6.04 benchmark script `scripts/r6-index-ab-benchmark.mts` originally obtained the pre-v17 migrator using `git show HEAD:src/core/memory/database/migrations.ts`. That is no longer reproducible now that v17 is part of HEAD: the script correctly refuses a baseline containing the candidate index. Its historical input is now pinned to **`ad96009`**, the verified R6.03 commit whose real migration implementation ends at v16. The script keeps its baseline-version and absent-index assertions and executes the CURRENT real v17 migrator only on its newly created, marker-owned temporary SQLite fixture. This changes only benchmark provenance, not the application schema, query, indexes, operational database or service.

## First pinned rerun: actual adapter with 250,000 disposable tool_calls

The pinned R6.03 v16-versus-current v17 benchmark returned exit 0, actual migration version 16->17, 250,000 retained records, equal normalised adapter result payloads, `quick_check=ok`, and the expected task/category/time index plan. Node v24.18.0 / win32.

| Query profile | v16 median | v17 median | Interpretation |
|---|---:|---:|---|
| Filtered task/category/date | 272.047 ms | 4.530 ms | ~60x faster |
| Global snapshot | 165.525 ms | 175.337 ms | ~5.9% slower median; p95 181.954->231.396 ms (noisy) |
| Offset 1000 | 170.762 ms | 148.871 ms | ~12.8% faster median |

The same run's three rollback-only 3,000-insert measurements are noisy:
- v16: 20.717 / 35.079 / 40.479 ms (median 35.079 ms)
- v17: 45.187 / 28.716 / 26.702 ms (median 28.716 ms)

A single negative median delta **does not cancel** three prior matched repetitions demonstrating +54.2%, +54.9%, and +127.8% v17 insert cost. The unstable samples prevent an assertion that write cost was eliminated. Extra index storage remains 3,304 pages at 250k fixture rows. R6.04's original controlled results remain the comparative evidence; no selective reclassification of the gate is justified by this one noisy run.

## Acceptance boundary

R6.01–R6.09 source and fixture work had already been recorded before this follow-up. No new substantive audit finding has been implemented here. A representative operating workload (task-filtered dashboard request frequency, sustained and peak inserts, acceptable write latency and concurrent readers/writers) was **not** supplied or measured on a permitted production-like workload. Do not reverse the previously selected index or silently accept its >20% observed write regression merely because the isolated query speedup is material. The unresolved G6 write/query trade-off requires a documented workload-based acceptance decision consistent with the existing Gate G6; it is not a reason to start R7 or claim release readiness.

No active local DB migration, service restart, deployment, push, merge, user-backup manipulation, rollback, or unrelated untracked-file modification was requested or performed by this report. Later findings and their current statuses have been parked in `POST_R6_AUDIT_FINDINGS_SNAPSHOT_2026-09-23.md` without changing their authoritative matrix.

## Validation on the current feature branch

HooshiX Task `608d498c-3717-4e42-b503-2dd719b3798b` completed all five steps successfully on the current R6 source: pinned v16/v17 250k-row disposable benchmark PASS; `pnpm run typecheck` source and test TS PASS; `pnpm exec vitest run` 163 test files / 714 passing assertions + **one expected R7 HIGH-10 failing contract** / zero unexpected failures (exit 0); `pnpm run build` PASS; strict global G1: 189 scanned source files / zero verified violations PASS. This validates current implementation and benchmark reproducibility, **not G6 trade-off acceptance or G7**. R7 HIGH-10 remains intentionally unclosed.

## Additional independent A/B repetitions and local observed workload — 2026-09-23

Task `3d075107-05b8-40ae-ac35-cffb65f37dff` completed two further **independent** disposable 250k-row pinned v16/current v17 runs (both exit 0; `quick_check=ok`; identical normalized Metrics payloads; same planned task/category/time index). Comparisons below are paired within each run, not pooled samples across differing machine conditions:

| Pinned run | Filtered v16 -> v17 median | 3,000-row insert v16 -> v17 median | Insert delta |
|---|---|---|---|
| Additional A | 285.802 -> 6.008 ms (~47.6x faster) | 18.441 -> 25.941 ms | +40.7% |
| Additional B | 297.189 -> 5.342 ms (~55.6x faster) | 18.825 -> 25.387 ms | +34.9% |

The earlier 2026-09-23 single replay observed an inverse median for three short, noisy insert samples (35.079 -> 28.716 ms) while both additional runs confirm a material index-maintenance write penalty. Together with three original R6.04 repetitions (+54.2%, +54.9%, +127.8%), **five of six paired median runs show >20% insert regression**. This is a genuine measured trade-off, not an unexplained failure or a confirmed safe production write SLA. Global/paged Metrics medians varied by run and are not certified regression-free at p95.

A read-only query of existing HooshiX `agent_metrics` was used to assess **observed local activity**, without reading or mutating the operational DB file directly. UTC 24-hour historical periods:

| UTC interval | Existing tool_calls reported |
|---|---:|
| 2026-09-20 00:00 -> 2026-09-21 00:00 | 4,149 |
| 2026-09-21 00:00 -> 2026-09-22 00:00 | 1,782 |
| 2026-09-22 00:00 -> 2026-09-23 00:00 | 2,118 |

All 2,118 calls from the last complete period were read through five 500-result pages solely to aggregate timestamp/tool statistics; no individual call data or sensitive arguments were stored in this report. Observed maximum: **58 calls in one minute**, **5 calls in one timestamp second**, **800 with Task ID**; the 2,118 calls include 1,333 workflow-classified records. The call distribution is highly activity-dependent and includes tests and development operations. `agent_metrics` itself had zero calls in that historical day, so the frequency of future task-filtered dashboard requests cannot be inferred. `tool_calls` insertion frequency is a proxy, not proof of every SQLite write or concurrent production workload.

**Extrapolation boundary:** Even a small per-row index-maintenance cost can be material to write-heavy future use. Batch measurements do **not** establish per-autocommit latency, disk saturation, event-loop p95, planned public traffic, or any future workload SLO. Historical current-local activity does not constitute owner acceptance of v17 for production deployment. Do not use the current-low observed traffic to silently waive the G6 >20% material-regression review.

**Current G6 decision:** All functional, migration, query-plan, typecheck, full-test, build and static architecture evidence remains PASS. The v17 query-vs-write performance choice is documented but **NOT OWNER-ACCEPTED**. G6 stays OPEN pending explicit acceptance of the measured overhead for an agreed deployment workload or an owner-directed, separately verified existing-scope code alternative; no live DB migration, workload replay against live data, new phase or index change is authorized by this report.
