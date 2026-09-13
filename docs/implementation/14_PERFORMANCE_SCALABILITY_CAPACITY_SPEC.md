# Performance, Scalability & Capacity Specification

**Primary findings:** MED-03, MED-17, MED-18, MED-19, MED-20; performance aspect of HIGH-02/search; conditional HIGH-13.  
**Evidence baseline:** current local single-agent performance is good; redesign must not prematurely replace SQLite or introduce distributed infrastructure without measured need.

---

## 1. Performance objectives

The redesign must:
- preserve or improve current local-agent latency and throughput;
- bound expensive client-controlled work;
- prevent long-lived memory/database growth from becoming unbounded;
- make capacity limits measurable rather than implied;
- retain SQLite for current design scale unless measured deployment requirements justify change;
- separate correctness scaling (execution lease) from database throughput scaling.

---

## 2. Baseline to preserve

Audit measurements to record as pre-redesign reference, not immutable SLA:

- 1000 simple SQLite audit writes: ~101–136 ms total;
- 1000 four-query metric sets: ~170–211 ms total;
- live agent metrics at ~2515 tool-call rows: ~4 ms;
- repository search: typically tens of ms on audited tree;
- full test suite: ~35 s single worker.

Before major performance refactors, create repeatable benchmark scripts using fixed fixtures and record machine/runtime metadata.

---

## 3. Capacity budgets

### 3.1 Search

Introduce application-level `SearchBudget`:

```ts
interface SearchBudget {
  maxFiles: number;
  maxFileBytes: number;
  maxAggregateBytes: number;
  maxResults: number;
  maxDurationMs?: number;
}
```

Recommended initial bounds preserve current file/result limits but add a materially lower aggregate byte limit than the theoretical ~9.77 GiB. Exact default must be measured against representative repositories and configured conservatively.

Search algorithm requirements:
- sensitive paths skipped before read;
- ignored/generated directories skipped early;
- cancellation honored;
- aggregate bytes counted before/after each read;
- no unbounded parallel file reads;
- file extension/include/exclude filters supported if useful;
- result lines bounded;
- path realpath/canonicalization optimized without weakening security.

### 3.2 Expensive operation concurrency

Define operation classes:
- `cheap_read`
- `filesystem_scan`
- `external_process`
- `package_operation`
- `recovery_reconciliation`

Use `RateLimiterPort`/concurrency budget:
- per principal for HTTP;
- global process cap for filesystem scans/package ops;
- local stdio can use permissive defaults but must remain bounded.

Do not allow client-controlled unbounded parallel child processes.

---

## 4. Event-loop budget

Because better-sqlite3 is synchronous, monitor:
- p50/p95/p99 application request latency;
- event-loop delay;
- time spent in SQLite transactions/metric queries;
- external process duration separately;
- filesystem scan duration/bytes.

Synchronous DB operations should remain short. Long analytical queries are not permitted on the request hot path without measured evidence or offloading.

If a metric/history query becomes slow at representative scale, first improve query/index/pagination design before changing database technology.

---

## 5. SQLite strategy

Retain:
- WAL;
- foreign keys;
- busy timeout;
- short transactions;
- one process-shared connection per runtime unless adapter design/testing establishes a better safe pattern.

Do not infer multi-process execution safety from WAL. Execution leases provide correctness.

Database replacement decision requires all of:
1. deployment requirement for multiple active runtime processes or materially high concurrent writers;
2. measured writer queue/event-loop or lock contention beyond accepted SLO;
3. query/index/retention tuning already performed;
4. migration cost/risk assessed via ADR.

Until then, PostgreSQL/Redis/message broker are out of scope.

---

## 6. Metrics/history query design

Benchmark the actual `GetMetricsUseCase`/SQLite adapter query set, not simplified stand-ins.

Representative data sizes:
- 2.5k rows (current-ish baseline);
- 25k rows;
- 250k rows;
- optionally 1M telemetry rows if cheap to generate.

Measure:
- recent tool calls by time descending;
- status/tool/category filters;
- failed counts/grouping;
- recovery events time window;
- execution counts;
- pagination.

For each query:
- capture `EXPLAIN QUERY PLAN`;
- record latency range after warmup;
- add index only when query evidence warrants it;
- avoid index explosion that increases write cost.

Prefer keyset/cursor pagination for deep history over high OFFSET if product UI needs deep traversal.

---

## 7. Retention and long-uptime behavior

Infrastructure schedules `RunRetentionUseCase` periodically (e.g. hourly/daily according to configured policy), not startup-only.

