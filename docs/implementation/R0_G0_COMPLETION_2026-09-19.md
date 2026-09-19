# R0 / G0 completion evidence — 2026-09-19

Project: HooshiX Brain, `D:/workspace/hooshix-agent`.
Baseline commit: `8f43e5ba9d956fcc53b5b976663304aaa683fbe8`.
Work branch: `audit/r0-baseline-2026-09-19`.
Authority: `21_PHASED_EXECUTION_BACKLOG.md` R0.01–R0.05 and `22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md` G0.

## Decision

**R0 GATE_PASSED / G0 PASS for baseline integrity and pre-remediation test capture ONLY.**
All 13 HIGH findings have a committed-candidate executable regression or safe fixture
contract. **None of the 13 HIGH defects is declared VERIFIED_CLOSED.** Expected-fail
tests are executable demonstrations of currently unmet contracts, not green
security outcomes. Full R1–R10 gates and public deployment remain blocked.

## R0 leaves and evidence

| Leaf | Completion evidence |
|---|---|
| R0.01 Baseline | `R0_BASELINE_2026-09-19.md`: clean source reference, runtime, lockfile/migration fingerprints and baseline 470-test coverage |
| R0.02 Disposable fixtures | `tests/helpers/r0-disposable-fixtures.ts`, 8 fixture tests, real two-OS-process SQLite WAL race test and dedicated RED production-lease schema contract |
| R0.03 Security contracts | Real MCP/Task workspace and secret-search tests, outside-argv Git disclosure, fake-clock OAuth expiry/resource/refresh replay, query-token/config/health RED contracts; MED-02 secret-argument logging and MED-04 cwd tests |
| R0.04 Reliability and integrity | Timeout, crash-after-effect, all-fields hydration, dirty Git snapshot, package-restore truthfulness, audit-sink failure and disposable backup/project/idempotency/terminal-append contracts |
| R0.05 Architecture scaffold | `tests/core/r0-architecture-boundary.test.ts` proves scanner catches synthetic violations and protects any newly added domain/application/inbound modules. It does **not** pass G1 for the existing legacy tree |

## HIGH regression/fixture trace

| ID | Evidence | Present observation / subsequent phase |
|---|---|---|
| HIGH-01 | `tests/security/r0-mcp-workspace-search.test.ts` | Task root revocation and real MCP scope-add contract; principal-bound authorization still RED (R2) |
| HIGH-02 | `tests/security/r0-mcp-workspace-search.test.ts` | Real MCP and Task secret exclusion verified with synthetic `.env`, `.token`, SSH and cloud files (R2) |
| HIGH-03 | `tests/core/r0-known-defects.test.ts`, `tests/security/r0-noindex-disclosure.test.ts` | Safe fixture reproduces Git `--no-index` outside-workspace disclosure; RED (R2) |
| HIGH-04 | `tests/security/r0-oauth-expiry-replay.test.ts` | Fake-clock token expiry, resource and refresh replay; transport/persistence still R5 |
| HIGH-05 | `tests/core/r0-reliability-contracts.test.ts` | Non-cooperative mock demonstrates lack of termination acknowledgement; RED (R3) |
| HIGH-06 | `tests/core/r0-reliability-contracts.test.ts` | Disposable crash-after-marker and no automatic mutation replay; real process-kill fault-injection remains R3 |
| HIGH-07 | `tests/core/r0-reliability-contracts.test.ts` | Normal vs recovery semantic-field equality contract; RED (R3) |
| HIGH-08 | `tests/core/r0-reliability-contracts.test.ts` | Dirty disposable Git snapshot must reject destructive rollback; RED (R4) |
| HIGH-09 | `tests/core/r0-reliability-contracts.test.ts` | Manifest-only restore must not claim installed environment restore; RED (R4) |
| HIGH-10 | `tests/core/r0-known-defects.test.ts` | Docker frozen-lockfile fallback present; RED (R7) |
| HIGH-11 | `tests/core/r0-known-defects.test.ts` | Legacy/bootstrap credential acceptance still present; static RED contract; HTTP config migration R7/R5 |
| HIGH-12 | `tests/core/r0-known-defects.test.ts` | No separate unauthenticated non-sensitive liveness endpoint; static RED contract; process/container smoke R7/R5 |
| HIGH-13 | `tests/core/r0-multiprocess-lease.test.ts` | Two independent OS processes contend for one disposable SQLite row; missing production fenced lease explicitly RED (R3) |

MED-01, MED-02, MED-04, MED-05, MED-07 through MED-12 have additional
fixture contracts in `r0-known-defects.test.ts`,
`r0-medium-boundary-contracts.test.ts`,
`r0-audit-failure-contract.test.ts`, and
`r0-data-integrity-contracts.test.ts`. Their finding statuses indicate
**TEST_ENCODED**, not **VERIFIED_CLOSED**; unaddressed MED/LOW findings remain OPEN.

## Gate execution

- Focused R0 suite: 11 test files, **22 passing + 18 expected failures** (40 contracts); no unexpected failure.
- Full `pnpm exec vitest run --coverage`: **103 test files, 492 passing + 18 expected failures** (510 tests), exit 0.
- Post-addition `pnpm run typecheck`: PASS; `pnpm run build`: PASS.
- Latest overall coverage: 86.83% statements, 77.44% branches, 87.35% functions, 90.41% lines. These do not meet or waive G8 per-critical-file thresholds.
- Work is fixture/test/documentation-only; no production code, HTTP service,
  primary SQLite DB, public release or existing `release/hardening-2026-09-19`
  branch is modified by this R0 activity.

## Conditions for successor phases

R1 may start from this G0 baseline once this report, regression code and
ledger are reviewed and committed on the isolated audit branch. Preserve the
18 intentional RED contracts through implementation; convert each to an
ordinary passing assertion **only after fixing its underlying vulnerability**
and verifying its real fixture/entrypoint behavior. Do not use `it.fails` to
mask setup errors. Failing-before-fix acceptance at G0 is not authorization
to release, merge into main, skip R2/R3/R5/R7, or mark any HIGH finding closed.
