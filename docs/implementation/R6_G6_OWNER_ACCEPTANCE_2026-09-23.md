# R6 / G6 — Owner risk-acceptance record and final gate review

Date: 2026-09-23
Workspace: `D:/workspace/hooshix-agent`
Decision scope: isolated feature-branch R6 gate only; not a production or live-database deployment authorization.
Owner instruction: In response to the two explicitly presented choices, the owner selected **option 1** on 2026-09-23: **retain the current full v17 composite Metrics index and accept its documented synthetic batch-write regression in exchange for the measured task-filtered query improvement**, then complete R6 validation and continue to the already planned R7.

## Exact accepted design and rationale

- Keep **existing** migration 17 and `idx_tool_calls_task_category_created_at ON tool_calls(task_id,category,created_at DESC)`; no new index, new migration, rollback or change to a live DB.
- On original three independent 250k-row actual-Metrics-adapter disposable A/B fixtures, task-filtered query median improved roughly **45–76x**; synthetic rollback-only 3,000-insert batches slowed **+54.2%, +54.9%, +127.8%** versus v16. Further pinned repeats showed **+40.7%, +34.9%**; one isolated repeat showed an inverse median amid noisy short samples. Five of six measured paired medians exceed the gate's 20% material-regression review threshold.
- The write cost has a known explanation (SQLite maintenance of the additional composite index) and is not relabeled as `no regression`. In this local fixture, baseline write medians were about 17–19 ms per 3,000 rows in five of six runs, versus about 24–39 ms with v17; this is NOT a per-autocommit or future-production SLO. A later pinned repeat also showed 18.874 -> 24.701 ms (+30.9%) while task-filtered read median changed 291.092 -> 4.185 ms (~69.6x), payload parity true, SQLite `quick_check=ok`.
- Existing local HooshiX tool-call history (read only) recorded 4,149 / 1,782 / 2,118 calls on the three previous UTC days. Last complete day peaked at 58 calls in one minute. This is development/local activity, not the projected steady-state, peak, or concurrent public workload.
- Owner **explicitly accepts** this identified R6 v17 write/query design trade-off for the feature branch and authorizes completing G6 under its documented `unless justified` exception. The owner has NOT approved public readiness, any v17 migration of operational data, an unlimited write-rate promise, a concrete future p95 latency SLO, or skipping release gate G10. The residual performance risk is **accepted for R6 design selection and deferred for live-workload qualification at G10**.

## Bounded residual risk and action

1. Actual future sustained/peak insert load, concurrent readers/writers, disk/event-loop latency, and dashboard request mix are not established. Original G6 synthetic batch-insert >20% regression remains real and known, not removed by owner acceptance.
2. At production release gate G10, rehearse migrations on a permitted copy, characterize representative read/write load and operational rollback policy, and obtain separate explicit deployment approval. If production latency/capacity is unacceptable, reopen index design via a distinct reviewed change; do not rewrite migration 17 in place on a database where it may already have run.
3. No source schema/runtime/credential/container change is introduced by this decision. Unrelated untracked scratch experiments and backups remain untouched. Alternative experimental partial indexes are not selected.

## Final gate verification and status

Final verification task `b71ac997-cd42-4785-b589-ac5975e79313` was requested on current tracked R6 source. The first invocation `08f235dc-6030-4a87-b2da-429cf07d9511` failed at its first step due to unsupported (>120000 ms) subprocess timeout argument; it is an executor/schema invocation error, not a passing benchmark and not evidence of a code failure. The corrected task uses supported `execute_command.timeout=120000` with a larger Task step allowance.

## Verified final R6 results and gate disposition

Corrected HooshiX task `b71ac997-cd42-4785-b589-ac5975e79313` **COMPLETED**, all five steps exit 0 on the unchanged tracked feature-branch source:
1. The pinned-v16/current-v17 real Metrics adapter disposable 250k-row benchmark: `quick_check=ok`, identical normalized results, index selected by actual query plan; filtered median 291.092 -> 4.185 ms (~69.6x); paired 3,000-insert median 18.874 -> 24.701 ms (**+30.9%**, accepted risk).
2. `pnpm run typecheck`: source/test TypeScript PASS.
3. `pnpm exec vitest run`: **163 files / 714 PASS + one deliberately expected-failing R7 HIGH-10 Docker contract / zero unexpected failures**. HIGH-10 is NOT fixed or marked closed.
4. `pnpm run build`: PASS.
5. `node scripts/verify-g1-global.mjs`: strict G1 PASS, 189 scanned files, zero candidates.

Independent preceding two-run task `3d075107-05b8-40ae-ac35-cffb65f37dff` also passed twice. R6.01–R6.09 scope, regression fixtures, source/test compiler, build, architecture boundary, schema authority, retention, search budgets, sessions, metrics parser, redaction and telemetry-degradation evidence are documented in the live progress ledger and authoritative matrix; no claim is made that the later-phase HIGH-10 regression passes.

**Decision: G6 PASS — R6 GATE_PASSED for the isolated feature branch with the material v17 batch-write overhead expressly justified and accepted by the owner.** There is no assertion of zero write regression, unlimited future throughput, G7–G10 completion, release-readiness, or live-operational database authorization. Retain the known residual risk for the production-copy migration and future workload qualification in G10. The experimental partial-index alternatives are not selected.

No active database migration, runtime restart, deployment, Git reset, push, merge, connector credential change or unrelated untracked-file mutation was performed as part of gate acceptance.
