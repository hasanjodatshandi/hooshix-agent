# Audit Finding → Architecture → Task → Test Traceability Matrix

**Authority:** `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`  
**Rule:** every HIGH/MEDIUM/LOW row must end in `VERIFIED_CLOSED` with executable evidence or a reviewed truthful contract resolution. No finding disappears because files are renamed/restructured.

Status values: `OPEN`, `TEST_ENCODED`, `IMPLEMENTING`, `IMPLEMENTED`, `VERIFIED_CLOSED`, `DEFERRED_BY_OWNER` (requires explicit owner approval; none are pre-deferred).

---

## HIGH findings

| ID | Short title | Primary phase | Primary specs | Mandatory closure evidence | Initial status |
|---|---|---|---|---|---|
| HIGH-01 | Workspace authorization/scope expansion gap | R2 | 02, 08, 09 | actual MCP + Task regression; ADMIN+approval unrestricted; no bypass path | OPEN |
| HIGH-02 | `search_files` sensitive denylist bypass | R2 | 08, 09, 14, 16 | fake `.env/.token/.ssh` regression; no read occurs | OPEN |
| HIGH-03 | `git diff --no-index` outside disclosure | R2 | 08, 09, 16 | PoC regression blocked/approval-required; no output disclosure | OPEN |
| HIGH-04 | OAuth expiry not enforced | R5 | 10, 13, 16, 31 | fake-clock expiry, distinct token, rotated refresh, wrong-resource/scope tests | OPEN |
| HIGH-05 | Timeout finalizes before termination | R3 | 06, 11, 16 | cancellation race/termination-grace tests; no overlapping retry | OPEN |
| HIGH-06 | Crash recovery replays uncertain effects | R3 | 11, 13, 16 | crash-after-marker test -> unknown, no duplicate marker | OPEN |
| HIGH-07 | Crash hydration incomplete | R3 | 11, 13, 16 | all-fields Task round-trip + recovery uses canonical get | OPEN |
| HIGH-08 | Dirty Git rollback destroys work | R4 | 12, 16 | dirty repo snapshot rejected; clean rollback verified | OPEN |
| HIGH-09 | Package rollback overstates guarantee | R4 | 12, 16 | manifest-only result wording + environment evidence requirement | OPEN |
| HIGH-10 | Docker frozen-lock fallback | R7 | 17 | static Docker assertion + real frozen build failure test | OPEN |
| HIGH-11 | Auth config/env/static secret drift | R7/R5 | 10, 17, 18, 19 | stale var failure, no literal secret, one config contract | OPEN |
| HIGH-12 | Authenticated health vs unauth probe | R7/R5 | 10, 17, 18 | container live/ready smoke without credential leakage | OPEN |
| HIGH-13 | Same-task guard process-local | R3 | 06, 11, 13, 16 | two-process lease race exactly one winner | OPEN |

---

## MEDIUM findings

| ID | Short title | Phase | Specs | Mandatory closure evidence | Status |
|---|---|---|---|---|---|
| MED-01 | Bearer token in query string | R5 | 10,16 | query token rejected; header token accepted | OPEN |
| MED-02 | Separate-arg secret redaction leak | R6 | 15,16 | opaque `--token VALUE` regression | OPEN |
| MED-03 | No rate/concurrency limits | R5/R6 | 10,14,16 | 429/budget/concurrency tests | OPEN |
| MED-04 | Shell cwd not workspace-authorized | R2 | 06,08,09,16 | outside cwd rejected for auto-approved path | OPEN |
| MED-05 | Audit failure masks successful effect | R3/R6 | 11,15,16 | effect succeeds + sink fails -> success/degraded, no retry | OPEN |
| MED-06 | Direct MCP hides CAS/idempotency | R2 | 06,08,12,16 | direct/task parity tests | OPEN |
| MED-07 | Project identity non-canonical | R4 | 12,13,16 | equivalent path one identity; collision migration test | OPEN |
| MED-08 | Task idempotency ignores payload | R3 | 11,13,16 | same key/diff hash conflict | OPEN |
| MED-09 | Append allows terminal tasks | R3 | 05,11,16 | completed/cancelled append rejected or explicit revision behavior | OPEN |
| MED-10 | Absent backup reuse creates empty file | R4 | 12,13,16 | repeated restore remains absent | OPEN |
| MED-11 | Restore missing revision guard | R4 | 12,16 | intervening edit -> conflict, no overwrite | OPEN |
| MED-12 | Restore binds current workspace | R4 | 12,16 | stored absolute target + reauthorization test | OPEN |
| MED-13 | Container root/mutable tag | R7 | 17 | runtime non-root; digest/update policy documented | OPEN |
| MED-14 | No CI gate | R7 | 17,22 | required workflow green from clean checkout | OPEN |
| MED-15 | Node/NVM PATH not reproducible | R7 | 17,18 | service-like preflight resolves exact supported Node/pnpm | OPEN |
| MED-16 | Incompatible production runbooks | R7/R9 | 18,19 | one canonical runbook, legacy docs removed/deprecated | OPEN |
| MED-17 | Metrics queries under-indexed/benchmarked | R6 | 13,14 | actual query EXPLAIN/latency at representative sizes | OPEN |
| MED-18 | Retention startup-only/incomplete | R6 | 13,14,15 | periodic class-aware retention test | OPEN |
| MED-19 | Session metrics accumulation | R6/R5 | 14,15 | churn test proves bounded active state | OPEN |
| MED-20 | PRAGMA on hot path | R6 | 13,14,15 | grep/architecture test + benchmark confirms removed | OPEN |
| MED-21 | Exploits lack regressions | R0/R8 | 16 | all HIGH exploit tests permanent | OPEN |
| MED-22 | HTTP/OAuth transport under-tested | R5/R8 | 10,16,31 | process/in-process modern HTTP E2E release gate | OPEN |
| MED-23 | Global coverage hides critical gaps | R8 | 16 | critical per-file/glob thresholds | OPEN |
| MED-24 | Test harness not parallel-isolated | R8 | 16 | 2/4 worker repeated runs after unique fixture state | OPEN |
| MED-25 | Prometheus HELP/TYPE malformed | R6 | 15,16 | golden grammar + promtool where available | OPEN |
| MED-26 | Dependency inversion incomplete | R1-R9 | 02,03,06,07,22 | architecture import gates; zero forbidden edges | OPEN |
| MED-27 | Runtime/loop broad responsibilities | R1-R9 | 02,05,06,11 | use-case/port split + architecture tests | OPEN |
| MED-28 | Direct/Task adapter drift | R2/R9 | 02,08,19 | one catalog + one ExecuteTool gateway + completeness test | OPEN |
| MED-29 | Host-header trust + CORS `*` | R5 | 10,16,31 | configured issuer/public URL; hostile Host/origin tests | OPEN |

