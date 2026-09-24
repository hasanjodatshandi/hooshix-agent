# HooshiX Security Model

This document is a companion to the executable security suite under `tests/security/`. If this document and those tests disagree, **the tests are correct**.

## Workspace authorization — empty pool by default

`src/security/workspace-guard.ts` implements a deny-by-default model:

- The allowed-roots pool starts **empty**; there is no implicit root and no implicit active workspace. Access exists only after explicit configuration.
- `add_workspace_roots` — roots must exist, are realpath-resolved, idempotent. The first root auto-activates only when the pool was empty. This and `remove_workspace_root` must always run through a governed task step — `HOOSHIX_DIRECT_AUTO_APPROVE` cannot bypass them.
- `set_active_workspace` **selects only** among already-allowed roots; it never mutates the pool, so switching grants no accumulated permission.
- `remove_workspace_root` cannot remove the active workspace; removal immediately invalidates session selections.
- `HOOSHIX_WORKSPACE` is a bootstrap seed of candidate roots and **must not select active state**.
- With no active workspace, every path is outside — file tools fail closed.
- Restricted mode scopes file tools to the **active** root only; other configured roots are not implicitly accessible (least privilege).
- `HOOSHIX_UNRESTRICTED` is a server **allow ceiling**, never an implicit grant.

## Unrestricted scope — single effect

Process-wide elevation is disabled: `assertUnrestrictedElevationAllowed()` always throws. The only producer of unrestricted authority is `runWithApprovedUnrestrictedScope`, an `AsyncLocalStorage` entered by the gateway for the duration of one handler body after a persisted exact-action approval is claimed. The `unrestrictedMode` global survives only as a test fixture — no production entrypoint or tool reaches it.

## Sensitive-path policy

`src/application/services/sensitive-path-policy.ts` denies read, search, traversal and mutation of:

- Basenames: `.token`, `.env` / `.env.*`, `id_rsa`, `id_ecdsa`, `id_ed25519`, `id_dsa`, `.npmrc`, `.pypirc`, `.netrc`, `.htpasswd`, `credentials.json`, `secrets.{json,yaml,yml}`
- Extensions: `.pem .key .pfx .p12 .kdbx`
- Directories: `.ssh .gnupg .aws .azure`

## Credentials — bootstrap vs OAuth

- **Bootstrap/operator secret** (`HOOSHIX_BOOTSTRAP_TOKEN` or a token file) is an operator-only credential. It is **never accepted as an MCP bearer**. It must be ≥32 UTF-8 bytes, a regular file (never a symlink), mode `0600` on POSIX, and written with exclusive `wx` creation when generated. Deprecated `MCP_ACCESS_TOKEN` / `MCP_API_KEY` are hard-rejected with an explicit migration error.
- **OAuth tokens** are separate: Bearer shape `/^Bearer [a-zA-Z0-9._~-]{32,300}$/`, constant-time compare, `hx_`/`hxr_`-prefixed 32-byte tokens, atomic refresh rotation with replay detection.

## Child-process environment

A shell command is untrusted code, so it receives an **allowlist**, not the parent environment. `buildChildProcessEnvironment()` in `app-config.ts` passes only `PATH PATHEXT SystemRoot WINDIR COMSPEC PSModulePath LANG LC_ALL TZ HOME USERPROFILE TEMP TMP`. `executeShellCommand` sets `extendEnv: false` — without that, execa would extend `process.env` and the allowlist would be inert. Every `HOOSHIX_*` value (bootstrap token, OAuth client secret, DB and log paths) is withheld by omission. Proven by `tests/security/r4-child-env-excludes-secrets.test.ts`.

## Backup-before-mutation and guarded restore

Every file mutator persists a backup (id, canonical path, content, sha256) **before** the write, then records its postcondition. Restore (`restoreWorkspaceFile`) re-runs the policy decision, refuses non-canonical stored targets, requires the classified `previous_state` and a verified sha256, compares live state against both the previous and post-mutation revisions (`RESTORE_REVISION_CONFLICT` on drift), is idempotent, and re-backs-up the displaced bytes. Verified by `tests/core/r4-revision-guarded-restore.test.ts` and `r4-file-backup-schema.test.ts`.

## Audit and redaction

Command and file actions are written as JSONL under `HOOSHIX_LOG_DIR`. Secret-bearing arguments (`--token VALUE`, `--flag=value`) and opaque values (`-e`, `-H`, `--data`) are masked; serialized environments are replaced with `[REDACTED]`. `tests/security/r6-audit-redaction-telemetry.test.ts` asserts raw values never appear.
