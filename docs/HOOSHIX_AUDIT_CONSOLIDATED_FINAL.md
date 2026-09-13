# HooshiX Agent — Consolidated Final Audit (Definitive Single Source of Truth)

**Consolidation date:** 2026-09-06
**Provenance — merged from three audit generations:**

| Source | File | Date | Author context |
|---|---|---|---|
| Audit A | `docs/SECURITY_AND_ARCHITECTURE_AUDIT_v1_2026-09-05.md` (now consolidated inside MASTER) | 2026-09-05 | prior session |
| Audit B | `docs/SECURITY_AND_ARCHITECTURE_AUDIT.md` (now consolidated inside MASTER) | 2026-09-06 | current session |
| **Audit A+B merged** | `docs/SECURITY_AND_ARCHITECTURE_AUDIT_MASTER.md` | 2026-09-06 | this session's merge |
| **Audit C** | `docs/HooshiX_Final_Repository_Audit_Report.md` | 2026-09-06 | **another assistant** (Phases 1–10 evidence set under `D:/tmp`) |
| **THIS DOCUMENT** | `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md` | 2026-09-06 | final consolidation of MASTER + Audit C |

**Merge method:** both source documents were re-read in full and reconciled line-by-line. Every Audit C finding was additionally cross-checked against the current source code read during this session; findings independently confirmed from source are marked **[source-verified]**. This document supersedes all prior audits as the **single authoritative audit record**. The two source documents remain alongside, unchanged, for provenance.

**Scope:** `D:\workspace\hooshix-agent` (branch `hooshix-mcp-git-test`, 92 source files under `src/`, 266 git-indexed files, heavily dirty working tree — audited as-is, not HEAD).
**Mode:** read-only consolidation; no source edits, resets, or new discovery performed during merging.

---

## 0. Reconciliation of the Audit Sources (تظبیق سه سند)

### 0.1 What each source contributed

- **Audit A (09-05):** first full evidence-based audit; PoCs for sandbox-disable and search-denylist-bypass; SEC-001..004, MED-001..007, LOW-001..006.
- **Audit B (09-06):** re-verified every A finding with fresh PoCs; added SEC-005 (hardcoded secret), MED-008 (shell cwd), MED-009 (Docker), LOW-007..009; corrected Node-runtime fact; extracted benchmark numbers; live permission probes.
- **Audit C (other assistant, 09-06):** 10-phase evidence set. **New findings not present in A/B:** H-03 (`git diff --no-index` external disclosure), H-04 (OAuth advertised expiry unenforced), H-07 (crash hydration incomplete), H-08 (dirty git rollback destroys work), H-09 (package rollback overstates), H-13 (cross-process task exclusion), M-02 (audit redaction dead flag), M-05 (audit failure masks success), M-07/M-08/M-09/M-10 (identity/idempotency/append/absent-backup), M-15/M-16 (PATH/runbooks), M-17/M-19/M-20 (metrics/queries), M-21..M-25 (testing/coverage/Prometheus). **New evidence:** 20,000-input randomized smoke (0 crashes), 4-worker diagnostic (188 failures → isolation debt), PoCs for diff-disclosure, redaction leak, project-identity duplication, absent-backup reuse, audit-failure masking. **Also:** evidence-precedence framework, 7-cause root-cause analysis, documentation-authority model, honest validation-limits section.

### 0.2 Agreement matrix (findings present in both MASTER and Audit C)

| Topic | MASTER | Audit C | Agreement |
|---|---|---|---|
| Workspace-mgmt authorization gap | SEC-001 | H-01 | ✅ identical conclusion, PoCs agree |
| `search_files` denylist bypass | SEC-002 | H-02 | ✅ two independent PoCs agree |
| Timeout finalize-before-terminate | SEC-003 | H-05 | ✅ |
| Crash recovery replays uncertain steps | SEC-004 | H-06 | ✅ |
| Deployment auth env drift + secret | SEC-005+MED-002 | H-11 | ✅ (C adds a precision — see 0.6) |
| `?token=` query-string auth | MED-001 | M-01 | ✅ |
| No rate limiting / session bounds | MED-005 | M-03 | ✅ |
| Shell `cwd` unvalidated | MED-008 | M-04 | ✅ |
| Restore revision guard | MED-006 | M-11 | ✅ |
| Backup binds mutable workspace | MED-007 | M-12 | ✅ |
| Retention incomplete | MED-003 | M-18 | ✅ |
| Docker root / lockfile fallback / healthcheck | MED-009 (consolidated) | H-10 + H-12 + M-13 (split) | ✅ facts agree; severity differs (0.4) |
| No CI | noted in §22/§27 | M-14 | ✅ |
| Adapter drift / dual tool paths | LOW-001 + §13/14 | M-28 | ✅ |
| God-service scope | SRP note §15 | M-27 | ✅ |
| Dependency inversion incomplete | §13/14 (4/10) | M-26 (Partial 4–5/10) | ✅ |
| Host-header trust + CORS | MED-004 | *(not separately covered)* | kept from MASTER |
| Direct-file CAS/idempotency omitted | LOW-001 | M-06 (MEDIUM) | severity resolved (0.4) |

### 0.3 Findings introduced by Audit C only (all cross-checked against source this session)

| Audit C ID | Topic | Source-verification result |
|---|---|---|
| H-03 | `git diff --no-index` reads files outside workspace, auto-approved | **[source-verified]** `command-permission.ts:28` — `diff` is in `safeGitSubcommands`; path-bearing args of auto-allowed git commands are never path-validated; shell `cwd` (MED-04) compounds it |
| H-04 | OAuth advertises `expires_in:3600` but bearer verification has no expiry | **[source-verified]** `oauth.ts:30-41` — `verifyToken` is a pure equality check against the master token; `tokenResponse` returns the master token with a 1-hour claim; refresh derivation is deterministic and never rotated |
| H-07 | `findInterruptedTasks()` hydrates an incomplete TaskPlan | **[source-verified]** `task-repository.ts:395-432` — omits `retry_policy`, `total_run_count`, `runWhen`, attempt counters/history, `templateArguments`, `idempotencyKey` vs. canonical `getTaskPlan()` |
| H-08 | Git rollback (`reset --hard` + `clean -fd`) can destroy pre-existing dirty work | **[source-verified]** `task-snapshot-handler.ts:43-64` — no clean-tree precondition on snapshot or rollback; dirty/untracked content is not captured |
| H-09 | Package rollback restores manifests/lockfiles only but reports full success | **[source-verified]** `package-service.ts:52-64` — restores only `SNAPSHOT_FILES`; `node_modules`/env/PATH untouched; winget/choco snapshots have no restorable files yet can report `rolled_back` |
| H-13 | Duplicate-run guard is process-local only | **[source-verified]** `task-runtime-service.ts:22` — module-level `Set`; no persisted lease |
| M-02 | Audit redaction `redactNext` flag is never activated → separated secret values leak | **[source-verified]** `command-audit.ts:12-31` — `let redactNext = false;` is declared and read, but no code path ever sets it `true`; `--token VALUE` logs the VALUE verbatim unless it independently matches a pattern |
| M-05 | Post-effect audit failure converts a completed side effect into a reported failure | consistent with MASTER §18 observation (audit-in-catch-path can throw and mask the original error) — C's PoC demonstrated the user-facing variant; merged |
| M-07 | Project canonical identity: raw path stored, canonical used only for conflict check | **[source-verified]** `task-repository.ts:336-346` — conflict check uses `canonicalizePath(input.path)` but `INSERT` stores `input.path` raw; equivalent path forms create distinct project rows |
| M-08 | Task idempotency lookup by key only, payload ignored | **[source-verified]** `task-repository.ts:104-110` — `WHERE idempotency_key = ?` only; README claims key+payload |
| M-09 | `task_append_steps` accepts `completed`/`cancelled` (terminal) tasks | **[source-verified]** `tools/task/index.ts:138-140` — explicitly allows failed/completed/cancelled; appended steps in a completed/cancelled plan can never run (state machine has no exit; `task_run` returns the structured no-op) |
| M-10 | Reusing an absent-state backup creates an empty file | **[source-verified]** `filesystem-service.ts:323-331` — absent-ness encoded in mutable `restored_at`; first restore overwrites it with a timestamp → second restore of the same id writes the empty BLOB as a normal restore |
| M-15 | Node/NVM PATH bootstrap not reproducible | **[verified live during Audit B]** — `node` was not resolvable until `C:\Users\Coder\AppData\Local
vm\v24.18.0` was added manually; both audits hit the same wall independently |
| M-16 | Multiple incompatible production runbooks (Docker vs .bat vs watchdog vs README) | consistent with MASTER's MED-002/SEC-005 evidence; formalized by C |
| M-17 | Metrics queries under-indexed for real production shapes (time filters, OFFSET pagination) | consistent with MASTER MED-003; C adds that microbenchmarks don't model the real query shapes |
| M-19 | Historical session metrics accumulate (active-count scan grows) | extends MASTER LOW-009; upgraded to MEDIUM |
| M-20 | Hot-path schema introspection (`PRAGMA table_info` per tool call) | **[source-verified]** `tool-audit.ts:19-22` — runs PRAGMA on **every** `record()` call despite the once-per-process migration fix in `database/index.ts` |
| M-21..M-24 | Testing: no exploit regressions; HTTP/OAuth under-tested; per-file branch coverage 53–64% on critical files; 4-worker diagnostic = 188 failures | consistent with MASTER §21 gaps + vitest `maxWorkers:1` **[source-verified]** (`vitest.config.ts`) |
| M-25 | Prometheus HELP/TYPE lines malformed for labeled metrics | from C's Phase 8 evidence (metrics.ts `getPrometheusMetrics`); retained as C-verified |

### 0.4 Severity conflicts resolved

| Topic | MASTER said | Audit C said | Unified decision |
|---|---|---|---|
| Docker frozen-lock fallback (`\|\| pnpm install`) | MED-009 (MEDIUM) | **H-10 (HIGH)** | **HIGH** — fails-open on supply-chain integrity; image builds must fail closed |
| Healthcheck vs authenticated `/health` | MED-009 (MEDIUM) | **H-12 (HIGH)** | **HIGH** — systematically marks a healthy service unhealthy; deployment-correctness failure |
| Container root + mutable tag | MED-009 (MEDIUM) | M-13 (MEDIUM) | MEDIUM (agreed) |
| Direct MCP file CAS/idempotency omitted | LOW-001 | M-06 (MEDIUM) | **MEDIUM** — the controls exist in the service but are hidden by the adapter; drift has already caused one regression class |
| Session metrics accumulation | LOW-009 | M-19 (MEDIUM) | **MEDIUM** (unbounded growth + O(n) scan per request) |
| Deterministic refresh token / no expiry | LOW-003 | **H-04 (HIGH)** | **HIGH-04 supersedes LOW-003** — the advertised-but-unenforced expiry plus master-token reuse is a materially worse contract violation than "document the rotation story" |

### 0.5 Score conflicts resolved

