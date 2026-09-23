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
