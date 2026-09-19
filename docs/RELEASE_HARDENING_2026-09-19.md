# HooshiX Brain — Local release-hardening record (2026-09-19)

## Scope and decision

This record concerns the existing **local Windows Node.js MCP** project at
`D:/workspace/hooshix-agent`, not the separate HooshiX connectivity/tunnel agent.
The functional/Crash-Recovery audit is complete for its agreed scope. This
local release-hardening exercise is **not** the R10 public-production approval
defined in `docs/implementation/27_RELEASE_READINESS_CHECKLIST.md`.
Do not replace that checklist or silently mark any of its 54 findings closed.

**Release decision: NO-GO for merging, tagging, or public deployment at this stage.**
This local hardening pass identified and fixed an ignored source directory and
assembled a dedicated release-candidate branch from local `main` (which was
four commits ahead of `origin/main`). A clean candidate commit and fresh-checkout
reproduction are tracked separately from production-approval gates.

## Current demonstrated behavior

- Workspace allowed roots survive process restart; task-scoped execution
  revalidates the root and does not restore revoked permissions.
- A mutating step interrupted by a real service restart conservatively remains
  `outcome_unknown`. The original command is not blindly replayed.
- `task_reconcile` records externally verified side effects without claiming
  that the interrupted operation itself returned successfully.
- `task_report` distinguishes verified partial effect from unknown operation
  result. The active-root flag uses Windows path identity, not case-sensitive
  string equality.
- The above results do **not** establish multi-worker race correctness,
  high-load behavior or real Linux/macOS support; these were explicitly deferred.

### Two task-lifecycle decisions for this release line

1. **Revoked/missing workspace preflight:** A `task_run` rejected before any
   step executes may retain task state `planning` and step state `pending`.
   The typed `WORKSPACE_CONTEXT_INVALID` returned to the caller is the
   authorization failure; it must not be reported as a successful run. The
   operator may reauthorize the path explicitly and issue a new run.
   Recovery must not fall back to a different global workspace or silently
   authorize the old task path. This is a documented existing preflight
   contract, not a claim that a terminal `blocked` transition was implemented.
2. **Unknown outcome reconciliation:** `failed` task plus
   `outcome_unknown` step is a safe terminal state. `effect_observed`
   means that independently inspected **specific** side effects are present,
   not that the entire original step succeeded. Keep the original unchanged;
   record evidence with `task_reconcile`; create/link an independent
   corrective/follow-up task if additional action is needed. Do not consume
   the old approval again and do not automatically retry the interrupted
   mutation. A future `reconciled` terminal status or tool-result proof would
   require a separate, versioned design and regression tests.

## Repeatable local validation

