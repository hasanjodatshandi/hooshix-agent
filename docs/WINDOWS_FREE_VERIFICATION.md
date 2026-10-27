# HooshiX Windows Free Edition — verification evidence

**Edition:** free, Apache License 2.0. **Release state:** candidate only; no merge, public publication, production installation, payment or licensing checks authorized by this document.

## Capability inventory

The MCP v2 transport exposes **58 registered tools**, independently asserted by `tests/e2e/real-mcp-process.test.ts`. A source scan found references to each of the 58 names in the test suite; **name references are not proof of 58 end-to-end functional successes**. Evidence is separated below.

| Area | Windows direct evidence | Automated / isolated evidence | Outstanding limitations |
| --- | --- | --- | --- |
| Filesystem | Read, list, search, create, write with SHA precondition, modify and restore succeeded in a disposable `build/` folder; stale writes and out-of-root paths rejected | Full MCP in-process file lifecycle, approved delete and restore | Do not run destructive tests on customer data |
| Git | Approved `git_init`, `git_add`, staged diff and `git_commit` succeeded in a disposable Git repository; Git status/log clean afterwards | In-process approve/branch/checkout/commit/snapshot/rollback contracts | Clone against a real remote is deliberately not part of the live host smoke |
| Execution | Read-only `node --version` and status diagnostics succeeded | Shell timeout/command fencing and scoped execution tests | Unrestricted `exec` must remain an explicit operator opt-in |
| Tasks and approval | Approval IDs 42–44 consumed exactly once; all four fixture Task steps completed | Task lifecycle, replay, reconcile, idempotency, leases, cancellation and permission tests | Do not bypass approval for real project mutation |
| Project / memory | Read-only list endpoints and dry-run authorization policy returned valid responses | MCP tool fixture tests create, update, list, archive and delete disposable records | Existing historical WSL project *records* are user data and must not be silently erased |
| Windows operator UI | HTTP service live and authenticated settings gate tested in Sandbox | Page escaping and Windows Git readiness tests | Full first-time customer sign-in and user usability on a clean physical Windows installation remain to be validated |
| Windows installer | Fresh RC2 install, busy-worker fail-closed, Windows-only upgrade, explicit rollback, repair and uninstall passed in disposable Windows Sandbox | Recovery snapshot and tamper-rejection tests | Automatic failure injection after SCM stop also passed in a second fresh Sandbox; validate additional failure variants before broad rollout |

## Automated evidence

- Before the transitive security-dependency repair, the complete Vitest suite completed successfully: **237 test files, 1,161 tests**.
- After the dependency repair, a focused rerun passed **5 test files, 40 tests**, including real MCP listing, in-process filesystem/Git/task operations and Windows UI/installer tests.
- The Windows-only installer regression suite, Go Windows packages and static/release CI checks passed on the preceding candidate commit.
- The patched `pnpm-workspace.yaml` pins Hono to a version no older than `4.13.11`, and frozen install must match that version. `pnpm audit --prod --audit-level=moderate` must report no vulnerabilities.
- `package.json` must declare `Apache-2.0`, and the installer must include `app/LICENSE`. `scripts/audit-windows-only-release.mjs` enforces the source and package consistency.
- GitHub CI for customer-onboarding commit `8b8755382d4d3872395608432f35bdbc4bbce643` completed successfully in all three jobs (Windows-native, container-smoke, code-and-security): https://github.com/hasanjodatshandi/hooshix-agent/actions/runs/40167947111. **Re-run CI on every later code change** before any release.

## Database rehearsal and sensitive-data hygiene (2026-10-25)

The repository's representative `data/agent-memory.db` was opened **read-only**, and SQLite's online-backup API created two disposable copies. All migration, foreign-key and backup/restore checks passed on those copies: `integrity_check=ok` before and after; `foreign_key_check=0`; **1,198 Task records** preserved; **10 saved Workspace roots**; latest schema **29**; restored copy reopened successfully.

**Historical migration verified:** a separate read-only inspection confirmed the source database was at **schema 25**, while the migrated online copy and independently restored copy reached **schema 29**. This is an actual **25 → 29** migration of a representative database copy, preserving all 1,198 Task records and 10 approved roots. It is not a claim that the old executable was used to run the migrated database, nor that future migrations have been tested.