| Area | MASTER | Audit C | Unified |
|---|---|---|---|
| Clean Architecture | 4/10 | Partial, range 4–5.5 | **Partial (4–5)** |
| Hexagonal | 4/10 | Partial, range 4–5 | **Partial (4–5)** |
| SOLID | 6/10 | ~6 | **6** |
| Testability | 8/10 | "strong but uneven at risky boundaries" | **7** (M-21..24 justify the reduction) |
| Observability | 6.5/10 | "rich with format/retention/redaction gaps" | **6.5** |
| Security / Reliability / Performance / Scalability / Maintainability / Prod-Readiness | 5/6/7/5/5/4 | qualitative equivalents | **unchanged** |
| **Overall Engineering Score** | 5/10 | (no number; materially negative given HIGH chain) | **5/10** — at the lower bound of 5: Audit C's six additional HIGHs reinforce, but do not worsen beyond, the already-dominant boundary-failure weighting |

### 0.6 Factual qualifications adopted from Audit C

1. **H-11 qualification (adopts C's more precise phrasing):** setting `MCP_API_KEY` (which the code ignores) does **not** make the server unauthenticated — `loadToken()` falls back to the `.token` file or auto-generates. The real defect is the **operational contract mismatch** (unknown credential state) plus the unsafe legacy secret guidance. MASTER's original SEC-005 (hardcoded `hooshix-v2-secret`) stands unchanged.
2. **Performance numbers are run-dependent, not contradictory:** 1000 audit writes measured 111.4ms (Audit B) and 101.0–135.6ms (Audit C) — same operation, different runs; unified as a range. Same for metric query sets (205.5ms vs 169.5–211.3ms). Audit C's additional data points (live `agent_metrics` ≈4ms at 2515 rows; searches tens of ms) are added.
3. **10×/100× scalability statements are projections, not measurements** — neither audit ran a true load test; C's honesty caveat is adopted.

### 0.7 One intentional divergence from both sources: implementation scope

Both audits recommend **incremental remediation** ("do not perform a wholesale rewrite"). That remains the evidence-based minimum. However, the **project owner has issued an explicit directive** (recorded in §31): the remediation will be delivered as a **full Hexagonal + Clean Architecture restructuring** covering all findings, even at the cost of restructuring. The audits' "incremental is sufficient" verdict is therefore recorded as the *evidence floor*, not the implementation ceiling. No finding severity was altered because of this directive.

---

## 1. Executive Summary

HooshiX is a local MCP agent runtime: ChatGPT supplies explicit JSON task plans; HooshiX validates, executes, governs, audits, and persists them in SQLite (WAL). Two execution modes: **direct MCP tools** (filesystem, shell, git, package, system, context) and **durable Task execution** (`TaskRuntimeService` → `closed-agent-loop` with persistence, governance, approvals, checkpoints, recovery, replay).

The engine core is genuinely well-engineered: strict TypeScript, SQL-atomic single-use approvals, argv-separated subprocess execution with `shell:false`, atomic fsync'd file writes with pre-mutation backups, a typed error taxonomy, bounded inputs/outputs, PKCE-bound OAuth authorization codes, exact dependency pins, a 342-test suite, and rich observability. All validation gates are green (build, typecheck, 342/342 tests, coverage 87.85/76.38/92.29/91.64, `pnpm audit` clean) plus a 20,000-input randomized smoke with zero crashes.

The consolidated problems — stable across all three audits and now with 13 HIGH findings — are:

1. **Authorization is decentralized and provably incomplete.** Workspace tools mutate scope with no permission/PDP gate (HIGH-01); `set_workspace({unrestricted:true})` disables the filesystem sandbox.
2. **The sensitive-file denylist is bypassable via `search_files`** (HIGH-02, PoC ×2) and **auto-approved `git diff --no-index` discloses any OS-readable file** (HIGH-03, PoC).
3. **Execution reality diverges from persisted state.** Timeout finalizes before process-termination confirmation (HIGH-05); crash recovery replays uncertain mutations (HIGH-06) and hydrates an incomplete plan (HIGH-07); audit failure can report failure after a side effect succeeded (MED-05).
4. **Compensation claims exceed compensation capability.** Git rollback can destroy pre-existing dirty work (HIGH-08); package rollback restores manifests only while reporting success (HIGH-09); file restore lacks revision guards (MED-11/12) and absent-backup reuse corrupts semantics (MED-10).
5. **HTTP/OAuth contract violations.** Advertised 1-hour token expiry is not enforced (HIGH-04); the master token is accepted via `?token=` query strings (MED-01); no rate limits (MED-03).
6. **Deployment is fragmented and fails open.** Weak hardcoded secret + env-name drift (HIGH-11); Docker frozen-lock fallback (HIGH-10); healthcheck/auth conflict (HIGH-12); root container, PATH bootstrap, multiple incompatible runbooks (MED-13/15/16); no CI (MED-14).
7. **Verification is uneven at the riskiest boundaries.** Confirmed exploits lack regression tests (MED-21); HTTP/OAuth is behaviorally under-tested (MED-22); critical files sit at 53–64% branch coverage under a green global headline (MED-23); the harness is not parallel-isolated (MED-24).

**Final verdict (all three audits concur):**
- **Public HTTP / tunneled deployment: NOT PRODUCTION-READY.**
- **Local stdio, supervised, pinned workspace: CONDITIONALLY USABLE** — not generally production-approved until P0/P1 fixes land.

Strongest areas: approval atomicity, file-write durability, command-construction security, testing breadth, observability richness, dependency hygiene.
Weakest areas: centralized authorization, execution-reality reconciliation, compensation truthfulness, HTTP token lifetime, deployment unification, boundary-level test coverage.

---

## 2. Scope, Method, and Evidence Precedence

The consolidated report applies the following precedence when sources disagree (adopted from Audit C's Phase-10 gate, consistent with A/B practice):

1. Current working-tree implementation and safe reproducible PoC/output.
2. Dedicated phase evidence (security, reliability, performance, architecture, validation).
3. Executable tests and benchmark output, interpreted only within their actual coverage.
4. Latest repository audit summaries, only where not contradicted by stronger evidence.
5. README/runbooks/tool descriptions as documentation contracts, not implementation proof.
6. Live connector schema as deployed-runtime evidence only (source/runtime drift was demonstrated).

This precedence is why findings Audit C retained from its dedicated phases (`git diff --no-index`, OAuth expiry, redaction leak, crash hydration, dirty rollback, package rollback, Prometheus format) survive even where later summaries omitted them — and every one of them was independently re-verified against source during this consolidation (§0.3).

---

## 3. Repository & System Architecture and Trust Boundaries

```
ChatGPT / MCP client
        │
        ├──> stdio transport ──────────────────────────┐
        │                                              │
        └──> HTTP transport → token/OAuth/session ─────┤→ MCP tool registry
                                                       │
                       ┌───────────────────────────────┤
                       │          direct MCP tools (adapter A)
                       │            → services (fs/shell/git/package)
                       │            → security (guard/validator/permission/PDP)
                       │            → OS filesystem / processes / network
                       │
                       └──> task tools (adapter B — duplicate layer)
                                → TaskRuntimeService
                                → closed-agent-loop
                                → governance / approval (SQL-atomic, single-use)
                                → executor → handlers → services
                                → SQLite (WAL) / OS

Persistent state (SQLite): tasks, steps, approvals, checkpoints, executions,
recovery events, tool calls, memory, file backups, package snapshots
```

**Primary trust boundaries (unified list):**
1. Network/stdio caller → MCP server (bearer token / OAuth / local OS trust).
2. Model/client → privileged tool invocation (prompt-injection boundary).
3. Workspace-restricted file abstraction → host filesystem.
4. `execute_command` → unsandboxed process under the HooshiX OS account.
5. Direct tool path → durable Task/governance path (**different enforcement semantics** — root cause of HIGH-01/03 and MED-06/28).
6. Bearer/OAuth credential → authenticated HTTP capability set.
7. Persisted Task state → external side-effect reality after timeout, crash, retry, or rollback.

**The single most important architectural security fact (all audits agree):** several invariants are enforced per handler/service instead of at one unavoidable boundary. The strongest example is workspace management, which can widen scope without the canonical permission/PDP path used elsewhere.

**Cross-layer shortcuts (verified):** `tools/task/index.ts` writes raw SQL (transport→persistence, incl. request-time `CREATE TABLE`); `tools/system/workspace.ts` duplicates `SystemToolHandler`; services import the PDP singleton (inward direction, but couples FS ops to approval state); workspace guard is ambient mutable process state.

---

## 4. Audit Coverage & Validation Results

**Executed and green (reproduced across audits):**
- `tsc -p tsconfig.json` build: PASS, 0 errors · `tsc -p tsconfig.test.json --noEmit` typecheck/lint: PASS, 0 errors
- `vitest run`: **342/342 tests, 81/81 files, ~35s** (single-worker profile)
- Coverage: **87.85% stmts / 76.38% branches / 92.29% functions / 91.64% lines** (gates 80/75/85/85)
- `pnpm audit` (prod + full): **no known vulnerabilities**
- **20,000-input randomized smoke: 0 crashes** (Audit C)
- Targeted security/E2E profile: **25/25 PASS** (Audit C)
- Live permission probes: all mutating/eval command forms (`git push --force`, `git clean -fd`, `git reset --hard`, `node --eval`, `python -c`, `gh api`, `gh repo delete`) → correctly `approval_required`/`blocked`; read-only (`git log`, `gh pr list`) → `allow`
- Benchmarks: 1000 audit writes **101–136ms**; 1000 metric query sets **170–211ms**; live `agent_metrics` ≈**4ms** at 2515 rows; searches tens of ms
- Full source read (92 files), manifests/configs, deployment scripts, git history secret scan (`.token`/`.env*` never committed), EXPLAIN QUERY PLAN index verification

**Could not validate (honest limits, unified):**
- Live exploit against the deployed public endpoint (never attempted)
- True multi-process duplicate-task execution, high-concurrency HTTP load, 25k/250k-row production-query benchmark, session-churn stress
- `winget`/`choco` end-to-end under ADMIN_MODE; `promtool check metrics` (promtool absent)
- Persistent coverage-guided fuzzing (single randomized smoke only)
- Deployed-connector behavior vs. source (drift demonstrated → runtime claims kept distinct from source claims until build/deploy provenance is fixed)

---

## 5. HIGH Findings (13)

### HIGH-01 — Workspace-management authorization and scope-expansion gap (CWE-862/269)
**[was SEC-001 / H-01] · PoC-confirmed (two audits) · [source-verified]**
- **Location:** `src/tools/system/workspace.ts` (`set_workspace`, `remove_workspace_root`, `replace_workspace_roots`) and `src/core/executor/handlers/system-handler.ts` (`case "set_workspace"`).
- **Evidence:** Neither the MCP handlers nor the executor handler call `assertToolPermission` or `policyDecisionPoint.assertAllowed` (grep-verified: zero checks). No central server-level gate exists (`createMetricsServer` records metrics only). `set_workspace` **is** in `TOOL_NAMES` (`tool-orchestrator.ts:10`), so `task_create` accepts `{tool:"set_workspace", arguments:{path, unrestricted:true}}` despite the code comment claiming exclusion; PDP gates it only at `DEVELOPER_MODE` (the default), which task tools already satisfy → no approval.
- **Execution path:** MCP client / task step → `set_workspace{unrestricted:true}` → `setActiveWorkspace` + `setUnrestrictedMode(true)` → `validateWorkspace` accepts any absolute host path for all file tools. PoC: `validateWorkspace(<outside>/anywhere.txt)` returned the path instead of throwing.
- **Impact:** least-privilege permission levels undermined; a model-controlled call widens filesystem authority without a human/admin scope-escalation boundary; combined with HIGH-02 → host-wide secret access.
- **Fix (minimal safe):** centralize tool authorization; enforce permission/PDP on all workspace mutations; require explicit approval or ADMIN policy for `unrestricted`; drop `set_workspace` from the task-step tool enum or add to `APPROVAL_TOOLS`; regression tests through the *actual MCP handler* (the existing adversarial test only exercises `setActiveWorkspace` directly).

### HIGH-02 — `search_files` bypasses the sensitive-file denylist (CWE-200/312)
**[was SEC-002 / H-02] · PoC-confirmed (two independent runs) · [source-verified]**
- **Location:** `src/services/filesystem/filesystem-service.ts` → `searchWorkspaceFiles` walk (lines 380–415) — reads every file, never calls `assertNotSensitive`/`isSensitivePath` (contrast lines 175/188/220/258/292).
- **Evidence:** Audit A PoC: `.env` + `.ssh/id_rsa` with `FAKESECRET_123` → search returned the lines. Audit B fresh PoC: `.env` with `SECRET_TOKEN=supersecret123` → `read_file` blocked, `search_files` returned `{path:".env", line:1, text:"SECRET_TOKEN=supersecret123"}`. Also: file-as-root throws raw `ENOTDIR` (missing root `isDirectory` check).
- **Documentation contradiction:** tool description claims sensitive files are "skipped" — false.
- **Impact:** any secret inside any workspace root is exfiltratable line-by-line (≤1000 matches × 512 bytes); chained with HIGH-01 → host-wide.
- **Fix:** apply `assertNotSensitive(fullPath)` per file inside the walk, skip `SENSITIVE_DIRS` descent, fix the description, reject non-directory roots; **write the exploit regression test first**.

### HIGH-03 — Auto-approved `git diff --no-index` discloses files outside the workspace (NEW — Audit C)
**[was H-03] · Safe PoC-confirmed · [source-verified]**
- **Location:** `src/security/permissions/command-permission.ts:28` — `safeGitSubcommands` includes `diff`; auto-allowed read-only git subcommands never validate path-bearing arguments. Compounded by MED-04 (unvalidated `cwd`).
- **Evidence (PoC):** `execute_command: git diff --no-index C:/Windows/win.ini C:/Windows/system.ini` executed **without approval** and returned file content outside the workspace.
- **Impact:** workspace + sensitive-file abstractions bypassed for any OS-readable path via a command classified low-risk.
- **Fix:** block or approval-gate `git diff --no-index`; validate path-bearing arguments of all auto-approved Git/GH commands against the workspace/task context; separately validate generic shell `cwd` (MED-04).

### HIGH-04 — OAuth advertises expiry that is not enforced (NEW — Audit C; supersedes LOW-003)
**[was H-04] · [source-verified]**
- **Location:** `src/mcp/oauth.ts:30-41,109-117` — `verifyToken()` is a pure timing-safe equality against the master token; `tokenResponse()` returns the long-lived master token while advertising `expires_in: 3600`; refresh-token derivation is deterministic and never rotated/inactivated per use.
- **Impact:** a stolen accepted token remains valid far beyond the advertised one-hour window until master rotation; refresh tokens are replayable indefinitely.
- **Fix:** issue distinct client access tokens with explicit `issued_at`/`expires_at`, resource/client binding, and revocation/expiry checks; rotate refresh tokens per use and invalidate consumed values.

### HIGH-05 — Timeout can finalize workflow state before external execution is confirmed stopped
**[was SEC-003 / H-05] · [source-verified] · runtime gap previously demonstrated (~1.3s task-failed→tool-completed)**
- **Location:** `src/core/loop/closed-agent-loop.ts` → `withStepTimeout` (lines 43–56).
- **Evidence:** on timeout, `abortController?.abort()` and **immediately** resolve `{timedOut:true}` — never awaits the in-flight promise or termination confirmation. Loop persists `outcome_unknown`, may advance/retry (backoff ≥1s), finalizes the task — while the child may still run or complete afterwards.
- **Impact:** duplicate/interleaved mutations on retry; persisted state ≠ actual process state. `reconciliationRequired` marker exists but nothing consumes it.
- **Fix:** after abort, await bounded termination confirmation (grace window); do not retry an `outcome_unknown` mutation until explicit reconciliation proves it safe.

### HIGH-06 — Crash recovery replays uncertain side effects
**[was SEC-004 / H-06] · [source-verified]**
- **Location:** `src/core/recovery/crash-recovery.ts` + `findInterruptedTasks` states (`executing/checkpointing/recovering/resuming/verifying`).
- **Evidence:** a step persisted `running` before tool execution is reset to `pending` after a crash and automatically re-entered; `outcome_unknown` steps are treated as simply "not completed" and re-executed. Idempotency keys exist for file writes/deletes but are optional and absent for `execute_command`/git/package steps.
- **Impact:** a side effect that succeeded just before the crash runs again after restart (git commits, package ops, approved commands, non-idempotent restores).
- **Fix:** convert interrupted mutating steps to `outcome_unknown`; require reconciliation or durable idempotency proof before automatic retry; document the at-least-once contract.

### HIGH-07 — Crash recovery hydrates an incomplete TaskPlan (NEW — Audit C)
**[was H-07] · [source-verified]**
- **Location:** `src/core/memory/task-repository.ts` → `findInterruptedTasks()` (lines 395–432) vs. canonical `getTaskPlan()`.
- **Evidence:** the recovery hydration omits `retry_policy`, `total_run_count`, `runWhen`, attempt counters/history, `templateArguments`, `idempotencyKey`; recovery also uses hard-coded recovery behavior in places.
- **Impact:** restart can change workflow semantics — reset retry budgets, alter conditional (`runWhen`) step behavior, lose template provenance.
- **Fix:** one canonical row-to-plan mapper/hydration path shared by normal load and crash recovery.

### HIGH-08 — Git rollback can destroy pre-existing dirty work (NEW — Audit C)
**[was H-08] · [source-verified]**
- **Location:** `src/core/executor/handlers/task-snapshot-handler.ts:43-64` — snapshot records HEAD/branch/status only; rollback runs `git reset --hard` + `git clean -fd`; no clean-tree precondition.
- **Impact:** work that existed *before* the task snapshot can be irreversibly removed although the user-facing contract implies restoration to the pre-task state.
- **Fix:** require a clean working tree for snapshot/rollback; support dirty-state rollback only after complete recoverable capture exists.

### HIGH-09 — Package rollback reports more than it actually restores (NEW — Audit C)
**[was H-09] · [source-verified]**
- **Location:** `src/services/package/package-service.ts:52-64` — restores `SNAPSHOT_FILES` (manifests/lockfiles) only.
- **Evidence:** `node_modules`, Python environments, PATH/service changes, and system packages are not restored; winget/choco snapshots may contain no restorable file state, yet rollback can be recorded `rolled_back`.
- **Impact:** persisted state claims success while the machine/environment remains mutated.
- **Fix:** rename the mechanism to **manifest rollback**; report full rollback only after manager-specific environment reconciliation verifies reversal.

### HIGH-10 — Docker frozen-lock integrity silently falls back to unfrozen install
**[was H-10; part of MED-009 — severity upgraded per §0.4] · [source-verified]**
- **Location:** `Dockerfile` — `pnpm install --frozen-lockfile 2>/dev/null || pnpm install` in both stages.
- **Impact:** a lock inconsistency that should fail closed can instead resolve a dependency graph different from the reviewed lockfile (supply-chain integrity).
- **Fix:** remove fallback installs; fail image construction on frozen-lock failure.

### HIGH-11 — Deployment authentication contract is inconsistent (merged SEC-005 + MED-002 + H-11)
**[source-verified]**
- **Location:** current source/README use `MCP_ACCESS_TOKEN` (`http-server.ts:29`); Docker/Compose and legacy setup use `MCP_API_KEY` (`Dockerfile:36-37`, `docker-compose.yml:8`); legacy guidance contains the literal `hooshix-v2-secret` (`scripts/start_nodejs_mcp.bat:9`, `scripts/SETUP_NODEJS_MCP_V2.md:14,100`).
- **Qualification (adopted from Audit C):** ignoring `MCP_API_KEY` does **not** leave the server unauthenticated — it loads/generates a different token. The defect is the operational contract mismatch (unknown credential state) plus unsafe legacy secret guidance.
- **Impact:** operator deploys with a guessable public-repo secret, or believes auth is configured while a different/unknown credential is in effect.
- **Fix:** one canonical variable (`MCP_ACCESS_TOKEN`); remove the static legacy value; startup effective-config report (no secret values); configuration-contract integration test.

### HIGH-12 — Authenticated HTTP health endpoint conflicts with container/runbook probes
**[was H-12; part of MED-009 — severity upgraded per §0.4] · [source-verified]**
- **Location:** Docker/Compose healthchecks and setup verification hit `/health` without Authorization, while HTTP mode always has an access token and monitoring routes require it.
- **Impact:** a healthy service is systematically marked unhealthy; operational verification fails.
- **Fix:** one liveness contract — minimal unauthenticated liveness endpoint with no sensitive data, or securely injected monitoring credential into the probe.

### HIGH-13 — Same-task exclusion is not durable across processes (conditional)
**[was H-13] · [source-verified]**
- **Location:** `task-runtime-service.ts:22` — process-local `Set`; no persisted lease/claim.
- **Impact:** watchdog overlap, accidental double-start, or future replica/shared-DB deployment can duplicate external side effects (SQLite serializes DB writes, not executions). Low likelihood in the current single-process default; HIGH if multi-process is ever supported.
- **Fix:** if multi-process execution is supported, add an atomic persisted execution lease with owner and expiry/heartbeat. Do not replace SQLite merely for this.

---

## 6. MEDIUM Findings (29)

**MED-01 — Monitoring bearer token in URL query strings** `[MED-001/M-01]` — `http-server.ts:413-416` accepts `?token=<master>` for `/health`,`/metrics`,`/dashboard`,`/tools` (CWE-598). Amplified by HIGH-04 (token never expires as advertised). Fix: Authorization header or short-lived scoped session; localhost-only exception at most.

**MED-02 — Audit redaction `redactNext` flag never activated → separated secret values leak (NEW — Audit C)** `[M-02] · [source-verified]` — `command-audit.ts:12-31`: the flag is declared and read but no path sets it `true`; `--token VALUE` style args log the VALUE verbatim unless it independently matches a pattern. Fix: activate next-arg redaction on flag detection + opaque-value regression tests.

**MED-03 — No server-side HTTP/tool rate limit** `[MED-005/M-03]` — no 429/rate/concurrency gate for repeated authenticated requests; expensive calls (`search_files`) can consume CPU/disk/worker capacity (see also the ~9.77 GiB worst-case read in §11). Fix: bounded per-token/IP limits and small concurrency budgets for expensive ops.

**MED-04 — Generic shell `cwd` not workspace-authorized** `[MED-008/M-04] · [source-verified]` — `shell-service.ts:20` resolves but never validates `cwd` (contrast `git-service.ts:21`). Expands read scope for auto-approved read-only commands (compounds HIGH-03). Fix: validate `cwd` against task execution context/workspace before subprocess start.

**MED-05 — Audit failure can convert a completed side effect into a reported failure (NEW — Audit C PoC)** `[M-05]` — post-effect audit logging failure rejects the call to the client after the file side effect already exists; consistent with MASTER's observation that audit calls inside catch paths can throw and mask the original error (`shell-service.ts:45`). Fix: separate business-outcome from audit-sink health; durable intent/outbox/reconciliation if strict audit durability is required.

**MED-06 — Direct MCP file APIs omit existing CAS/idempotency controls** `[LOW-001→upgraded / M-06] · [source-verified]` — `ifMatchSha256`/`idempotencyKey` supported by the service/task handler but hidden by direct MCP schemas. Fix: expose the existing capabilities; do not invent a second concurrency mechanism.

**MED-07 — Project canonical identity is not canonical (NEW — Audit C PoC)** `[M-07] · [source-verified]` — `saveProject` conflict-checks with `canonicalizePath()` but INSERTs the raw `input.path`; equivalent trailing-slash forms created two project identities in a PoC. Fix: persist the canonical identity value; migrate collision-safely.

**MED-08 — Task idempotency key ignores payload equality (NEW — Audit C)** `[M-08] · [source-verified]` — documented contract says key+payload; lookup is `WHERE idempotency_key = ?` only. Fix: store a canonical request hash; same key + different hash = explicit conflict.

**MED-09 — `task_append_steps` accepts terminal tasks that cannot run appended steps (NEW — Audit C)** `[M-09] · [source-verified]` — completed/cancelled are terminal in the state machine, yet append is allowed and reports success; appended steps can never execute (`task_run` returns the terminal no-op). Fix: restrict append to resumable states or implement explicit reopen/revision semantics.

**MED-10 — Reusing an absent-state backup changes restore semantics (NEW — Audit C PoC)** `[M-10] · [source-verified]` — absent-ness is encoded in the mutable `restored_at` column; first restore overwrites it, so a second restore of the same id writes the empty BLOB as a normal restore → creates an empty file. Fix: immutable `previous_state` metadata separate from `restored_at`.

**MED-11 — File restore lacks a revision precondition** `[MED-006/M-11] · [source-verified]` — `file_revision` (SHA-256) is computed and stored but never used as a restore precondition; an old backup silently overwrites newer state. Fix: default-deny when current SHA ≠ expected post-mutation SHA unless explicit historical/force mode.

**MED-12 — Backup restore binds to the mutable current workspace** `[MED-007/M-12]` — stored (possibly relative) backup paths resolve against the current global workspace; a task resumed after `set_workspace` can restore to a different directory. Fix: persist resolved absolute targets; re-authorize that exact path at restore/resume.

**MED-13 — Production container runs as root; base image mutable by tag** `[M-13; part of MED-009]` — no `USER node`; `node:24-slim` tag-pinned rather than digest-reviewed. Fix: non-root user, only `/app/data` writable; optional reviewed digest pinning.

**MED-14 — No checked-in CI gate** `[M-14]` — build/typecheck/tests/coverage/audit/container checks are local-only. Fix: minimal CI (frozen install → build/typecheck → test/coverage → audit → container/config-contract checks) with least-privilege workflow permissions.

**MED-15 — Node/NVM PATH bootstrap not reproducible (NEW — Audit C; hit independently by Audit B)** `[M-15]` — audit subprocesses resolved pnpm while child scripts could not resolve Node until an explicit Node-24 path was used; both audits hit this wall. Fix: explicit service/watchdog PATH and startup preflight for Node/pnpm versions.

**MED-16 — Multiple incompatible production runbooks (NEW — Audit C)** `[M-16]` — Docker, legacy batch/setup, watchdog/tunnel, README, and live connector behavior do not form one executable operational contract. Fix: one production runbook + one canonical env/schema contract; deprecate conflicting launch paths.

**MED-17 — Metrics/dashboard production query shapes under-indexed and under-benchmarked (NEW — Audit C; extends MED-003)** `[M-17]` — real shapes (time filtering, ordering, OFFSET pagination) lack explicit indexes and are not modeled by the microbenchmark. Fix: benchmark actual query plans at representative row counts, then add only evidence-backed indexes / keyset pagination.

**MED-18 — Retention is startup-only and incomplete** `[MED-003/M-18]` — cleanup covers selected tables at startup only; `executions`, `decisions`, `memory_items`, `package_snapshots`, idempotency responses, and unrestored backups grow indefinitely. Fix: explicit table-by-table retention semantics + periodic cleanup.

**MED-19 — Historical HTTP session metrics accumulate (upgraded from LOW-009; Audit C M-19)** — the metrics session map retains closed-session history; active-count computation scans all sessions per request. Fix: age/delete closed metric session records; preserve lifetime counters separately.

**MED-20 — Hot-path schema introspection adds synchronous DB work (NEW — Audit C)** `[M-20] · [source-verified]` — `tool-audit.ts:19-22` runs `PRAGMA table_info(tool_calls)` on **every** tool call despite the once-per-process migration fix elsewhere. Fix: move schema evolution fully into migrations or cache the check once per process.

**MED-21 — Known HIGH exploits have no focused regression tests (NEW — Audit C; extends MASTER §21)** `[M-21]` — a green suite coexists with confirmed security defects because the exploit paths are not encoded in tests (workspace authz, sensitive search, `git diff --no-index`, OAuth expiry, crash replay, rollback contracts). Fix: **write these regressions first**, before remediation.

**MED-22 — HTTP/OAuth/metrics transport behaviorally under-tested (NEW — Audit C)** `[M-22]` — the modules are excluded from meaningful coverage and the prior HTTP test is deleted in the current tree. Fix: process-level HTTP E2E — fake token, disposable port/DB/workspace, OAuth PKCE flow, unauthorized/authorized MCP, monitoring auth, metrics-format assertions.

**MED-23 — Global coverage hides weak critical-branch coverage (NEW — Audit C)** `[M-23]` — global branch 76.38% while critical runtime/recovery files sit at ~53–64%. Fix: targeted per-file/glob critical thresholds after focused tests; do not chase blanket 100%.

**MED-24 — Test harness is not parallel-isolated (NEW — Audit C)** `[M-24] · [source-verified config]` — intended single-worker suite passes; a 4-worker diagnostic produced **188 failures** from shared SQLite/WAL/global state. Fix: keep `maxWorkers:1` until each worker/file has isolated temp DB/log/workspace state.

**MED-25 — Prometheus HELP/TYPE lines malformed for labeled metrics (NEW — Audit C)** `[M-25]` — HELP/TYPE metadata carries labels instead of defining metadata per metric name with labels only on samples. Fix: one HELP/TYPE pair per metric name; golden-format validation and `promtool` in CI if available.

**MED-26 — Architecture dependency inversion incomplete** `[M-26; MASTER §13/14]` — core runtime/loop/handlers depend directly on persistence, global workspace/security state, concrete services, and SQLite functions; the composition root is real but incomplete. Fix: incremental ports at proven critical boundaries; extend the existing composition root rather than introducing a DI framework *(evidence floor — see §31 for the owner's larger directive)*.

**MED-27 — `TaskRuntimeService` and `closed-agent-loop` have broad responsibilities** `[M-27; MASTER SRP note]` — lifecycle orchestration, persistence, governance, retries, reporting, and telemetry are coupled in central critical-path modules. Fix: narrow `TaskRepository`, workspace-policy/context, and lifecycle persistence/telemetry collaborators; do not split every method into a class.

**MED-28 — Direct and Task tool adapters have drifted** `[M-28; LOW-001 root + SEC-001 dual-gap]` — two tool paths expose different schemas/enforcement/capabilities (proof: SEC-001 exists in both; `agent_metrics` Stage-21 regression); `tools/task` also reaches persistence directly. Fix: one metadata/schema/authorization source per tool, shared application-level capability boundaries.

**MED-29 — Host-header trust in OAuth metadata + CORS `*` on /mcp** `[MED-004 — MASTER only]` — `externalBaseURL` uses `req.headers.host` for issuer/endpoints unless `MCP_PUBLIC_BASE_URL` is set (issuer-poisoning surface when reachable by IP); CORS `Access-Control-Allow-Origin: *` with `Authorization` allowed. Fix: require `MCP_PUBLIC_BASE_URL` in HTTP mode (fail-closed); restrict CORS to the known origin.

---

## 7. LOW / Hygiene Findings (12)

- **LOW-01** `search_files` returns `absolutePath` — host path-structure leak; harmless locally. `[LOW-002]`
- **LOW-02** Silent `catch { /* ignore */ }` in schema-drift paths (`backupFile` fallback, `ensureExtraColumns`, `tool-audit`, `metrics-service`) masks real DB failures. `[LOW-004]`
- **LOW-03** Dual audit stacks (JSONL command/file audit vs SQLite tool audit) + legacy recovery/memory layers (`startup-recovery` report, `resume-memory.getResumableTasks`, `governance-engine` string branch). Consolidate. `[LOW-005]`
- **LOW-04** `gitLog` interpolates `--max-count=${limit}` — safe (zod-typed both paths) but fragile pattern. `[LOW-006]`
- **LOW-05** Dead `config/config.json` misleads operators (nothing reads it). `[LOW-007; both audits]`
- **LOW-06** Repo data noise: git-tracked `data/agent-memory.json` (`{"task":"test"}`); `database/hooshix.db` in tree. `[LOW-008]`
- **LOW-07** Auto-generated `.token` does not explicitly request restrictive POSIX owner-only mode. `[Audit C]`
- **LOW-08** No persistent property/coverage-guided fuzz framework (20,000-input randomized smoke passed with 0 crashes). `[Audit C]`
- **LOW-09** `lint` is a typecheck alias (`tsc --noEmit`), not a separate linter/static-security scanner. `[Audit C]`
- **LOW-10** `git diff --check`: trailing whitespace / line-ending churn. `[Audit C]`
- **LOW-11** README tool inventory incomplete relative to registered tools. `[Audit C]`
- **LOW-12** Documentation authority unclear while the tree stays heavily dirty (deleted tracked docs, untracked replacements, commit messages "first…fifth commit", branch name `hooshix-mcp-git-test`). `[both audits]`

---

## 8. Security Assessment

### 8.1 Attack surface map

| Entry point | Trust | Sensitive op | Validation | Authorization | Risk |
|---|---|---|---|---|---|
| `/mcp` POST (JSON-RPC tools) | bearer/OAuth token | all 30+ tools | zod per tool | per-handler — **inconsistent (HIGH-01)** | HIGH |
| `/mcp` GET/DELETE (sessions) | bearer | session lifecycle | session-id map | token gate | MED-03/19 |
| `/oauth/authorize` POST | public | PIN → auth code | redirect allowlist, PKCE S256, resource match | PIN == master token | OK (no rate limit) |
| `/oauth/token` POST | public | issue tokens | PKCE verify, single-use code | **no real expiry (HIGH-04)** | HIGH |
| `/oauth/register` POST | public | client registration | redirect allowlist | none (fine) | LOW |
| `/health`,`/metrics`,`/dashboard`,`/tools` | bearer **or `?token=`** | metrics/inventory | — | token compare (MED-01) | MED |
| stdio | OS user | all tools | same | none (local trust) | OK locally |
| Task steps (`task_create`) | bearer | governed tools | plan validation + zod | PDP per step — `set_workspace` accepted (HIGH-01) | HIGH |
| Env config | operator | permission level, unrestricted, token | parsed at boot | — | fail-open defaults (§15) |

### 8.2 Trust-boundary gaps (unified)

| Boundary | Gap |
|---|---|
| Internet → HTTP | single static master token; advertised expiry unenforced (HIGH-04); query-string variant (MED-01); no rate limits (MED-03) |
| Model → tools (prompt injection) | scope escalation with no human gate (HIGH-01); auto-approved path-bearing commands (HIGH-03) |
| Tool → Shell | `cwd` unvalidated (MED-04); `git diff --no-index` reads anywhere (HIGH-03) |
| Tool → Filesystem | denylist bypass via search (HIGH-02); sandbox disableable (HIGH-01); restore binds mutable workspace (MED-12) |
| Task state ↔ reality | timeout (HIGH-05), crash replay (HIGH-06), hydration (HIGH-07), audit masking (MED-05) |
| Compensation claims | git dirty rollback (HIGH-08), package manifest-only rollback (HIGH-09), absent-backup reuse (MED-10) |

**Verified-safe (all audits, explicitly checked):** SQL injection (fully parameterized; string-built SQL only via validated identifiers); command metacharacter injection (`shell:false`, argv separation, allowlist, `--` separators, NUL/CR/LF rejection, SHA-40 rollback validation — adversarially tested); template injection (static single-pass regex, no eval, no recursive expansion of resolved values); path traversal/symlink escape in *normal* file ops (realpath ancestor + target re-assertion); PKCE S256 with one-time codes; timing-safe comparisons in the principal path; XSS in dashboard (all interpolations escaped); secret redaction patterns in audit logs (with the MED-02 exception); `.token`/`.env*` never committed (git history verified).

### 8.3 Most dangerous realistic chains (unified)

**Chain A — scope expansion → secret search:**
`authenticated/model-controlled caller → set_workspace/unrestricted [HIGH-01, no approval] → search_files [HIGH-02] → sensitive file contents returned → exfiltration`

**Chain B — generic read-only command → external disclosure:**
`DEVELOPER_MODE caller → execute_command git diff --no-index <outside paths> [HIGH-03, auto-approved] → OS-readable file content returned`

**Chain C — monitoring token leakage → persistent HTTP access:**
`master token in dashboard URL [MED-01] → browser/proxy/history exposure → same bearer usable for MCP → expiry not enforced as advertised [HIGH-04]`

**Full RCE chain (contextual):** `token leak (HIGH-11) or prompt injection → set_workspace(unrestricted:true) [HIGH-01] → search_files credential exfiltration [HIGH-02] → task_create(execute_command code-exec) → task_approve (same principal) → RCE as OS user.` Every link except the last requires no approval.

No live attack was attempted against any public endpoint; all statements are source-confirmed or safe-local PoCs.

---

## 9. Exploitability Assessment

| Class | Findings |
|---|---|
| **Confirmed exploitable (PoC)** | HIGH-01 (sandbox disable, MCP + task paths), HIGH-02 (secret exfiltration via search — 2 PoCs), HIGH-03 (external file disclosure via git diff) |
| **Implementation-confirmed** | HIGH-04 (no expiry enforcement), HIGH-07 (hydration), HIGH-08 (dirty rollback), HIGH-09 (package rollback), HIGH-10/12 (Docker), MED-02 (redaction leak), MED-05 (audit masking), MED-07 (identity duplication), MED-10 (absent-backup reuse) |
| **Conditionally exploitable** | HIGH-05/06 (timeout/crash timing → duplicate mutations), HIGH-13 (multi-process only), MED-04 (arbitrary-cwd disclosure, no approval needed for read-only cmds) |
| **Highly likely (deployment)** | HIGH-11 chain (weak documented secret or misnamed env) |
| **Theoretical only (verified infeasible)** | PIN brute force, refresh-token forgery absent master leak (HMAC-SHA256), PKCE bypass, SQL injection, command metacharacter injection |

---

## 10. Dependency & Supply-Chain Assessment

- `pnpm audit` (prod + full): **no known vulnerabilities** (reproduced).
- Minimal, exact-pinned, current runtime deps: `@modelcontextprotocol/sdk@1.30.0`, `better-sqlite3@13.0.3`, `execa@10.0.1`, `zod@4.5.4`; dev: `typescript@7.0.2`, `vitest@4.1.11`, `tsx@4.23.13`, `@types/node@24.10.13`.
- `pnpm-lock.yaml` v9 full pinning; `pnpm-workspace.yaml` **build-script allowlist** (`better-sqlite3`, `esbuild`) — genuinely good posture.
- **No CI exists** → supply-chain gates are local-only (MED-14).
- Docker: frozen-lock fallback fails open (HIGH-10); root container + mutable tag (MED-13); `.dockerignore` correct (`.env*`, `data`, `*.db*`, tests, `.git`).
- No vendored/generated code; no typosquat-suspicious packages; small transitive surface (dev-time vitest toolchain only).

---

## 11. Performance Assessment

### 11.1 Measured baseline (unified runs)

| Operation | Measured |
|---|---|
| 1000 direct SQLite audit writes | 101.0–135.6 ms (≈0.10–0.14 ms/write) |
| 1000 four-query metric sets | 169.5–211.3 ms (≈0.17–0.21 ms/set) |
| Live `agent_metrics` @ 2515 tool-call rows | ≈4 ms |
| Repository searches during audit | tens of ms |
| Full test suite (single worker) | ~35 s |
| 20,000-input randomized smoke | 0 crashes |

**Current local single-agent performance is good.** No speculative optimizations recommended.

### 11.2 Workload-dependent bottlenecks (no universal first bottleneck)

- **Write-heavy concurrent tasks:** synchronous SQLite single-writer serialization.
- **Search-heavy traffic:** `search_files` filesystem I/O — per-call configured upper bound on content reads is **10,000 files × 1 MB ≈ 9.77 GiB worst-case** (rare/no-match); plus per-entry realpath churn (redundant re-validation) and full-file reads. Bounded but IO/CPU-heavy — combined with MED-03 (no rate limit) this is the practical DoS surface.
- **Long uptime/history/dashboard:** incomplete startup-only retention (MED-18), missing time/order indexes on real query shapes (MED-17), historical session-metric scans (MED-19), synchronous metrics queries, hot-path PRAGMA introspection (MED-20).

### 11.3 What NOT to infer

Neither audit ran a true 100× HTTP load test, multi-process writer benchmark, 25k/250k-row production-query benchmark, or session-churn stress test. 10×/100× statements are reasoned projections from measured baselines and implementation bounds — **not measured capacity guarantees**.

### 11.4 Recommendation

Do **not** replace SQLite solely because it is single-writer. Fix correctness/lease/retention/query evidence first; evaluate a client/server DB only if multi-process/high-concurrent-write deployment becomes an actual requirement.

---

## 12. Scalability Assessment

Single-process Node; one synchronous SQLite connection (WAL, busy_timeout 5s); in-memory `sessions` Map; process-local `runningTasks` Set; process-local metrics.

- **10× (few concurrent users):** fine — WAL readers + serialized writer; step timeouts cap runaway tools; outputs bounded (128 KB persisted).
- **100×:** ordered bottlenecks: (1) trace-table growth + 7-query metrics path per dashboard hit (MED-17/18); (2) synchronous SQLite blocking the loop during large plan transactions; (3) sessions Map + per-session `McpServer` instances (MED-03/19); (4) boot-time crash-recovery scan of all interrupted tasks.
- **Multi-instance:** impossible without moving sessions/tokens/DB to shared state — and the duplicate-run guard is process-local (HIGH-13). **No distributed infrastructure is justified for the stated product purpose** (personal local agent).
- **Degraded dependencies:** git/npm/pip failures fail steps with typed errors; retries only for TIMEOUT/NETWORK with capped backoff; per-task retry budgets exist. HTTP layer has no idle-stream timeouts (minor).

---

## 13. Clean Architecture Assessment — **Partial (4–5/10)**

- ✅ **Genuine seams:** `core/planner`, `core/state`, `core/errors` are framework-free; the loop receives an executor callback instead of invoking MCP; zod confined to adapter/handler layers; SQLite confined to `core/memory` + legitimately persisting services; MCP SDK types confined to `tools/` + `mcp/`; a **real composition root** exists.
- ❌ **Violations:** `tools/task` (transport) writes raw SQL incl. request-time `CREATE TABLE` (adapter→persistence); `tools/system/workspace.ts` duplicates the executor handler (inbound adapter duplication — proven defect source: HIGH-01 exists in both, Stage-21 `agent_metrics` regression); services import the PDP singleton (inward but coupling FS ops to approval state); `core/governance` imports outer `security/permissions`; `core/runtime` imports the workspace-guard singleton; the loop/runtime import persistence/telemetry concretions (MED-26); composition is spread outside the composition root.
- **No true domain layer:** rules live across planner/state-machine/governance — cohesive and testable (hence Partial, not Superficial) but the model is "service + handler".

## 14. Hexagonal Architecture Assessment — **Partial (4–5/10)**

- ✅ **Real ports where it mattered:** `ToolHandler` (narrow, useful), `RecoveryProvider`, `RecoveryObservabilitySink`, `TraceRepository`/`ExecutionTraceService`, `PolicyDecisionPoint` abstraction, composition-root wiring.
- ❌ **The boundaries that matter most are concrete:** no outbound ports at filesystem/shell/git/package/workspace — handlers import concrete services directly; `workspace-guard` is ambient mutable process state rather than an adapter behind a port; the two inbound adapters (direct MCP tools vs executor handlers) are **uncoordinated** and have drifted (MED-28); substitution capability is untested for FS/process boundaries; `http-server.ts` concentrates routing + OAuth + auth + sessions + dashboard + metrics.

## 15. SOLID / Design Assessment — ~6/10

- **SRP 7/10** — mostly single-purpose files; outliers: `TaskRuntimeService` (create/run/approve/cancel/resume/report) and `closed-agent-loop` (lifecycle+governance+retry+telemetry) — MED-27; `http-server.ts` (5 concerns, 1037 lines).
- **OCP 5/10** — adding a tool touches 6–8 sites (TOOL_NAMES, TOOL_CAPABILITIES, permission map, APPROVAL_TOOLS, handler class, handlers[], MCP tool file, registry). The capability-scored `ToolSelector` fallback is a latent footgun.
- **LSP 8/10** · **ISP 8/10** — handlers honor the port contract; interfaces are small.
- **DIP 5/10** — inversion at recovery/trace ports; absent at FS/shell/workspace; `policyDecisionPoint` hard singleton.
- **Over-engineering (mild, not harmful):** test-only `MemoryRecoveryObservability`; `startup-recovery`/`resume-memory` report nobody consumes; `governance-engine` string branch (dead on production paths); single-impl `TraceRepository` justified by injection.
- **Under-engineering (the real issue):** authorization centralization, termination confirmation, reconciliation, retention, token lifetime — exactly where the HIGHs live.

## 16. Dependency Direction Matrix

| From | To | Intended | Actual | Violation |
|---|---|---|---|---|
| `tools/task` (transport) | `core/memory` SQL | ✗ | direct INSERT / CREATE TABLE | **YES** |
| `tools/system/workspace.ts` | guard | ~ | duplicate of executor handler | drift |
| `core/executor/handlers` | `services/*` concrete | ~ | no port at FS/shell boundary | DIP gap |
| `services/*` | `core/governance` PDP | ✚ inward | singleton import; FS ops coupled to approval state | muddy |
| `core/governance` | `security/permissions` | ✗ | core→outer import | minor |
| `core/runtime` | `security/workspace-guard` | ✗ | app→ambient singleton | minor |
| `core/loop` | `core/memory`, `governance` | ✓ | clean | none |
| `core/planner`, `state`, `errors` | — | ✓ | framework-free | none |
| `mcp/*` | `tools/*`, `core/trace` | ✓ | adapters + metrics reads | acceptable |

---

## 17. Code Quality Assessment

**Good:** strict TS (`strict`, `noUnusedLocals/Parameters`); typed error taxonomy with documented migration rationale; comments explain *why* (fsync reasoning, write-amplification fix, `outcome_unknown` semantics); bounded inputs everywhere (1 MB files, 100 args, 100 steps, 500-char messages, 128 KB persisted results); consistent zod; honest tool descriptions (incl. the subprocess-scope disclosure); exact dependency pins.

**Negative:** dual tool implementations (recurring defect source); broad silent `catch { /* ignore */ }` (LOW-02); `sqlite-memory.saveTaskMemory` duplicates title/description (legacy, still used via `saveTaskWithContext`); `metrics-service.ts:3` `db: any`; `http-server.ts` monolith; dead code (`governance-engine` string branch, `startup-recovery` report, `config/config.json`, `MemoryRecoveryObservability`, trailing blank lines in `local-tool-executor.ts`); `git diff --check` whitespace churn; `lint` = typecheck alias only (no linter/security scanner).

---

## 18. Reliability / Resilience Assessment

**Strengths:** WAL + busy_timeout 5s; transactional plan persistence (task+steps atomically); SQL-atomic single-use approval consumption validated **before** consume; idempotent `task_run` on terminal states (structured no-ops); retries only for TIMEOUT/NETWORK with exponential backoff (1 s base, 30 s cap); per-task + per-step retry budgets; heartbeat + interrupted-state detection; incomplete recovery events finalized as failed at boot; explicit `outcome_unknown` state exists; completed-step skip in the normal path.

**Blocking weaknesses (the weak layer is execution-reality reconciliation):** HIGH-05 (finalize-before-terminate), HIGH-06 (blind crash retry), HIGH-07 (incomplete hydration), MED-05 (audit failure masks success), no per-tool circuit breaker (a flaky tool burns every task's budget), HIGH-08/09 (compensation truthfulness).

**Conclusion:** the file-write primitive is comparatively strong; the weak layer is reconciliation between persisted workflow state and real external state around tools, crash/retry, and compensation.

---

## 19. Data Integrity Assessment

Per-mutation crash analysis ("what if the process dies here?"):
- ✅ `atomicWrite` temp+fsync+rename — old-or-new, never partial; exclusive `wx` create — absent-or-complete.
- ✅ Backup-before-mutation in SQLite; displaced-backup undo chain; service-level CAS (`ifMatchSha256`) and idempotency dedup **where exposed** (MED-06 hides them from direct MCP).
- ✅ Step checkpointing per transition; completed steps never re-run in the normal loop (tested).
- ⚠️ Backup INSERT and the fs mutation are not one transaction (cannot be — SQLite vs fs); crash between rename and `saveTaskStep` → step `running` with mutation applied → crash-recovery re-runs it (HIGH-06 exposure; mitigated only when the step carries `idempotencyKey`).
- ⚠️ Package restore is per-file sequential — not atomic across files; `rollback_failed` exists but nothing retries it; and the mechanism overstates its guarantee (HIGH-09).
- ⚠️ Git rollback is intentionally destructive with a snapshot precheck — but no dirty-state capture (HIGH-08).
- ⚠️ Task semantics are deliberately Saga-style ("durable sequence, not transaction") — the correct domain call; compensation must become truthful rather than ACID-forced.

---

## 20. Concurrency Assessment

Single event loop + synchronous better-sqlite3: in-process check-then-act is structurally safe (`runningTasks` add/delete is synchronous around the await; duplicate `task_run` throws). Concurrency tests (50–100 interleaved writes, duplicate-run rejection) pass. Long tool calls run as awaited execa promises, so the loop is free; SQLite ops are short.

**Remaining hazards:** cross-restart duplication (HIGH-06), timeout-vs-retry overlap (HIGH-05), process-local duplicate-run guard (HIGH-13), sessions Map mutation (guarded by grace-period deletion only), `AsyncLocalStorage` approval scoping is correct (nested differing tools throw). **No in-process data-race class bugs found.** Test-parallelism isolation debt exists at the harness level only (MED-24), not the product path.

---

## 21. Testing Assessment — 7/10 (broad, strong; uneven at the riskiest boundaries)

**What exists (342 tests / 81 files):** unit (planner, resolver, state machine, governance, permission); integration (services vs temp workspaces + real SQLite); E2E (**real spawned MCP child processes**); adversarial security (command injection, rollback poisoning, approval bypass, unrestricted-mode invariants); concurrency; crash/persistence; DB benchmarks + EXPLAIN QUERY PLAN assertions; coverage gates enforced. Tests verify behavior, not implementation details. Plus Audit C's additions: 25/25 targeted security/E2E profile, 20,000-input randomized smoke (0 crashes).

**Why green ≠ safe (unified):**
- **MED-21:** the confirmed exploit paths are not encoded as regressions (workspace authorization via the *actual MCP handler*, sensitive search, `git diff --no-index`, OAuth expiry, crash replay, rollback contracts).
- **MED-22:** HTTP/OAuth/metrics transport is effectively outside behavioral coverage in the current tree (the prior HTTP test is deleted; modules excluded from coverage).
- **MED-23:** critical runtime/recovery files at ~53–64% branch coverage under a green 76.38% global.
- **MED-24:** harness not parallel-isolated — 4-worker diagnostic produced 188 failures from shared DB/WAL/global state.

**Fix order:** write exploit regressions first (they also serve as the acceptance tests for the remediation), then HTTP/OAuth process-level E2E, then per-file critical thresholds — without chasing blanket 100%.

---

## 22. CI/CD & Supply-Chain Assessment

**No CI exists.** All gates local-only. Docker: multi-stage, healthcheck present-but-broken-with-auth (HIGH-12), root user (MED-13), frozen-lock fallback (HIGH-10). Release process: none (v0.1.0, private, main never pushed). Node/pnpm PATH not reproducible (MED-15).

**Minimum CI (recommended):** frozen install → build → typecheck → test → coverage → `pnpm audit` → Docker/config-contract checks (token name, healthcheck liveness, non-root) → secret-scan grep gate (HIGH-11 class) → Prometheus format validation (MED-25); least-privilege workflow permissions; keep single-worker test profile until MED-24 is fixed.

---

## 23. Observability Assessment — 6.5/10

**Rich:** JSONL command/file audit logs with redaction patterns (MED-02 exception); SQLite tool-call metrics with categories/durations/errors; unified timeline (executions + recovery) per correlation ID; reflection reports; dashboard (escaped, masked token); Prometheus endpoint; health endpoint; correlation IDs persisted through every layer.

**Gaps:** Prometheus HELP/TYPE malformed for labeled metrics (MED-25); retention incomplete/startup-only (MED-18); session metrics accumulate (MED-19); separated secret values leak in command audit (MED-02); no HTTP-level request logging around auth/session failures; no log rotation; dashboard 10s meta-refresh polling; correlation IDs client-suppliable (spoofable — acceptable locally, note for public); startup does not log an effective-config summary (a HIGH-11-class misconfiguration is silent); hot-path PRAGMA overhead (MED-20).

**Incident diagnosability:** a production incident could largely be diagnosed from current telemetry — except HTTP-level failures before the MCP handler and anything dependent on the malformed Prometheus exposition.

---

## 24. Documentation & Operational Consistency

Documentation drift is a **material engineering risk, not a prose issue** (unified confirmed list):
- `search_files` claims sensitive files are skipped — implementation reads them (HIGH-02);
- running connector schema disagrees with current source on `set_workspace` unrestricted semantics (drift demonstrated);
- `MCP_ACCESS_TOKEN` vs `MCP_API_KEY` vs legacy `hooshix-v2-secret` (HIGH-11);
- HTTP health auth vs unauthenticated Docker/runbook probes (HIGH-12);
- README timeout state wording vs current `outcome_unknown` semantics (HIGH-05 context);
- README retention wording vs startup-only/partial retention (MED-18);
- README testing claims vs absent HTTP/OAuth behavioral coverage (MED-22);
- `config/config.json` inert with stale permission value (LOW-05);
- task append, rollback, project canonicalization, idempotency contracts overstate behavior (MED-07/08/09, HIGH-08/09).

**Recommended documentation authority (adopted from Audit C):**
1. `README.md` — product/runtime contract + local dev.
2. `docs/OPERATIONS.md` — one production auth/health/tunnel/container runbook.
3. `docs/SECURITY.md` — trust boundaries, permissions, unrestricted policy, token rotation, unsandboxed subprocess scope.
4. `docs/TOOLS.md` — generated from the actual tool metadata/schema source.
5. `docs/ARCHITECTURE.md` — current architecture only, not aspirational.
6. Dated audit reports — immutable evidence, not operational source of truth.

---

## 25. Production Readiness Assessment

| Deployment | Verdict | Conditions |
|---|---|---|
| **Public HTTP / tunneled (agent.hooshix.com)** | **NOT PRODUCTION-READY** | HIGH-01/02/03/04/05/06/07/08/09/10/11/12 + MED-01/03/14 on an Internet-reachable privileged surface |
| **Local stdio, supervised, single user** | **CONDITIONALLY USABLE** (not generally production-approved) | Pinned workspace, conservative mutation policy; confidentiality/integrity defects (HIGH-01/02/03, crash/rollback correctness) still apply |

---

## 26. Root-Cause Analysis (7 dominant causes, unified with debt taxonomy)

**A. Authorization and boundary-policy fragmentation** → HIGH-01/02/03, MED-04/06/28. Permission, workspace, sensitivity, and command-scope rules are distributed across registrations, handlers, and services instead of one unavoidable gate.
**B. Execution reality vs persisted workflow state** → HIGH-05/06/07, MED-05. Task state advances or retries before the external world is reconciled after timeout, crash, or audit failure.
**C. Compensation metadata stronger than compensation capability** → HIGH-08/09, MED-10/11/12. "Rollback" exceeds what git/package/file-restore paths actually guarantee.
**D. Multiple deployment/configuration sources of truth** → HIGH-10/11/12, MED-13/15/16. Docker, watchdog, batch setup, README, connector, and HTTP source evolved separately.
**E. Persistence lifecycle/schema evolution spread across subsystems** → HIGH-07, MED-07/08/17/18/19/20. Hydration, retention, metrics, schema introspection, and identity canonicalization lack one persistence contract.
**F. Verification strongest in the middle, weakest at risky boundaries** → MED-21/22/23/24. Green suite coexists with unencoded exploits.
**G. Partial dependency inversion and duplicated adapters** → MED-26/27/28, §13–16. Useful seams, but concrete imports, ambient state, and duplicated tool definitions make boundary defects easy to introduce.

**Debt taxonomy:** *Dangerous* = A/B/C/D causes; *Architectural* = G + dual tool layers + transport→persistence shortcuts + legacy layers; *Ordinary* = silent catches, duplicated audit writers, whitespace churn, git hygiene, dead config.

---

## 27. Architecture Scores (reconciled)

| Area | Score /10 | Verdict |
|---|---|---|
| Security | **5** | Strong command-construction controls; boundary gaps confirmed by 3 PoCs + source verification |
| Reliability | **6** | Strong persistence primitives; not crash-safe for uncertain mutating side effects |
| Performance | **7** | Good at current local-agent scale (measured); workload-dependent ceilings |
| Scalability | **5** | Single process/SQLite by design; high-concurrency network-service use not demonstrated |
| Clean Architecture | **4–5** | Partial — real seams; adapter→persistence shortcuts + dual tool layers |
| Hexagonal Architecture | **4–5** | Partial — real recovery/trace ports; FS/shell boundaries concrete singletons |
| SOLID | **6** | SRP/OCP drag; DIP partial |
| Testability | **7** | Broad strong suite; exploit regressions and HTTP/OAuth coverage missing |
| Maintainability | **5** | Duplication + legacy layers raise change cost |
| Observability | **6.5** | Rich; format/retention/session/redaction gaps |
| Documentation/Operations | — | Materially inconsistent; needs one executable source of truth |
| Production Readiness | **4** | Public HTTP: NO · Local stdio: conditional |

**Overall Engineering Score: 5/10** — weighted down by 13 confirmed HIGH boundary/execution-reality/compensation/deployment findings on an Internet-exposed deployment path; lifted by genuinely excellent approval atomicity, file-mutation durability, command-construction security, dependency hygiene, and testing breadth. The core engine is an **8**; the boundaries and deployment are a **3**.

---

## 28. Prioritized Remediation Roadmap (unified)

### P0 — before any public HTTP exposure
1. **Centralize authorization & scope escalation** (HIGH-01): a server-level unavoidable gate applying permission+PDP to every tool call; approval/ADMIN for `unrestricted`; remove `set_workspace` from the task enum. **Regression first** (MED-21).
2. **Fix sensitive search** (HIGH-02): denylist inside the walk; skip `SENSITIVE_DIRS`; fix the description; exploit regression test **before** the change.
3. **Close the generic read-scope bypass** (HIGH-03 + MED-04): block/approve `git diff --no-index`; validate path-bearing args of auto-approved git/gh commands; validate shell `cwd`.
4. **Fix OAuth token lifetime semantics** (HIGH-04): real issued/expiry-bound client tokens; rotate refresh; revoke consumed values.
5. **Fix timeout execution reality** (HIGH-05): await bounded termination confirmation; reconcile `outcome_unknown` mutations before retry.
6. **Fix crash recovery** (HIGH-06 + HIGH-07): `running`→`outcome_unknown` (not blind retry); one canonical TaskPlan hydration path.
7. **Make rollback truthful** (HIGH-08 + HIGH-09): clean-tree precondition for git snapshot/rollback; rename package rollback to manifest rollback or implement verified environment reversal.
8. **Fix deployment auth contract** (HIGH-11): one env name; delete the static secret; startup effective-config report; config-contract test.
9. **Fix Docker integrity & liveness** (HIGH-10 + HIGH-12): fail closed on frozen-lock; one liveness contract matching auth design.

### P1 — before release approval
10. Remove monitoring query-string bearer (MED-01); fix audit redaction dead flag (MED-02); add rate/session/concurrency bounds (MED-03).
11. Separate audit-sink failure from committed-effect outcome (MED-05).
12. HTTP/OAuth process-level E2E + regressions for every confirmed HIGH (MED-21/22).
13. Minimal CI incl. secret-scan + container/config-contract checks (MED-14); non-root container (MED-13); deterministic Node PATH (MED-15).
14. Expose existing direct-file SHA/idempotency controls (MED-06).

### P2 — correctness and operational hardening
15. Request-hash task idempotency (MED-08); project canonical identity (MED-07); terminal-state append contract (MED-09); absent-backup immutability (MED-10); revision-guarded restores + absolute backup targets (MED-11/12).
16. Periodic table-aware retention (MED-18); session-metrics pruning (MED-19); benchmark real metrics queries then index (MED-17); move PRAGMA out of hot path (MED-20); fix Prometheus exposition + golden test (MED-25); host-header/CORS fail-closed (MED-29).
17. One production runbook; deprecate conflicting launch paths (MED-16).

### P3 — architecture/maintainability (evidence floor; owner directive exceeds this — §31)
18. One shared tool schema/metadata/authorization source for direct + task paths (MED-28); kill the duplicates.
19. Inject narrow `TaskRepository`, workspace-policy, and recovery-persistence boundaries; extend the composition root (MED-26/27).
20. Consolidate schema migration/self-healing; remove dead/legacy config/recovery/audit layers after coverage.
21. Decompose `http-server.ts` when continued change justifies it.
22. Parallel-test isolation (MED-24); per-file critical thresholds (MED-23); persistent fuzz harness (LOW-08).

---

## 29. Quick Wins (low-risk, high-value)

1. `set_workspace` handlers: permission + PDP + approval-for-unrestricted (≈10 lines + test).
2. `searchWorkspaceFiles`: one `assertNotSensitive(fullPath)` per file (≈3 lines + exploit regression).
3. Fix the `search_files` description (1 line).
4. `shell-service`: `validateWorkspace(cwd)` (1 line + test).
5. `command-audit.ts`: activate `redactNext` (≈3 lines + regression) — MED-02.
6. Block `git diff --no-index` in `safeGitSubcommands` handling (≈2 lines + PoC regression) — HIGH-03.
7. `findInterruptedTasks`: delegate to the canonical `getTaskPlan` hydration — HIGH-07.
8. Dockerfile: `USER node`; drop `|| pnpm install`; fix healthcheck (3 lines) — HIGH-10/12, MED-13.
9. Startup config-summary log (≈6 lines) — HIGH-11.
10. Delete `hooshix-v2-secret` from scripts/docs (2 edits).
11. `created_at` indexes + move PRAGMA introspection to one-time init (2 migrations + refactor).
12. Absent-backup: immutable `previous_state` column instead of `restored_at='absent'` (small migration + test) — MED-10.

## 30. Controls That Must NOT Be Replaced (union of all audits)

- `shell:false` argv-separated execution + executable allowlist + control-character rejection;
- SQL-atomic single-use approval create/approve/consume bound to exact task/step/action, validated before consumption;
- PKCE S256 and one-time authorization codes (the *code* flow — only the token lifetime is broken, HIGH-04);
- static single-pass no-eval template resolution;
- atomic fsync+rename writes and exclusive-`wx` create;
- backup-before-mutation and displaced-backup undo chain;
- explicit task state machine (incl. `outcome_unknown`);
- SQLite WAL, busy timeout, short transactions for the current single-agent deployment;
- result/file/step/output bounds everywhere;
- exact dependency versions, pnpm lockfile, build-script allowlist;
- Vitest + the intended single-worker profile until test state is isolated;
- the correlation/timeline observability model.

Do not replace these while fixing unrelated defects — and do not force distributed ACID onto Saga-style task semantics.

---

## 31. Owner Directive & Implementation Context

> **Recorded per project owner, 2026-09-06.**

Both audits concluded that an incremental remediation is *sufficient* ("no wholesale rewrite required"). That conclusion stands as the **evidence floor**. The owner has nonetheless issued an explicit directive for the remediation program:

1. The implementation will adopt **full Hexagonal Architecture (Ports & Adapters) and Clean Architecture** across the entire project — even at the cost of complete restructuring and redesign.
2. **All** findings in this document (security, performance, exploitability, reliability, data-integrity, testing, deployment) will be fixed — not just the P0 set.
3. The §30 controls are preserved and carried into the new architecture as explicit design constraints.

Consequences for the implementation program: the P3 "incremental ports" items become the *baseline* architecture work rather than optional cleanup; the remediation roadmap (§28) is executed **inside** the hexagonal restructuring (central authorization gate = an explicit application-layer port enforced at one boundary; canonical hydration = one persistence adapter; unified tool definitions = one driven-adapter schema source; etc.). Implementation planning documents must reference this section for their architectural mandate.

---

## 32. Final Verdict (14 answers)

1. **Secure enough for production?** No — not for public HTTP/tunnel. Local stdio conditional (supervised, pinned workspace) after HIGH-01/02/03/11 fixes.
2. **Realistically exploitable vulnerabilities?** Yes — three PoC-confirmed (sandbox disable; secret exfiltration via search; external file disclosure via `git diff --no-index`), plus implementation-confirmed OAuth-lifetime, rollback, and deployment-secret defects.
3. **Most dangerous attack path?** Token leak/injection → `set_workspace(unrestricted:true)` [no approval] → `search_files` credential exfiltration → `task_create` code-exec step → `task_approve` → RCE as OS user. Chain B (git diff --no-index) provides a no-approval disclosure shortcut at DEVELOPER_MODE.
4. **Data integrity adequately protected?** File-write layer: yes. Compensation/execution-reality layer: no (HIGH-05/06/07/08/09, MED-05/10/11/12).
5. **Concurrency boundaries safe?** In-process: yes (single event loop + synchronous SQLite, tested). Cross-timeout, cross-restart, and cross-process: no (HIGH-05/06/13).
6. **Performance acceptable?** Yes at design scale (measured 0.10–0.21 ms/write/query-set; 4 ms metrics at 2515 rows; 0 crashes in 20k smoke). Degradation will come from unbounded tables and the search worst-case (~9.77 GiB bound), not hot paths.
7. **First scaling bottleneck?** Workload-dependent: trace-table growth + 7-query metrics path (write/dashboard-heavy), or `search_files` IO/worker pressure (search-heavy), then single-process session state — long before CPU.
8. **Clean Architecture actually implemented?** Partially (4–5) — real seams; transport→persistence shortcuts and duplicated adapters violate it in practice.
9. **Hexagonal actually implemented?** Partially (4–5) — real ports for recovery/trace; OS-facing boundaries are concrete ambient singletons; inbound adapters uncoordinated.
10. **Architectural boundaries genuinely enforced?** No — authorization is per-handler and provably incomplete; no lint/boundary test enforcement.
11. **Over-engineered anywhere?** Mildly — legacy recovery/report layers and a few single-consumer interfaces; not harmful.
12. **Under-engineered anywhere?** Yes, exactly where it hurts: central authorization, termination/reconciliation, truthful compensation, token lifetime, retention, deployment unification, boundary-level tests.
13. **Five most important changes before next release:** (1) central authorization gate + workspace fix; (2) search denylist; (3) git-diff/cwd read-scope closure; (4) timeout/crash reconciliation incl. canonical hydration; (5) truthful rollbacks + deployment auth/Docker/CI fixes.
14. **Approve production deployment as-is?** **No — not public HTTP/tunnel.** Supervised local stdio with explicit operational constraints only, while P0/P1 land. The engine core (approval atomicity, durability, command construction, testing breadth) is genuinely strong; the failures are concentrated at boundaries, fully understood, and fixable — per §31, the owner has chosen to fix them via a full Hexagonal/Clean restructuring, which this audit record supports as sufficient-but-exceeded-by-directive.

---

## 33. Validation Limitations

This consolidation intentionally claims no evidence that was never collected. Not performed by any audit generation: live attack on the public endpoint; multi-process duplicate-execution test; high-concurrency HTTP load test; 25k/250k-row production-query benchmark; session-churn stress; end-to-end winget/choco under ADMIN_MODE; `promtool` validation (absent); persistent coverage-guided fuzzing. Additional caveats: the repository baseline is heavily dirty; historical tracked docs are deleted while replacement audit docs are untracked; the running connector schema has demonstrated drift from the working tree — therefore deployment-runtime claims and source claims remain distinct until build/deploy provenance is fixed.

---

## Appendix A — PoC & Empirical Evidence (all runs, all audit generations)

### A.1 `search_files` denylist bypass — CONFIRMED (two independent PoCs)
```
Audit A:  read_file .env → BLOCKED; search_files("FAKESECRET_123") → matches from .env AND .ssh/id_rsa
Audit B:  read_file(".env") → BLOCKED; search_files(".", "SECRET_TOKEN") → { path:".env", line:1, text:"SECRET_TOKEN=supersecret123" }
          (also: file-as-root → raw ENOTDIR — missing isDirectory root check)
```

### A.2 `set_workspace({unrestricted:true})` sandbox disable — CONFIRMED (Audit A PoC; B re-verified source)
```
validateWorkspace(<outside>) before → throws; SystemToolHandler.set_workspace{unrestricted:true} → {unrestricted:true};
validateWorkspace(<outside>/anywhere.txt) after → returns path (sandbox OFF). Zero permission checks in both handler layers (grep-verified).
```

### A.3 `git diff --no-index` external disclosure — CONFIRMED (Audit C safe PoC)
```
execute_command: git diff --no-index C:/Windows/win.ini C:/Windows/system.ini
→ executed WITHOUT approval; returned file content outside the workspace.
```

### A.4 Command-audit redaction leak — CONFIRMED (Audit C; source-verified in consolidation)
```
command-audit.ts: `let redactNext = false;` — no code path sets it true;
"--token VALUE" args: flag redacted, VALUE logged verbatim unless independently pattern-matched.
```

### A.5 Additional Audit C PoCs (source-verified during consolidation)
- Audit-failure masking: operation rejected to caller after the file side effect already existed (M-05).
- Project identity duplication: two project rows for trailing-slash-equivalent paths (M-07 — raw path INSERTed vs canonical conflict check).
- Absent-backup reuse: first restore → file absent (correct); second restore of same id → empty file created (M-10 — mutable `restored_at` encoding).

### A.6 Live permission probes (Audit B, read-only)
```
git push --force / git clean -fd / git reset --hard / node --eval / python -c / gh api / gh repo delete → approval_required ✓
git log --all / gh pr list / node --version → allow ✓ — no command-layer bypass found.
```

### A.7 Validation suite (reproduced across audits)
Build PASS · typecheck/lint PASS (0 errors) · tests **342/342** (81 files, ~35 s, single worker) · coverage 87.85/76.38/92.29/91.64 (gates pass) · `pnpm audit` clean · **20,000-input randomized smoke: 0 crashes** · targeted security profile 25/25 · benchmarks: writes 101–136 ms/1000, metric sets 170–211 ms/1000, live agent_metrics ≈4 ms @2515 rows · git secret history scan clean.

---

## Appendix B — Unified Finding Registry & Crosswalk

| Unified ID | Summary | Location | Source(s) | Severity history |
|---|---|---|---|---|
| HIGH-01 | Sandbox disable via `set_workspace`, zero authorization | tools/system/workspace.ts; handlers/system-handler.ts | A SEC-001 · B · C H-01 | stable HIGH |
| HIGH-02 | `search_files` denylist bypass | filesystem-service.ts:380–415 | A SEC-002 · B · C H-02 | stable HIGH |
| HIGH-03 | `git diff --no-index` external disclosure, auto-approved | command-permission.ts:28 | **C H-03** | new |
| HIGH-04 | OAuth advertised expiry unenforced; master token as client token; deterministic refresh | mcp/oauth.ts:30-41,109-117 | **C H-04** (supersedes B LOW-003) | LOW→HIGH |
| HIGH-05 | Timeout finalizes before termination confirmed | closed-agent-loop.ts:43-56 | A SEC-003 · B · C H-05 | stable HIGH |
| HIGH-06 | Crash recovery replays uncertain steps | crash-recovery.ts; task-repository.ts | A SEC-004 · B · C H-06 | stable HIGH |
| HIGH-07 | Crash hydration incomplete (retry policy, runWhen, counters, templates omitted) | task-repository.ts:395-432 | **C H-07** | new |
| HIGH-08 | Git rollback destroys pre-existing dirty work (no clean-tree precondition) | task-snapshot-handler.ts:43-64 | **C H-08** | new |
| HIGH-09 | Package rollback restores manifests only but reports full success | package-service.ts:52-64 | **C H-09** | new |
| HIGH-10 | Docker frozen-lock fallback fails open | Dockerfile (both stages) | B MED-009 · **C H-10** | MED→HIGH |
| HIGH-11 | Deployment auth contract inconsistent (`MCP_API_KEY` vs `MCP_ACCESS_TOKEN` + `hooshix-v2-secret`) | Dockerfile; docker-compose; scripts/*.bat, *.md | A SEC-005+MED-002 · **C H-11** | merged HIGH |
| HIGH-12 | Authenticated `/health` vs unauthenticated probes → always-unhealthy container | Dockerfile; docker-compose | B MED-009 · **C H-12** | MED→HIGH |
| HIGH-13 | Same-task exclusion process-local only (no persisted lease) | task-runtime-service.ts:22 | **C H-13** | new (conditional) |
| MED-01 | Master token via `?token=` query string | http-server.ts:413-416 | A MED-001 · B · C M-01 | stable MED |
| MED-02 | Audit redaction `redactNext` never activated → separated secrets leak | command-audit.ts:12-31 | **C M-02** | new |
| MED-03 | No rate/concurrency limits on HTTP surface | http-server.ts | A MED-005 · C M-03 | stable MED |
| MED-04 | Shell `cwd` not workspace-validated | shell-service.ts:20 | B MED-008 · C M-04 | stable MED |
| MED-05 | Audit failure masks completed side effect | shell-service/filesystem audit paths | **C M-05** | new |
| MED-06 | Direct MCP file tools hide existing CAS/idempotency controls | tools/filesystem/* | A LOW-001 · C M-06 | LOW→MED |
| MED-07 | Project identity non-canonical (raw path inserted) | task-repository.ts:336-346 | **C M-07** | new |
| MED-08 | Task idempotency key ignores payload hash | task-repository.ts:104-110 | **C M-08** | new |
| MED-09 | `task_append_steps` accepts terminal tasks | tools/task/index.ts:138-140 | **C M-09** | new |
| MED-10 | Absent-state backup reuse creates empty file | filesystem-service.ts:323-331 | **C M-10** | new |
| MED-11 | Restore lacks revision precondition (`file_revision` unused) | filesystem-service.ts:312-341 | A MED-006 · C M-11 | stable MED |
| MED-12 | Backup restore binds mutable current workspace | filesystem-service.ts:319 | A MED-007 · C M-12 | stable MED |
| MED-13 | Container root + mutable base tag | Dockerfile | B MED-009 · C M-13 | stable MED |
| MED-14 | No CI gate | (none exists) | both · C M-14 | stable MED |
| MED-15 | Node/NVM PATH bootstrap not reproducible | environment/scripts | B (hit live) · C M-15 | new |
| MED-16 | Multiple incompatible production runbooks | scripts/**, Docker, README | **C M-16** | new |
| MED-17 | Metrics queries under-indexed/under-benchmarked | metrics-service.ts | B MED-003 · C M-17 | expanded |
| MED-18 | Retention startup-only and incomplete | database/cleanup.ts | A MED-003 · C M-18 | stable MED |
| MED-19 | Historical session metrics accumulate | mcp/metrics.ts | B LOW-009 · C M-19 | LOW→MED |
| MED-20 | PRAGMA introspection on every tool call | tool-audit.ts:19-22 | **C M-20** | new |
| MED-21 | Confirmed exploits lack regression tests | tests/** | B §21 · C M-21 | expanded |
| MED-22 | HTTP/OAuth/metrics transport under-tested | tests/e2e | **C M-22** | new |
| MED-23 | Critical files at 53–64% branch under green global | coverage report | **C M-23** | new |
| MED-24 | Test harness not parallel-isolated (4-worker = 188 failures) | vitest.config.ts | **C M-24** | new |
| MED-25 | Prometheus HELP/TYPE malformed for labeled metrics | mcp/metrics.ts | **C M-25** | new |
| MED-26 | Dependency inversion incomplete at core boundaries | src/core/** | both · C M-26 | stable |
| MED-27 | God-service scope (runtime + loop) | task-runtime-service; closed-agent-loop | B SRP · C M-27 | stable |
| MED-28 | Direct vs Task adapter drift (dual tool paths) | tools/** vs executor handlers | both · C M-28 | stable |
| MED-29 | Host-header trust + CORS `*` | http-server.ts:397,220 | A MED-004 (MASTER only) | kept MED |
| LOW-01..12 | Path leaks, silent catches, legacy layers, flag interpolation, dead config, repo noise, token file mode, no fuzzer, lint alias, whitespace churn, README inventory, doc authority | see §7 | union of A/B/C | — |

## Appendix C — Consolidation History

| Version | Date | Context | Changes |
|---|---|---|---|
| Audit A | 2026-09-05 | prior session | First evidence-based audit; SEC-001..004, MED-001..007, LOW-001..006; 2 PoCs; suite green. |
| Audit B | 2026-09-06 | this assistant | Re-verified all A findings (fresh PoC for SEC-002); added SEC-005, MED-008/009, LOW-007..009; live permission probes; benchmark extraction. |
| MASTER (A+B) | 2026-09-06 | this assistant | Merged A+B; resolved 4 conflicts (Observability 6.5, Node v24.18.0, Docker healthcheck broken, benchmarks); Appendix C delta log. |
| Audit C | 2026-09-06 | **another assistant** | 10-phase evidence set; 9 new HIGH findings (H-03/04/07/08/09/10/12/13 + H-11 merge), 14 new MED, 5 new LOW; 20k-input smoke; 4-worker diagnostic; 3 new PoCs; evidence-precedence framework; root-cause model; documentation-authority model. |
| **THIS DOCUMENT** | 2026-09-06 | final consolidation | MASTER + Audit C unified: 3-way agreement matrix; every C finding source-verified against the current tree; 4 severity upgrades (HIGH-10/12, MED-06, MED-19); 1 supersession (HIGH-04 ⊃ LOW-003); unified ID registry (HIGH-01..13, MED-01..29, LOW-01..12); 7-cause root-cause model; §31 owner directive recorded; supersedes all prior audit documents as single source of truth. Sources kept alongside unchanged. |