From the repository root:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm exec vitest run
pnpm run build
pnpm run release:db-rehearsal
pnpm run release:preflight
git diff --check
git status --short
```

The **read-only** `release:preflight` command prints the exact source HEAD,
dirty paths, tool catalog version, Node/pnpm version, and SHA-256 digests of
selected inputs/build artifacts. It exits nonzero on a dirty tree, missing
build, or incompatible runtime. Its `LOCAL_SOURCE_GATES_PASS` status is never
public-production approval. Do not bypass it with `--allow-dirty`.
Run it again in a clean, reviewed checkout of the intended release commit.

`release:db-rehearsal` creates a consistent SQLite **online backup** of
`HOOSHIX_DB_PATH` (default: `data/agent-memory.db`) and runs schema
migrations/integrity checks **only on that copy**. The resulting
`data/release-validation/*.db` contains real, potentially sensitive records,
is excluded from Git, and must be protected, retained only as needed, and
deleted according to the approved local data-retention procedure. Passing
this test does **not** exercise a restoration of the primary live database.

## Deployment and rollback safeguards

- Before any release, review/stage ONLY the intended changeset in an isolated
  branch or clean checkout; preserve all pre-existing uncommitted files.
  Obtain a source commit/immutable tag and record exact package/lockfile,
  runtime and build digests. Do not use `git add .`, `reset --hard`,
  `git clean`, or a blanket `task_rollback` on this working tree.
- Test `pnpm install --frozen-lockfile` from a clean checkout and verify
  runtime Node >=24 and pnpm version exactly matches `packageManager`.
- Before cutover, take a separate approved **recoverable backup** of the
  database via SQLite online backup, store it outside source control with
  restricted access, verify `integrity_check`, and snapshot config/secret
  locations without printing secret values. Preserve the previous binary and
  its compatible configuration. Copy WAL/SHM files alone is **not** a valid
  backup of an active SQLite database.
- Stop/replace **only the identified HooshiX server process**. The hardened
  `start_nodejs_mcp.bat` now refuses to terminate an unknown listener, while
  the watchdog only stops the `Process` object it created. If an unowned
  `index-http.js` process is unhealthy, the watchdog fails closed with
  `operator_required` instead of killing or replacing it. It also does not
  redirect child stderr into an unread pipe. This safety behavior is covered
  by regression tests and PowerShell parser validation.
- On rollout, verify /health with the proper authorization, 53-tool inventory,
  workspace persistence, one read-only task, and the real Task report.
  Ensure no active mutation is force-stopped solely for deployment.
- Rollback to the previous binary is permissible only if the DB/auth schema
  and persisted tasks are backward compatible. If incompatible, pause writes
  and follow a separately approved, verified backup-restore procedure.
  Never overwrite a newer live DB merely to make an old binary start.
- The network-facing HTTP/OAuth/protocol and R10 requirements in the official
  checklist remain separate mandatory gates for any public deployment.

## Gate ledger

| Gate | Current disposition |
|---|---|
| Live crash recovery and path-active flag | Verified in prior controlled tests |
| Compiled MCP and tool reconciliation | Verified in prior controlled tests |
| Build / TypeScript / full unit suite | **PASS — 92 files / 470 tests, typecheck and build PASS** |
| Fresh installation with frozen lockfile | Not established |
| Representative SQLite copy/migration integrity | **PASS — schema 8, integrity ok, zero FK violations** |
| Actual backup **restoration** drill | **PASS locally on an independent restored rehearsal copy; live DB was never replaced** |
| Clean Git source and provenance | Candidate branch assembled; clean commit and checkout verification are separate subsequent gates |
| Watchdog/process ownership for deployment | **PASS safety gate — only watchdog-owned Process objects are terminated; unowned unhealthy servers fail closed for operator review** |
| R10 architecture/security/OAuth/modern MCP gates | Not verified; consult official ledger |
| Public production cutover | **NOT PERFORMED** |

The user explicitly deferred high-load, real multi-process race and real
Linux/macOS testing for the preceding audit. This does not automatically
waive any requirement from a future public-production gate.

## Execution evidence for this iteration

Execution performed on 2026-09-19 (local Windows repository):

- Initial source: branch `main`, HEAD `39a6a76161ba8d4346867843a98a75bfd223f39e`;
  four local commits ahead of upstream, initially 48 dirty/untracked paths.
  The initial preflight correctly returned `NO_GO` for `DIRTY_WORKTREE`.
  Review found that the old `database/` ignore rule hid five required files
  under `src/core/memory/database/`; the ignore rule was narrowed to
  `/database/` and those files were included in the candidate changeset.
  A dedicated `release/hardening-2026-09-19` branch was created without
  pushing, merging, restarting the service, or migrating the live DB.
- Runtime: Node `24.18.0`; installed pnpm `12.4.2` equals
  `packageManager`. Hashes for package/lockfile/migration source and
  built entrypoints were present in the preflight output. These hashes are
  informational until reviewed against an immutable source commit.
- `pnpm run typecheck` => PASS.
- `pnpm exec vitest run` => PASS, 92 files / 470 tests.
- `pnpm run build` => PASS.
- PowerShell parser validation for `scripts/hooshix_nodejs_mcp_watchdog.ps1` => PASS (`WATCHDOG_PARSE_OK`).
- `pnpm audit --prod` => PASS (`No known vulnerabilities found`).
- `git diff --check` => exit code 0; Windows LF/CRLF conversion warnings
  were emitted but no whitespace-error diff was reported.
- `pnpm run release:db-rehearsal` => PASS using a consistent SQLite
  online-backup copy: schema version 8, pre/post integrity `ok`,
  foreign-key violations 0, task count unchanged at 446, two persisted
  roots present **at snapshot time**. A second independent SQLite backup was
  reopened as a restore drill with integrity `ok`, zero FK violations, schema 8
  and 446 tasks. All rehearsal DB/WAL/SHM artifacts were deleted afterward;
  the live DB was never replaced.
- The candidate changeset includes the workspace/recovery/runtime fixes,
  regression tests, the five previously ignored database source files,
  release scripts, documentation, and `.gitignore` correction. Only explicit
  reviewed paths were staged; ignored local runtime data and pnpm backup
  artifacts remain outside the candidate.

**Local readiness and production approval are distinct.** A clean candidate
commit, reproducible fresh-checkout build, and frozen install establish local
source readiness, not permission to merge, tag, or deploy publicly. The local
DB migration/restore rehearsal and startup ownership safety checks passed.
The official R10 HTTP/OAuth/protocol/security gates and the owner's deployment
authorization remain independent requirements.
