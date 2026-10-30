# HooshiX MCP — Windows Free Edition

Engineering case study: a self-hosted remote Model Context Protocol server that a
non-technical Windows user can install with one file, and that an AI assistant
cannot use to roam outside the project folders it was given.

Stack: TypeScript (Node.js 24.18 pinned), Go 1.27 for the Windows host, installer
and tray, SQLite for durable task state, MCP over Streamable HTTP with the
2026-07-28 revision, OAuth 2.1 + PKCE. Scale: 228 commits, ~18,500 lines of
application code in 240 modules, 250 test files, 60 Go files.

## Problem

A ChatGPT custom-MCP connector gives one HTTPS endpoint to many conversations.
The 2026 MCP revision carries no per-chat identifier, so a server that trusts the
connection cannot tell two chats apart — and a laptop-grade Windows install has no
platform session isolation to lean on either. Meanwhile the assistant can edit
files, run commands and drive Git. The product requirement is therefore not
"restrict the model" but "make every capability carry the scope that authorized
it".

## Architecture

```
ChatGPT ── HTTPS/OAuth2.1+PKCE ──► public origin (Caddy on a VPS)
                                       │  device tunnel, endpoint id → local port
                                       ▼
                             Windows SCM service (Go host, service account)
                                       │  child env = settings.env + OS allowlist
                                       ▼
                        Node.js MCP server (tool registry, policy, executor)
                                       │
                          SQLite (tasks, approvals, receipts, OAuth state)
```

The Go host is deliberately dumb: it supervises the Node child (backoff ramp
`1s → 2s → 5s → 10s → 30s`, reset after a stable minute), kills it through a
Windows job object so an abrupt host death cannot leave an unmanaged listener on
the port, probes `/health/live` and `/health/ready`, and publishes an atomically
rewritten status document. It never terminates a process it did not spawn.

## Security model

Five independent gates, each with its own failure mode:

1. **Authentication and scope.** Public traffic must present a token bound to a
   principal whose scopes are narrower than the operator's (`principal_scope_insufficient`
   is a normal outcome for a read-only chat client). Authorization codes and refresh
   tokens are single-use: replay is rejected, and rotation is tracked per family.
2. **Workspace pool.** File, search, Git and exec tools resolve paths against an
   allowed-root pool. Symlink and junction escapes are rejected after `realpath`.
   Changing the pool is itself a governed, approval-gated operation.
3. **Per-conversation handles.** `open_project` mints an opaque `ph_…` handle that
   lives only in one chat's model context; workspace-bound calls must echo it. The
   server holds no mutable "active project", so interleaving two conversations in
   one connection cannot leak scope, and a handle is never reusable by another
   credential (a foreign handle is indistinguishable from a forged one).
4. **Approval-governed mutation.** Destructive or code-executing tools require a
   verified, approved task step. `HOOSHIX_DIRECT_AUTO_APPROVE` lifts only the
   approvals a permission level implies; tools pinned to `approval: "always"` still
   refuse a direct call. Command execution is additionally behind an opt-in flag.
5. **Failure hygiene.** Errors reaching a client are closed-set labels, never raw
   messages or file contents; audit records classify failures (`resource_not_found`,
   `security_policy`, …) and redact secret-shaped arguments.

Two revocation properties were proved the hard way: removing a root now revokes the
handles minted under it at resolve time rather than at TTL, and a task's plan
persists the workspace root it was approved for, so a later pool change cannot
silently widen a running task.

## Delivery engineering

- One offline, self-extracting installer (65,814,896 bytes with its own uninstaller
  head) carrying the pinned Node runtime, application and Go binaries; a truncated
  download fails hash and leaves the machine untouched.
- Refuses to bind over a listener it did not create, refuses an existing settings
  document that points outside the packaged runtime, and refuses service arguments
  that a future upgrade could not recognize — the upgrade guard validates before
  the service is stopped, with a staged rollback and a previous-program snapshot.
- The machine-wide settings document sits beside the program. The host prefers it
  there and falls back to the data root, so an un-migrated install keeps working;
  the installer migrates a legacy document instead of dropping it, and the ACL on
  it is explicit (system and administrators full, the operator's account modify).
- A tray icon that refuses to over-claim: green requires both the SCM answer and a
  fresh `phase: running` + `state: ready`, and a stale status document is treated as
  unknown rather than healthy.

## Validation

| Property | Evidence |
|---|---|
| Tool surface and least privilege | 58 tools discovered by a brand-new OAuth client; a read-only token completed discovery and reads, and was refused on a destructive call |
| OAuth abuse resistance | authorization-code replay 400, refresh-token replay 400, unauthenticated 401 with resource-metadata challenge, expired token 401 |
| Chat scoping | multi-root server denies untargeted calls with guidance; a handle cannot read outside its project by relative or absolute path; handles are per-credential, revocable and absolutely expiring |
| Isolation modes | `SHADOW` audited without breaking live work; `PER_CONNECTION` enforced per connection with 403 `context_denied` for cross-context requests |
| Exec and auto-approve gates | positive control with both flags switched on still refused approval-pinned tools |
| Installer behaviour | clean Windows Sandbox install lands settings in the install folder, keeps the data root free of settings documents, exits 0 and reaches readiness |
| Continuous enforcement | CI gates the code-and-security, native Windows and container jobs with per-file coverage floors; the security/HTTP step alone runs 1,176 cases across 241 files, and the Windows job re-runs the handle-isolation suite against a live server. A full parallel local run differs only where the production service already holds the port and where the operator's shell still pins legacy environment variables |

## Judgment calls worth naming

- **Handles over per-connection contexts for chat isolation.** A per-context jail
  hides the operator's selected workspace, so a handle could never widen it and the
  chat↔project mapping becomes unreachable. Scope was moved into the model context
  instead, which is the only carrier the protocol actually gives per conversation.
- **No `-settings` argument in the service image path.** It looks like the cheap fix
  for relocating the settings document, but the upgrade guard treats foreign
  arguments as a foreign install, so the change had to go into path resolution and
  the installer together.
- **Child environment built from a document, not inherited.** A service that inherits
  the interactive environment can be silently downgraded, or upgraded, by a stale
  variable — so the host passes only `settings.env` plus a small case-insensitive
  OS allowlist, and names a block that still lacks `PATH` in the boot log.
- **Some residual risks stay open on purpose.** Revoking historic OAuth grants would
  force every connected chat to re-pair, and moving the writable data root into
  `Program Files` trades a real protection (an ACL-protected machine directory) for
  tidiness. Both were measured, reported and left to the operator.
