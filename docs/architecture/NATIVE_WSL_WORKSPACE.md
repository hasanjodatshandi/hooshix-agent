# Native WSL workspace provider — draft design and gates

This capability is distinct from unrestricted `exec(shell=wsl)`: neither enrolling the WSL shell nor approving a Windows directory grants access to Linux workspace files.

## Virtual root and authorization

Canonical identity is `wsl://<distro>/<absolute-linux-root>`. Standard `\\wsl.localhost\Distro\...` or `\\wsl$\Distro\...` selectors are normalized to that URI; Windows LocalSystem NEVER directly opens the UNC. A governed `add_workspace_roots` approval must explicitly include matching `wslBindings` with a user-owned Windows anchor. The separate, opt-in `wslfs` Worker must already be running as the owner of that anchor and attest the pinned distro/root. Persistent grants additionally bind to the **inbound MCP principal ID** (migration 27). Existing pre-migration records get `__unbound__` and fail closed until explicitly revoked and re-enrolled; they are never grandfathered into shared tenant access.

A Project Handle is minted only for an active, same-principal, persisted virtual root. Every Task step rechecks the binding; a stopped/revoked worker fails closed. The transport verifies the Windows owner worker process SID from the pipe process ID and connects with SECURITY_IDENTIFICATION to prevent elevated service impersonation.

## Linux-side root jail

The Windows owner worker executes the reviewed Linux ELF by exact argv, with pinned `--distribution`, `--cd`, `--exec`, and `--root`; no shell command is used for file operations. The Linux broker uses kernel `openat2` with `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV` for reads and traversal. Sensitive names and directories are refused, binaries/invalid UTF-8 are never returned as text, and file-size/search/output budgets are bounded. The broker never expands the caller's Linux root.

## Current implementation scope

Only `open_project`, root selection/listing, and `read_file`, `list_directory`, `search_files` through a securely enrolled WSLFS worker are implemented at present. Linux Git routing and the mutation methods `create_file`, `write_file`, `modify_file`, `delete_file`, `restore_file` remain **explicitly denied**. This is an intentional security boundary, not a production-ready substitute for native WSL development.

## Release blockers

- Complete secure mutation with immutable backups, optimistic concurrency, idempotency, restore and proper audit; implement governed Linux Git without shell bypass.
- End-to-end Windows SYSTEM → authorized owner named pipe → Linux broker → file tool with a real user-installed WSL distribution, including multi-principal and revocation tests.
- Run full Windows native CI, Linux race/kernel containment CI, package integrity and signed release checks.
- Independently test upgrade/rollback; never restart a running MCP connection via that same connection.
- Do not advise customers to install this capability or claim WSL onboarding is unblocked until these gates are met.