A security hygiene issue was discovered: the original script left sensitive `.db` backup files and SQLite `-wal`/`-shm` sidecars in ignored `data/release-validation/`. The artifacts from the first trial were removed. The script now closes all SQLite handles and automatically deletes its exact two backup files and sidecars after success or failure. Two executable regression cases cover normal and failed rehearsal cleanup. The representative rehearsal was repeated after the fix and reported `sensitiveArtifactsRemoved=true` and `remainingCount=0` while the running production Windows service stayed healthy.

## TLS-terminated MCP/OAuth customer-path rehearsal (2026-10-25)

`tests/e2e/windows-customer-https-oauth.test.ts` launches the **actual HooshiX HTTP MCP server** with disposable data and a random operator bootstrap secret, fronted by an **ephemeral HTTPS reverse proxy bound only to 127.0.0.1**. OpenSSL generates a 1-day test certificate in the disposable fixture directory. The test trusts only this certificate in its test process; it retains normal TLS certificate/hostname verification and never disables it.

An MCP SDK client then reaches the service **through HTTPS** and completes: OAuth protected-resource/issuer discovery, dynamic client registration, PKCE authorization-code grant with explicit read-only consent, token exchange, protocol negotiation, tool listing (58 tools), `get_system_info`, and denial of `create_file` without write scope. It rejects an unrelated Origin and prevents using the privileged bootstrap token as an MCP bearer. The reverse proxy, temporary certificate/key, fixture SQLite and process are removed after the test. Together with the existing real HTTP OAuth/Task lifecycle suites, **4 targeted test files / 5 tests passed**.

**Not tested:** public DNS propagation, commercial tunnel/reverse-proxy providers, third-party TLS certificate issuance, actual ChatGPT custom-connector setup and interactive consent on a fresh customer's device, customer firewall/proxy conditions. None of those can be inferred from a loopback simulation. These remain mandatory **manual release gates**. The test uses a real TLS stack but does not expose a listening public service.

## Manual Windows Sandbox evidence

The user supplied Windows Sandbox transcripts confirming:

1. Install of official RC2 -> SCM Running / HTTP 200.
2. Busy Git worker refuses unsafe upgrade, existing service remains healthy.
3. Windows-only upgrade -> Running / HTTP 200; protected settings authorization.
4. Explicit rollback restores prior version.
5. Re-upgrade, repair and uninstall preserve operator data.
6. Separately induced extraction collision **after SCM stop** yields nonzero setup exit, but automatic rollback restores prior exact service binary hash, SCM account/security/recovery policy, operator settings and sentinel data; service returns Running / HTTP 200.

These tests ran in a disposable Sandbox guest, **not** on the customer's production service. No unreviewed source or installer is authorized to be deployed by a test result.

## Customer public HTTPS/OAuth acceptance update (2026-10-27)

The operator reported successful connection of the Windows Sandbox
installation to ChatGPT via `https://test.hooshix-agent.ir/mcp` after OAuth,
with no recurrence of `Authentication succeeded, action discovery failed`.
This is a **user report**, not an independently captured `tools/list` or
`get_system_info` transcript. It is not a separate physical-Windows customer
test and does not prove every one of the 58 tools works individually. The
Gateway route used separately installed and paired HooshiXAgent software.

The candidate `98dc6151` passed GitHub Actions run 40173714816 (three jobs).
The unsigned Windows-only installer was independently rehashed to
`e5b478183a41b224efcd6d9618e792dd3916e715969209e87de6fcd3a1a92939`.
The running host's existing HooshiXMCP service remained healthy (HTTP 200)
and was not upgraded.

Outstanding: physical Windows customer acceptance, complete independent
security/code review, final-source CI and signed release-artifact provenance,
and owner approval before merging, publishing or production deployment.
Paid Authenticode signing remains intentionally deferred.

## Release decision

**Draft / hold**, pending green final-commit CI, final installer checksum and provenance verification, and first-time customer onboarding checks. Leave the existing running Windows service and `main` branch intact until the owner explicitly chooses deployment, merge or publication. No paid tier and no code-signing work in scope.
