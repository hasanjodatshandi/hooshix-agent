# R6 G6 — Disposable index alternatives, not a production change

Date: 2026-09-23
Workspace: `D:/workspace/hooshix-agent`
Branch: `feature/r2-unified-tool-gateway-2026-09-20`
Entry evidence: `R6_04_METRICS_INDEX_AB_REPORT_2026-09-22.md` and `R6_G6_WORKLOAD_EVIDENCE_2026-09-23.md`.
Status: **EXPERIMENT COMPLETED; G6 OPEN; NO production-index recommendation or rollout authorization.**

## Purpose, boundaries, and method

The committed v17 full `(task_id,category,created_at DESC)` index consistently accelerates task-filtered Metrics queries but causes material 3,000-row batch-write overhead on the prior 250k-row synthetic fixtures. Instead of assuming acceptance or editing a committed migration, the isolated experiment asks whether smaller SQLite indexes materially reduce that measured cost while preserving the actual Metrics adapter result and query-plan path.

Script: `scripts/r6-partial-index-ab-benchmark.mts`. It creates a uniquely named, marker-owned temporary SQLite fixture, loads the pinned historical `ad96009` (v16) migration and **current production migrator through v17**. It then changes indexes *only inside its newly generated fixture*: first the committed full v17 index, then a hypothetical same-columns partial index with `WHERE task_id IS NOT NULL`, then a hypothetical narrower `(task_id,created_at DESC) WHERE task_id IS NOT NULL` index (the category predicate becomes a residual filter). All index drops and creations in this script are experimental, never performed against any existing application/operational database. No version-18 migration is implemented and no existing migration is rewritten.

This alternative fixture deliberately seeds 250,000 `tool_calls` with **60% NULL `task_id`** as an approximation of the observed local 800/2,118 task-tagged call mix. The deterministic assignment `i%5<3` is correlated with its synthetic category distribution; therefore it is **not a production-like joint distribution**. The real (non-synthetic) workload, future task mix and global/paged Query p95 remain unknown. Four states of the same actual Metrics adapter query are measured with two warmups and seven timing samples per profile; three rollback-only 3,000-row insertion probes per state. Index query plans, normalized snapshot parity, invariant 250k tool-call row count and SQLite `quick_check=ok` are asserted. Three independent fresh fixtures completed (tasks below).

## Results (median milliseconds, matched within each temporary run)

| Run | v16 filtered | full v17 filtered | partial v17 filtered | shorter partial filtered |
|---|---:|---:|---:|---:|
| A | 272.480 | 3.274 | 2.131 | 2.686 |
| B | 310.756 | 3.166 | 2.508 | 2.631 |
| C | 313.893 | 3.172 | 2.609 | 2.484 |

The optimizer uses the expected `task_id, category, created_at` constraints for full/partial and `task_id, created_at` for the narrower index; filtered read medians remain approximately 2–3 ms with both experimental alternatives. The four snapshots match after removing only the read-time `snapshotAt`. Global/paged Query medians and p95 fluctuate and do not establish absence of material regressions.

| Run | v16 3k inserts | full v17 | same-column partial | shorter partial |
|---|---:|---:|---:|---:|
| A | 16.880 | 26.766 (+58.6%) | 25.288 (+49.8%) | 22.310 (+32.2%) |
| B | 17.948 | 25.427 (+41.7%) | 21.270 (+18.5%) | 20.270 (+12.9%) |
| C | 18.874 | 23.368 (+23.8%) | 36.234 (+92.0%) | 21.578 (+14.3%) |

The narrower hypothetical partial index reduced allocated fixture pages from **19,623 full** to **17,768** (the same-column partial to **17,985**). These counts are allocated *whole-fixture* pages, **not** an index-only page count or a live-database size estimate. Timing probes are short, sequential in v16→full→partial→short order, and inherently noisy; a warm-cache/order effect cannot be ruled out. Even the narrower option exceeded +20% in one of three runs, so it does **not** prove the G6 threshold or a production SLO.

## Evidence, non-claims, and next acceptance condition

- Prior three-way, same-column partial-only fixture: task `57914146-0278-4205-975a-fca786b76ab5`, PASS; two independent repeats task `e0bd95a2-e57d-4407-875f-3b452291f3ab`, PASS.
- Four-way fixture task `05a2c0a5-cd3b-465b-bcec-e046598ac34a`, PASS; independent repeated fixtures task `fca0d383-14ab-4899-ae3a-caa4e28df3e9`, both PASS. These are **hypothetical** index alternatives only.
- The existing v17 index, original migrations and original R6.04 benchmark remain unchanged in the application. No runtime database migration, real backup mutation, service restart, push, merge or deployment was performed.
- No owner-agreed future write/read envelope, production-safe migration/copy rehearsal, auto-commit write latency, event-loop contention or concurrent operating workload was established. The historical live `agent_metrics` observation (see previous report) is not a substitute for these.
- **G6 stays OPEN.** Do not change the committed index based on synthetic evidence alone, mark an isolated partial-index experiment as production-ready, reinterpret the 54-finding matrix, or start R7. A design decision on the current v17 read/write trade-off or a separately authorized and verified, workload-supported alternative is still needed. All R0–R5 and existing R6 functional gate status remains as previously recorded.
