# R6.03 — Representative Metrics Query Benchmark

Date: 2026-09-22
Branch: `feature/r2-unified-tool-gateway-2026-09-20`
Starting HEAD: `dd6e1d4` (R6.02)
Status: **VERIFIED** for R6.03 benchmarking only; R6.04 index design and G6 remain open.

## Scope and safety

Command: `pnpm exec tsx scripts/r6-metrics-benchmark.mts`.
The executable creates a freshly generated, marker-owned OS temporary directory, overrides
`HOOSHIX_DB_PATH` to point only at the fixture, initializes it through the real migration
path, and deletes only that marked temporary directory after closing its SQLite connection.
**No production database, recovery backup, OAuth client, operational service or active workspace
is modified.** The script imports and times the actual
`getAgentMetrics` implementation in
`src/adapters/outbound/persistence/sqlite/repositories/agent-metrics-query.adapter.ts`,
not a simplified synthetic aggregate query.

Dataset: deterministic tool/status/category/task distribution, 25,000 and 250,000
`tool_calls` rows, respectively 1,250/12,500 `executions` and 250/2,500
`recovery_events`. There are 64 task identities, seven tool identities, a mixed
workflow/orchestration category and an approximately 1/11 failure rate. Fixed historical
timestamps and an actual SQLite migration-created schema are used. A 250k run adds
225k rows to the same ephemeral 25k fixture. SQLite `quick_check` was `ok` at both
sizes in both repetitions.

Measurement: Windows / Node v24.18.0, in-process synchronous application query,
two warm-up iterations and seven measured iterations per profile, sorted median and p95,
two independent full runs. Timings exclude fixture construction and do not establish a
production latency SLO; they establish a repeatable LOCAL baseline for R6.04.

## Actual application-query timings

All times in **milliseconds**. The `global` profile invokes `getAgentMetrics({limit:50,offset:0})`;
`filtered` invokes `getAgentMetrics({taskId:"r6-task-23",category:"workflow",
limit:50,offset:25,from:"2026-09-01",to:"2026-09-22"})`; `paged` requests
`{limit:50,offset:1000}`. Each is a complete metrics snapshot, including recovery
and execution summaries, grouping and recent-call pagination.

| Rows | Profile | Run 1 median | Run 1 p95 | Run 2 median | Run 2 p95 |
|---:|---|---:|---:|---:|---:|
| 25,000 | global | 9.947 | 12.031 | 11.001 | 26.616 |
| 25,000 | filtered | 16.983 | 18.491 | 16.035 | 24.718 |
| 25,000 | paged | 8.121 | 11.650 | 9.779 | 10.522 |
| 250,000 | global | 174.904 | 181.503 | 175.743 | 188.333 |
| 250,000 | filtered | 304.209 | 337.172 | 295.984 | 326.599 |
| 250,000 | paged | 179.181 | 192.186 | 170.580 | 175.615 |

Fixture seed timings: 25k **329/246 ms** and the subsequent 225k
**3,132/2,959 ms** (run 1/run 2). They are not included in query timings.
The two 250k runs are directionally consistent, while 25k p95 exhibits noise.
The >10x measured query-latency growth when tool-call volume increases by 10x is
**observed scaling, not a claim of a >20% code regression**: no before/after code
change is being compared in this leaf.

## EXPLAIN QUERY PLAN evidence (same at both sizes and in both runs)

Plans are produced from representative SQL statements matching the executed adapter
query shapes, with bound parameters, on the same temporary migrated database.

| Query shape | Observed SQLite plan | R6.04 follow-up |
|---|---|---|
| Workflow aggregate with `category IS NULL OR category='workflow'` | `MULTI-INDEX OR`, using `idx_tool_calls_category_created_at` for both branches | Measure actual aggregate vs alternative plan; avoid adding an index without comparative proof. |
| Task/category filtered recent calls ordered by timestamp | `SEARCH tool_calls USING INDEX idx_tool_calls_category_created_at (category=? AND created_at<?)` | The scan does **not** constrain `task_id` in this index. Test a task/category/time composite index on disposable fixtures and compare write cost and query plans. |
| Most-failed tools grouped by tool | Covering scan of `idx_tool_calls_tool_status` plus `USE TEMP B-TREE FOR ORDER BY` | Test whether a candidate status/tool index makes measured end-to-end Metrics faster, not just the isolated grouping. |
| Recovery duration summary | `SCAN recovery_events` | Time bounded and full-history variants before creating indexes. Dataset has 250/2,500 recovery rows; observed scan alone does not establish material impact. |
| Failed executions count | `SEARCH executions USING INDEX idx_executions_status (status=?)` | Already indexed for status; defer further index unless actual query benchmark justifies. |

## R6.04 baseline and interpretation

Use this report and `scripts/r6-metrics-benchmark.mts` unchanged as the *pre-change*
baseline when testing candidate indexes. For a meaningful before/after comparison use
the same fixture seed, profiles, representative data distribution, Node/SQLite version,
hardware and two or more runs. Report median and p95 together with the query plans
and additional insert/write cost. A candidate index is acceptable only if it improves
a meaningful query profile without unexplained >20% regression in other important
profiles or write workload. The filtered 250k profile (296–304 ms median) is
the primary optimization hypothesis, not a guaranteed SLO.

## Evidence and limits

- First complete benchmark task: `37a6d3ea-cfaf-4dc5-bc7a-d32cf6155218`: PASS.
- Independent repetition: `e090edd2-e464-4eb3-a172-acb16454822c`: PASS.
- Both emitted a machine-readable `R6_METRICS_BENCHMARK_REPORT` JSON object
  including exact timings, row counts, plans, integrity and environment.
- No product schema or metrics implementation change was made by R6.03. The four
  expected-red tests and all other phase gates retain their previous statuses.
- R6.03 does not close G6: R6.04–R6.09, parsing/redaction/observability and
  final before/after regression verification remain.