Track:
- DB file size;
- row counts by retention class;
- cleanup duration/deletions;
- oldest row per operational table;
- unresolved backups/outcomes count.

Cleanup is chunked if large deletes cause unacceptable blocking. Vacuum policy must be measured; do not run expensive full vacuum on request path.

---

## 8. HTTP/MCP modern protocol scaling

Target MCP 2026-07-28 modern HTTP core is stateless at the transport layer. Application state remains durable or principal/context keyed behind ports. Do not rebuild transport-level sticky sessions as a hidden dependency.

For legacy 2025 compatibility during migration, any session map is an adapter-only transitional concern and must have:
- max entries;
- idle TTL;
- absolute TTL;
- deletion from metrics/state;
- no security policy stored only in transport session memory.

Modern request handling must be horizontally routable at protocol level, while HooshiX durable task state remains SQLite-bound to the supported deployment topology until an explicit multi-instance ADR.

---

## 9. Session metrics memory

Replace historical unbounded `Map` behavior with:
- bounded active-state map only;
- monotonic counters for total sessions/requests;
- time-window aggregates where needed;
- remove closed session objects after grace/TTL;
- metrics snapshot O(active sessions + bounded recent samples), not O(all historical sessions).

---

## 10. Audit/observability hot path

Remove per-call schema introspection.

Audit/metric adapters should:
- use prepared statements cached per process where safe;
- avoid dynamic schema checks after startup migration;
- batch only where it does not weaken durability/ordering guarantees;
- never make a successful external effect fail because post-effect telemetry storage is slow/unavailable.

Telemetry degradation must be measurable.

---

## 11. Performance SLO proposal

These are acceptance targets to validate on the project test machine/CI class, not universal production guarantees:

### Application-only fake-adapter use cases
- p95 sub-millisecond to few milliseconds depending use case, excluding external I/O.

### Local SQLite simple repository ops
- no material regression (>2x) from audited baseline without documented reason.

### Metrics query fixture
- 25k rows: p95 target < 50 ms locally;
- 250k rows: p95 target < 200 ms for primary dashboard queries after evidence-backed indexing;
- if targets cannot be met, document measured result and revise UI/query design before DB replacement.

### Search
- enforce budget regardless of wall-clock;
- cancellation and aggregate-byte limit more important than arbitrary latency SLA across unknown disks/repos.

### HTTP
- auth/authorization overhead should be negligible relative to tool execution; benchmark no-op/read tool request path separately.

Exact thresholds may be adjusted with benchmark evidence and an ADR/progress-ledger entry.

---

## 12. Required benchmarks/tests

1. Current baseline benchmark captured before cutover.
2. Search rare/no-match fixture hits aggregate byte cap deterministically.
3. N concurrent search requests respect global/per-principal concurrency budget.
4. 25k/250k metrics datasets with actual query bundle + EXPLAIN assertions.
5. Retention cleanup on large fixture remains bounded and preserves unresolved records.
6. Session churn test confirms memory state returns near active baseline after TTL.
7. 10k/100k audited tool writes measure hot path after PRAGMA removal.
8. Two-process lease test validates correctness separately from throughput.
9. Event-loop delay benchmark during metrics query and DB write load.
10. HTTP authenticated lightweight request benchmark modern MCP handler.
11. Startup with large history records recovery scan/retention duration.
12. No benchmark runs against the user's original DB; use generated or copied fixtures.

---

## 13. Scale decision matrix

| Requirement | Keep current SQLite topology | Consider larger change |
|---|---|---|
| Single local runtime, low concurrent writes | Yes | No |
| Internet HTTP but one runtime process | Yes, with security/rate fixes | No distributed DB needed |
| Multiple processes sharing same DB for HA | Lease needed; SQLite may still work at low write rate | Measure contention first |
| High sustained concurrent writers | Likely ceiling | Evaluate client/server DB after measurement |
| Search-heavy use | Add budgets/concurrency | DB replacement irrelevant |
| Long uptime | Fix retention/index/session pruning | DB replacement not first step |

---

## 14. Definition of done

- search has aggregate byte and concurrency budgets;
- no unbounded historical session map;
- periodic retention covers defined data classes;
- no per-call schema introspection;
- actual production metrics queries benchmarked at representative sizes;
- indexes justified by query plans;
- event-loop/DB/search metrics emitted;
- no >2x unexplained regression from local baseline in core DB/metrics paths;
- SQLite retained/replaced only through explicit evidence-based ADR.