---

## LOW / hygiene findings

| ID | Short title | Phase | Closure |
|---|---|---|---|
| LOW-01 | `search_files` absolutePath leak | R2/R9 | return workspace-relative/safe path metadata unless privileged diagnostic explicitly requests otherwise |
| LOW-02 | Silent schema-drift catches | R6/R9 | remove catch-ignore schema evolution; startup/migration fails explicitly |
| LOW-03 | Dual audit/legacy recovery layers | R9 | one port-based signal/recovery implementation; legacy dead paths removed |
| LOW-04 | Fragile git log flag interpolation | R2/R9 | validated typed numeric argument construction; regression/static check |
| LOW-05 | Dead `config/config.json` | R7/R9 | removed; typed config loader only |
| LOW-06 | Repo runtime-data noise | R9 | tracked runtime noise removed/ignored without deleting user data blindly |
| LOW-07 | Token file mode hardening | R5/R7 | POSIX 0600 create/verify test; Windows ACL expectation documented |
| LOW-08 | No persistent fuzz/property suite | R8 | targeted deterministic property suite committed |
| LOW-09 | `lint` is typecheck alias only | R8 | architecture/static rules + optional ESLint chosen through evidence; scripts named truthfully |
| LOW-10 | Whitespace/line-ending churn | R9 | `.gitattributes`/editor policy + diff check; cleanup isolated from security changes |
| LOW-11 | README tool inventory incomplete | R9 | generated `docs/TOOLS.md`; README links only |
| LOW-12 | Documentation/repo authority unclear | R9/R10 | final docs hierarchy, clean intended change set, release provenance recorded |

---

## Root-cause crosswalk

| Root cause | Findings | Primary architectural response |
|---|---|---|
| A Authorization/boundary fragmentation | HIGH-01/02/03, MED-04/06/28 | unified operation catalog + ExecuteToolUseCase + workspace/security ports |
| B Execution reality vs persisted state | HIGH-05/06/07/13, MED-05/08/09 | receipts, outcome_unknown, reconciliation, canonical hydration, durable lease/idempotency |
| C Compensation stronger than capability | HIGH-08/09, MED-10/11/12 | truthful snapshot/restore/manifest contracts |
| D Deployment/config fragmentation | HIGH-10/11/12, MED-13/14/15/16 | typed config, one runbook, CI/container hardening |
| E Persistence lifecycle spread | HIGH-07, MED-07/08/17/18/19/20 | application repositories + one SQLite adapter/migrations |
| F Verification weakest at risky edges | MED-21/22/23/24/25, LOW-08/09 | exploit-first tests, HTTP E2E, property/architecture gates |
| G Partial inversion/duplicate adapters | MED-26/27/28 | full Hexagonal/Clean restructuring + composition root |

---

## Finding closure procedure

For every row, implementing assistant records in `29_IMPLEMENTATION_PROGRESS_LEDGER.md`:

```text
Finding ID:
Status:
Implementation commits/changesets:
Files/modules:
ADR (if any):
Regression test(s):
Validation commands/results:
Docs updated:
Residual risk:
Reviewer notes:
```

`VERIFIED_CLOSED` requires test evidence. A code change without a regression is only `IMPLEMENTED`.

---

## Final closure gate

R9/R10 cannot complete while any matrix row remains `OPEN`, `IMPLEMENTING`, or merely `IMPLEMENTED`. Every row must be `VERIFIED_CLOSED` unless the owner explicitly marks it `DEFERRED_BY_OWNER` with rationale and release impact.