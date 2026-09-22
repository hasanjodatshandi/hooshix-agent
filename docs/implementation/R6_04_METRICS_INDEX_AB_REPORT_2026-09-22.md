# R6.04 — Controlled evidence for the task/category/time Metrics index

Date: 2026-09-22
Workspace: `D:/workspace/hooshix-agent`
Starting committed baseline: `ad96009` (R6.03, migration v16)
Candidate source: uncommitted v17 index `idx_tool_calls_task_category_created_at`
Status: R6.04 A/B evidence VERIFIED; selected candidate has a **measured write-throughput cost**.
G6, release, and any live-database cutover remain OPEN.

## Reproducible, non-destructive method

Run `pnpm exec tsx scripts/r6-index-ab-benchmark.mts`. For **each** run, this script
creates a new uniquely named, marker-owned SQLite fixture in the OS temporary
directory, opens it with Better-SQLite3, applies the real version-0 baseline,
and reads the migration-v16 implementation from immutable committed
`git show HEAD:src/core/memory/database/migrations.ts`. The historical migrator is
transpiled into the disposable directory; it is **never written to the tracked
source tree**. The Metrics query adapter's actual TypeScript query body is
transpiled unchanged except that its database port is wired to this fixture
instead of the application's shared singleton. Its ordinary timestamp parser
is used. There is no deletion, rollback, or replacement of indexes in an
existing database.

Exactly 250,000 representative `tool_calls`, 12,500 execution rows and 2,500
recovery rows are inserted. Before/after measurements are made on the **same**
fixture and the same adapter query code: 2 warmups + 7 timed invocations per
query profile, and 3 matched 3,000-row insert operations, each performed inside
a disposable SQLite savepoint and rolled back after timing. The **real current
`runMigrations`** then applies only pending migration 17 to the fixture, and the
measurements and query-plan inspection are repeated. The before/after Metrics
payloads are compared with only the read-time `snapshotAt` normalized.
Every run checks `quick_check=ok`, confirms 250,000 persisted input rows
before and after rollback-only write probes, and closes its database before
deleting **only** its marker-owned temporary directory.

This method was chosen because the older scratch file
`scripts/r6-index-evaluation.mts` creates the index twice under the new
automatic migration path and does **not** produce a valid baseline. It is
not the accepted R6.04 benchmark and is **not** staged or shipped in this
checkpoint. No active HooshiX database, connection, client registration,
workspace of another assistant, or recovery artifact is used.

## Results: real Metrics adapter, 250,000 rows

The table reports median wall-clock milliseconds from three independent
temporary-fixture runs. Negative percentage means the indexed query was faster.

| Run | Profile | v16 median (ms) | v17 median (ms) | Change |
|---:|---|---:|---:|---:|
| 1 | All-task Metrics | 158.590 | 183.287 | +15.6% |
| 1 | Task/category/date-filtered Metrics | 324.992 | 4.261 | 76.3x faster |
| 1 | Metrics, offset 1,000 | 161.022 | 197.957 | +22.9% |
| 2 | All-task Metrics | 204.813 | 174.835 | -14.6% |
| 2 | Task/category/date-filtered Metrics | 327.498 | 4.497 | 72.8x faster |
| 2 | Metrics, offset 1,000 | 189.672 | 174.766 | -7.9% |
| 3 | All-task Metrics | 168.419 | 217.964 | +29.4% |
| 3 | Task/category/date-filtered Metrics | 289.784 | 6.426 | 45.1x faster |
| 3 | Metrics, offset 1,000 | 188.966 | 185.935 | -1.6% |

The task-filtered query improves consistently from 290–327 ms to 4.3–6.4 ms
(45–76x). The non-task-filtered global and paged profiles have **inconsistent
signs** across independent runs: a regression >20% appears in one global
run and one paged run, but the remaining runs do not reproduce those
particular regressions. Treat these results as noisy and continue to track
their median and p95 in G6/R8, not as proof of zero regressions.

The filtered recent-call SQL plan changes from:

`SEARCH tool_calls USING INDEX idx_tool_calls_category_created_at (category=? AND created_at<?)`

to:

`SEARCH tool_calls USING INDEX idx_tool_calls_task_category_created_at (task_id=? AND category=? AND created_at<?)`

The planner now constrains all three leading filter/order columns. Both
before/after adapter payloads were identical after removing only the
non-deterministic snapshot timestamp. Both databases reported `quick_check=ok`.

## Write amplification, storage and migration cost

**Do not omit these costs when deciding whether to deploy migration v17.**

| Run | Median for rollback-only 3,000 inserts before | After | Relative increase | Extra microseconds/row |
|---:|---:|---:|---:|---:|
| 1 | 17.176 ms | 39.131 ms | +127.8% | 7.32 |
| 2 | 17.127 ms | 26.417 ms | +54.2% | 3.10 |
| 3 | 18.756 ms | 29.049 ms | +54.9% | 3.43 |

Every repeat confirms an added SQLite-index maintenance cost. The **relative
write regression is real and exceeds 20%**; it is explicitly explained by
maintenance of the new composite index. This trade-off is not hidden by
the large interactive-query improvement. A full 3,000-row synthetic batch
still completes in 26–39 ms on this host, but the acceptable steady-state
write rate of the user's real deployment has **not** been independently
measured. Production cutover therefore requires a workload-specific decision
and the separate G10 rehearsal; the R6.04 code/fixture gate is not an
authorization to deploy the new schema automatically.

The new index adds 3,304 SQLite pages to the fixture (17,062 → 20,366 pages;
approximately 13.5 MB at a 4 KiB page size, if page size is 4096). Applying
migration v17 to the 250k fixture took 382.9–385.8 ms across three runs.
These are local, non-production measurements, not guarantees of live DB size
or migration duration.

## Decision and acceptance boundaries

**Selected for the isolated feature branch:** migration v17 adds the
`(task_id,category,created_at DESC)` index because the filtered interactive
Metrics profile improves 45–76x, planner access becomes task-selective,
results remain identical, and the added write cost is measured and disclosed
rather than unexplained. There is no evidence that an additional index is
needed for the unfiltered or recovery-only profiles, so no other index is
introduced in this leaf. The future production workload must be assessed
before enabling this migration in a running environment.

The dedicated disposable regression
`tests/core/r6-metrics-index.test.ts` verifies v16→v17 upgrade,
historical-row preservation, exactly one v17 migration record, index
column order and the actual `EXPLAIN QUERY PLAN` path, with SQLite
`quick_check=ok`. Existing persistence and migration-only regression
expectations are updated from maximum schema version 16 to 17.
This is not an assertion that G6 is complete: R6.05–R6.09 and the final
whole-system acceptance and production-copy migration rehearsal remain open.

## Evidence

- Initial controlled A/B: task `c653e133-bafc-412a-9465-502e40a08399`, PASS.
- Independent repeats: task `3a75ea93-4088-44ae-9879-2c844c2f4fdc`, both PASS.
- Prior pre-index 25k/250k reference:
  `docs/implementation/R6_03_METRICS_QUERY_BENCHMARK_2026-09-22.md`.
- No live database migration, real backup modification, restart, push,
  merge, destructive repository cleanup, or connector credential change.
