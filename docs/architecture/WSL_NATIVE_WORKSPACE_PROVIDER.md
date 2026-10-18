# Native WSL Workspace Provider — security model and release gates

## Problem / why UNC cannot be the integration layer
A LocalSystem Windows service cannot access the signed-in developer's WSL distribution via `\\wsl.localhost\Distro\...`. This is an OS account boundary, **not** a missing `safe.directory` or a permission to approve again. The product must not switch its service account to each customer's personal Windows account or treat a Linux project as a Windows UNC folder.

## Implementation / authority chain
1. The human user signs in to Windows and explicitly enrolls a **separate read-only WSLFS worker** for an exact Windows directory owned by their SID, WSL distro, and absolute **canonical** Linux project root. It is independent of owner Git and unrestricted `exec(shell=wsl)` grants.
2. Windows service (LocalSystem) may contact a locally ACL-protected, remote-client-denying Named Pipe derived from the pinned owner Windows root. The caller authenticates the **actual server process's Windows token SID** against the root's Windows filesystem owner; the client uses SECURITY_IDENTIFICATION and cannot be impersonated by the worker as SYSTEM. The worker verifies its own owner SID on startup.
3. The owner's Windows worker launches a pinned Linux ELF binary through `wsl.exe --distribution <distro> --cd <linux-root> --exec <broker> --root <linux-root>` using argv arrays and a restricted environment; no Windows or Linux shell is used for file-tool operations.
4. The Linux broker interprets a versioned, bounded JSON request. Only `probe`, `read`, `list` and `search` are currently accepted. It opens a rooted filesystem descriptor and on Linux uses kernel `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV`. Absolute paths, traversals, symlink aliases, mount crossings, sensitive files, oversized files and output are rejected or omitted.
5. The MCP operator **separately approves** `add_workspace_roots` via the existing Task approval workflow. Supply `paths` with the WSL URI/UNC and `wslBindings` with the exact owner anchor. The Windows service calls the scoped worker's `probe` and stores the attested virtual root and binding in the SQLite workspace policy. No broker = no registration.
6. `open_project` converts `\\wsl.localhost\Ubuntu\home\coder\workspace\Hooshix` to `wsl://Ubuntu/home/coder/workspace/Hooshix`, requires an existing allowed binding and live probe, and issues a principal-bound expiring `ph_` handle. The same handle scopes file reads and persisted Task read steps; it cannot be reused by another principal.
7. The R2 gateway, policy decision point and file handler authorize each request. `read_file`, `list_directory` and `search_files` use the WSL provider. The format matches native Windows read/list/search (SHA256, directory tags, search metadata). Unsupported file mutations and Git on virtual roots **fail closed**, not by falling back to the Windows filesystem or unrestricted `exec`.

## Optional owner-side enrollment (only AFTER reviewed installer is deployed)
In an ordinary **non-elevated** Windows PowerShell under the owner account, use:

```powershell
& 'C:\Program Files\HooshiX MCP\tools\enroll-wsl-files.ps1' -Distro 'Ubuntu' -LinuxRoot '/home/coder/workspace/Hooshix' -WindowsOwnerAnchor 'D:\workspace\hooshix-agent'
```

If scripts are distributed separately, use the reviewed `scripts/enroll-wsl-files.ps1` from the matching source release. It checks the owner SID, copies the SHA256-verified Linux ELF from the installer into the WSL user's home with 0700 permissions and enrolls the owner-session worker through the package's Windows binary. No SYSTEM WSL operation or service restart is needed. A separately user-authorized `-mode wslfs-unenroll -root <anchor>` removes its HKCU Run entry and stops that pipe worker.

The operator must then approve **only the exact Linux root** as a governed Task step:

```json
{"paths":["wsl://Ubuntu/home/coder/workspace/Hooshix"],"wslBindings":[{"path":"wsl://Ubuntu/home/coder/workspace/Hooshix","ownerWindowsRoot":"D:\\workspace\\hooshix-agent"}]}
```

In a multi-project pool use `open_project({"path":"wsl://Ubuntu/home/coder/workspace/Hooshix"})` (or the equivalent standard WSL UNC selector) and then pass its `project` handle to each read/list/search tool. `task_step_risks` and persisted read-only Task workspaces use the same root identity and reattest before execution.

## Verified on a real Windows/WSL2 host (2026-10-18)
- Linux: Go 1.27.1, Ubuntu WSL2 6.18; Linux native ELF reads the **real** `README.md` and lists the project, and rejects `../.bashrc`. Go tests run natively on Linux with the race detector and negative symlink/security cases.
- Windows: an owner-session WSLFS worker on a **disposable owner-SID-verified Windows anchor**, without any HKCU auto-start entry, authenticated the service-side SYSTEM proxy. Distro/root probe, real README read, 31 directory entries, and 412 search matches succeeded; malformed relative paths returned errors.
- Staged Node: real `addWorkspaceRoots`, UNC selector to virtual root, principal-bound `ph_` handle, file read/list/search, sensitive/traversal denial, mutation denial, and Task-context root resolution succeeded from the Windows SYSTEM tool context using an isolated DB. This is **not** the installed MCP service.
- Only the temporary owner-session worker and temporary user-owned WSL/Windows test directories were revoked and cleaned. An unrelated, preexisting owner worker and all installed services were left untouched.

## Non-negotiable release gaps
**This is a read-only native WSL workspace milestone, NOT feature parity for commercial sale.** The next installer is NOT ready to be called a complete WSL solution until:
- Reviewed WSL file create/write/modify/delete/restore with atomicity, SHA-256 compare-and-swap, durable recoverable backups, idempotency, auditing, concurrency/replay controls, and independent **write** opt-in (never inferred from read-only enrollment).
- Reviewed Linux Git operations behind distinct user approval, including hooks/code-execution risk; Task snapshot/rollback semantics on Linux roots.
- Automated Linux `openat2` security/race tests, Windows owner Named Pipe/revocation tests and native MCP transport tests across principals and Task lifecycle pass in CI.
- A signed installer produces and verifies both Windows worker and Linux ELF; owner enrollment is tested for upgrade, revocation and user logoff. An independently recoverable staged service upgrade/rollback is proven.
- The actual connected HooshiX MCP service (not just staged Node) passes `add_workspace_roots`, `open_project`, `read_file`, `list_directory` and `search_files` against the intended WSL folder after user approval.

Do NOT rely on unrestricted WSL shell as a fallback. Do NOT grant arbitrary UNC/network shares by mistaking them for native WSL identities. Do NOT sell or represent the current read-only milestone as complete native WSL feature parity.