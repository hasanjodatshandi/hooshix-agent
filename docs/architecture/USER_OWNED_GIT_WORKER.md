# User-owned Git Worker — opt-in operating contract

## Purpose
The HooshiX MCP Windows service is not the owner of a normal signed-in user's Git working copy. Git correctly refuses cross-owner access. A blanket Git `safe.directory=*` exception or silently changing repository ownership is not a supported solution.

The Windows Installer bundles `bin\hooshix-git-worker.exe` for owner-scoped Git operations. It **never** installs this worker as a LocalSystem service. The MCP control plane retains its existing project-handle permission checks, Task governance and audit.

## User enrollment and revocation

Open an ordinary, non-elevated Windows PowerShell terminal **as the owner of the repository**.

```powershell
$worker = 'C:\Program Files\HooshiX MCP\bin\hooshix-git-worker.exe'
& $worker -mode enroll -root 'D:\Projects\my-repository'
```

This explicitly checks the exact canonical repository's Windows owner SID, writes **only the signed-in user's HKCU Run entry** and starts a worker in their session. The entry starts the worker again after the same user logs on. Repeat for each authorized repository. No password, service OAuth secret or system-wide Git trust setting is written.

To immediately revoke a repository and its next-logon startup:

```powershell
& $worker -mode unenroll -root 'D:\Projects\my-repository'
```

Revocation removes just the matching HKCU entry and sends a local `worker_stop` message. User logoff also ends the user-session process. The service's fallback fails closed if the worker is absent or its identity does not match the current repository owner.

## Security boundaries
- Named-pipe path is SHA-256-derived from a canonicalized project root. Windows DACL authorizes only the actual repository owner SID and LocalSystem; remote clients are rejected.
- The client explicitly uses Windows `SECURITY_IDENTIFICATION`, not impersonation, preventing a user-worker process from assuming SYSTEM's privileges.
- The proxy verifies the actual server process's token SID matches the current filesystem repository owner. The worker checks the signed-in owner's SID before serving a root.
- Every request is versioned, size bounded and restricted to allowlisted Git command templates; arbitrary shell, custom Git options and out-of-root pathspecs are rejected.
- The owner worker's child Git process inherits no HOOSHIX tokens, Git environment overrides or service secrets. A bounded command timeout and output cap apply.
- The service only attempts owner delegation **after** native Git rejects the operation for dubious ownership. Failed authentication, offline worker or non-owner identity do not downgrade to an unsafe execution identity.
- `git_clone` and `git_init` are intentionally **not delegated**: they mutate creation targets that have no established Git owner and require a separate reviewed lifecycle.
- Mutating Git tools still require all existing MCP policy decisions and human approvals; worker enrollment grants no permission by itself.
- Per-user worker permits an approved MCP operator to run Git in the user's permitted repository. Enroll only roots whose Git operations you knowingly delegate.
- Use signed official installers and reviewed releases; this source version is not a production upgrade until native Windows CI and staging cutover have passed.

## Verification
- `go test ./... -count=1` on a user-owned Windows runner with `HOOSHIX_REQUIRE_GIT_WORKER_E2E=1` exercises owner session pipe, status, add, commit, log, invalid command, traversal rejection, stop and revocation.
- Tests under LocalSystem deliberately reject user enrollment; SYSTEM alone is not a valid user-owned test.
- JS tests cover owner-only fallback, offline behavior, packaging location, and errors unrelated to ownership.
- A clean, signed Windows staging upgrade must still verify the service remains healthy, Git status through the owner worker, and rollback without corrupting data. Do not use an unsigned local build as the public distribution.

## Recovery
The worker is independent of the HooshiX service. If worker enrollment or connectivity fails, remove the matching HKCU Run entry with `-mode unenroll` from the same account and stop the worker. The MCP service stays running, and ordinary file tools remain available. A system administrator can diagnose native Event Viewer/service logs without granting blanket Git ownership exceptions.