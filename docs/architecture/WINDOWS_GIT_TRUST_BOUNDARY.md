# Windows service Git ownership — product trust contract (2026-10-18)

## Product requirement
HooshiX runs as an always-on Windows service, including before user logon. Workspaces may be owned by a different local user. Git 2.55+ intentionally refuses to read an untrusted cross-owner repository; granting filesystem access or adding a workspace root does **not** by itself make Git trust that repository.

## Current implementation — secure default
- The service does **not** automatically set `safe.directory` when a workspace is opened.
- `open_project` now returns a bounded, read-only `gitReadiness` result for the selected root: `ready`, `untrusted_owner`, `not_repository`, or `unavailable`.
- `gitDiff` performs a guarded `git rev-parse` preflight before diff, preserving the informative `git_ownership_untrusted` diagnostic rather than a false `not_a_git_repository` label.
- Git failures never expose raw stderr, repository owner IDs, secrets or arbitrary local paths to the MCP client.
- Plain file operations remain functional even when Git is absent or the selected directory is not a repository.
- The user explicitly approving a workspace root is **not** automatically equivalent to approving Git to execute that root's Git configuration, filters, hooks or external helpers as the Windows service identity.

## Safe supported deployment choice
1. **Preferred for an individual's interactive repositories:** execute workspace Git operations under that repository owner's own Windows logon token, in an isolated, authenticated user-owned worker. The always-on Windows service remains the protected MCP endpoint and control-plane only. The worker must have an authenticated broker boundary, exact workspace/scope grants, revocation, timeout and fail-closed offline semantics; never inherit service/OAuth secrets.
2. **Headless/service-owned repositories:** create and own the working copy under a dedicated least-privilege Windows service account. The service account should own the repository; no Git trust override is necessary.
3. **Explicit operator-controlled exception:** after review, an administrator may approve an **exact** repository as trusted for a specific service identity. This is a security decision, not something the server silently does. Avoid `safe.directory=*` and do not turn off Git's ownership checks globally.

## Deferred architecture item (NOT implemented by the current patch)
Implement a per-user Git worker with Windows token-aware IPC, user-session lifecycle, process isolation and an explicit operator consent flow. Until that is built, a third-party user with repositories owned by another account will receive an actionable `untrusted_owner` readiness state rather than having HooshiX secretly override Git trust. This distinction is a functional limitation and **not** a completed cross-owner Git execution solution.

## Regression and delivery gates
- Windows-native Git readiness unit tests cover trusted, untrusted, non-Git and Git-absent roots.
- Windows-native CI job exercises project handle isolation, environmental variable propagation, Git trust classification, Go service tests, 100x file publisher race, and assembles/checksums a fresh Windows installer from a clean checkout.
- Release preflight intentionally blocks a dirty or unreviewed source tree. Do not disable the gate.
- The current installed service is not upgraded by building source. Shipping requires signed artifact and operator-approved cutover and rollback.

## Follow-up specification for per-user worker
- Do not impersonate arbitrary users from a high-privilege MCP request.
- Worker's identity must come from authenticated local OS session / explicit user launch; never passwords in command-line flags, environment, logs, MCP messages or Git configuration.
- Named-pipe/IPC endpoint bound by Windows ACL to the authenticated user and service; mutual challenge, audit, scoped delegated authority.
- No implicit fallback to SYSTEM Git execution if the worker is absent.
- Test same-owner, cross-owner, offline user, nested repositories, symbolic links/reparse points, tampered Git config and job cancellation.