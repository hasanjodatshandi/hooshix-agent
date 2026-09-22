# R6.09 — Command audit redaction and degraded telemetry

Date: 2026-09-22
Branch: `feature/r2-unified-tool-gateway-2026-09-20`
Status: **R6.09 implementation and fixture regressions verified; G6 remains OPEN.**

## Exact code changes

1. `src/memory/command-audit.ts` uses a stateful argument scanner. A sensitive
   option with a separately supplied opaque value (`--token VALUE`,
   `--password VALUE`) preserves the flag but redacts the NEXT argument.
   Inline forms (`--api-key=VALUE`) replace the value with `[REDACTED]`.
   Header, environment and data-bearing options redact their supplied values,
   including opaque values with no recognizable token prefix.
2. Audit JSON uses an explicit field whitelist, not a spread of arbitrary caller
   data. If a caller supplies an environment mapping, neither variable keys nor
   values are serialized; only `environment: "[REDACTED]"` is recorded. Command,
   working directory and correlation identifier also pass through the existing
   sensitive-value scanner. Unrelated benign command arguments remain visible
   for diagnostics. Arbitrary secrets supplied in unmarked, unrecognized benign
   arguments cannot be reliably identified by any purely lexical redactor;
   callers must use typed sensitive options or withhold those values from audit.
3. `src/core/trace/telemetry-degradation.ts` increments the existing monotonic
   failure counter but prevents a failing `console.error` diagnostic stream from
   overriding an already known successful business effect.
4. `src/mcp/metrics.ts` exports
   `hooshix_telemetry_degraded_total` as a Prometheus counter, using the existing
   `telemetryDegradationCount()` and R6.08 family-level HELP/TYPE formatting.
   Failure exception messages and individual secret values are not emitted.
5. `tests/security/r0-medium-boundary-contracts.test.ts` converts the formerly
   expected-failing MED-02 redaction test into an ordinary passing regression.
   The finding is `VERIFIED_CLOSED` in
   `docs/implementation/20_FINDINGS_TRACEABILITY_MATRIX.md`.

## Reproducible evidence

- `tests/security/r6-audit-redaction-telemetry.test.ts` writes only to a
  marker-owned disposable log fixture and checks separated/inline secret forms,
  opaque headers, environment values, the explicit audit field whitelist and
  absence of raw secret strings. It also induces a telemetry sink failure and a
  failing diagnostic stream, checks that the original business outcome remains
  unchanged, that the counter increases by exactly one, and that Prometheus
  exposes the new counter without the failure message.
- Focus task `bb0f8e9a-b4b8-4f47-92a7-d807d851acc2`: 4 test files / 13 PASS,
  including the formerly expected-failing MED-02 fixture, R3 telemetry
  degradation and R6.08 Prometheus parser contracts.
- Source TypeScript task `5398cbd4-8532-48ae-80e9-11e2d598473a`: PASS.
- Full fixture test task `c720bed4-9774-4974-b395-b2a1162871a0`:
  163 files / 711 PASS + 3 expected failures belonging to other phases;
  0 unexpected failures.
- Production build and strict architecture task
  `b0d647b0-abd6-4321-91d9-879952e54123`: both PASS; G1 scanned 189 source
  files and found zero violations.
- Test-project TypeScript task `0192f619-b174-408e-a230-f0f3412949a2` failed
  at the HooshiX command-tool boundary with `tool_handler_failure` and no
  compiler diagnostic. This is neither a confirmed test compilation success
  nor a proven source/type error. The phase-wide compiler acceptance is OPEN.

## Findings, isolation and next gate

MED-02 is VERIFIED_CLOSED, giving 28/54 closed, 23 OPEN and 3 TEST_ENCODED
at this checkpoint. R6.07's concurrently modified progress ledger and its
untracked schema regression belong to the other in-progress execution and
are intentionally NOT staged by R6.09. The runtime HooshiX service was not
restarted and no actual database, OAuth credential, user backup, EAAP material,
or recovery script was changed.

G6 remains OPEN until all R6 work and the full test-project TypeScript compiler
acceptance are independently verified. This checkpoint is not a release or
operational cutover approval.
