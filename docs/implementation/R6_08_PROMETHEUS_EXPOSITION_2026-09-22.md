# R6.08 — Prometheus exposition format and lifecycle counters

Date: 2026-09-22
Branch: `feature/r2-unified-tool-gateway-2026-09-20`
Status: **R6.08 code and fixture tests verified; G6 remains OPEN.**

## Scope

The MCP in-memory metrics exporter previously emitted `# HELP` and `# TYPE` directives
with labels embedded in the metric family name, repeated per tool, and emitted unlabeled
tool error/duration samples without any family metadata. It also labeled the rolling
recent-call count as a lifetime Prometheus counter.

The scoped change in `src/mcp/metrics.ts` now:

- Emits exactly one `# HELP` and `# TYPE` for every exported metric family.
  The samples, not the declarations, contain safely escaped `tool` labels.
- Uses `counter` for lifetime creation/call/failure totals and `gauge` for uptime,
  active/peak sessions and recent duration averages. A separate lifetime call tally
  prevents counter decrease when the existing bounded recent-call history is pruned.
- Maintains a bounded per-tool lifetime tally: at most 127 named tools and one
  `__other__` overflow bucket. This bounds persistent label cardinality independently
  of recent-call/sample history. Label values escape backslashes, double quotes and LF.
- Preserves existing in-process `getSnapshot()` semantics and active-session pruning.
  The production `getPrometheusMetrics()` endpoint remains protected by its existing
  transport/server access rules; neither authentication nor server routing was changed.

## Verification

`tests/core/r6-prometheus-exposition.test.ts` permanently checks:

1. One valid family-level HELP/TYPE pair per exported metric, correct types, no
   duplicate sample lines, matching metadata for every sample, safe label escaping,
   and no labels in declarations.
2. Lifetime counters remain monotonic after more than 500 tool calls and recent
   history truncation; per-tool series remain at or below 128 including overflow.
3. Runs `promtool check metrics` against generated exposition when `promtool` is
   installed. On machines where it is not installed, this optional check exits
   without asserting external parser coverage. A separate local parser-contract
   test always runs. Do not claim POSIX or promtool execution without its evidence.

Evidence:
- Focus task `e33622e0-3cde-45d4-8e08-883d6cd203d8`: 2 files / 4 PASS,
  including the existing in-memory session metrics churn regression.
- Source-only TypeScript task `fae63773-7a0f-4ed0-9775-a2c62e713744`: PASS.
- Full regression task `7dabf02e-bbe3-49c6-8c9f-7b83c9430ff4`: 162 files /
  708 PASS + 4 expected failures assigned to later phases; zero unexpected failures.
- Production build and strict architecture task `3e368c53-bd3e-4056-8d73-0b2952a5de8c`:
  build PASS; G1 189 source files / zero violations PASS.
- Test-project TypeScript task `ed4d3ce4-aa1d-4fdf-ab2e-4565d5b95640` failed at
  the HooshiX tool boundary with `tool_handler_failure`, without compiler output.
  This is **not** a verified successful or failing test-project compilation.
  The outstanding test-project compiler acceptance from R6.05–R6.08 remains OPEN.

## Isolation and next steps

The separately progressing R6.07 ledger change and its untracked fixture test
are intentionally outside this checkpoint. The active HooshiX server was not restarted;
no live SQLite file, existing client authorization, recovery scripts, unrelated
backups or EAAP material was touched. R6.09 audit-redaction and degraded-metric
acceptance, final R6 test compilation and G6 release-stage checks remain pending.
