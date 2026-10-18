# Owner-session WSL execution for HooshiX MCP

## Why the bridge exists
Windows WSL does not support direct execution from `NT AUTHORITY\SYSTEM` (error `WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED`). Running the always-on MCP service with higher privileges or adding `wsl.exe` to its PATH cannot change that behavior.

HooshiX therefore supports `exec` with `shell: "wsl"` only through an **explicitly user-enrolled** Windows Git/WSL worker running under the signed-in repository owner's own Windows logon token. It is a separate opt-in from Git enrollment. An offline worker or a mismatched owner SID fails closed. Shell `bash` continues to mean the Windows-installed Bash program and never silently changes to WSL.

## One-time user enrollment (ordinary Windows PowerShell, NOT elevated)

For source validation before release, build the worker from the source repo in the owner's shell:

```powershell
Set-Location 'D:\workspace\hooshix-agent\deploy\windows'
go build -buildvcs=false -o '.\build\bin\hooshix-git-worker-wsl-check.exe' .\cmd\hooshix-git-worker
$worker = '.\build\bin\hooshix-git-worker-wsl-check.exe'
wsl.exe --list --quiet
& $worker -mode wsl-enroll -root 'D:\workspace\hooshix-agent' -distro 'Ubuntu' -linux-root '/home/coder/workspace/Hooshix'
& $worker -mode wsl-proxy -root 'D:\workspace\hooshix-agent' -wsl-command 'pwd; id -un; git --version'
```

Use the exact installed distro name, not necessarily `Ubuntu`, and the actual existing Linux directory. Enrollment checks the current Windows owner's SID, then runs a read-only `pwd` from the owner's WSL context before it writes a user-owned HKCU Run registration. The worker itself is started in that user session. This is never a LocalSystem service and needs no Windows password on a command line.

After the signed Installer is deployed, rerun enrollment using:
`C:\Program Files\HooshiX MCP\bin\hooshix-git-worker.exe`, so the user's HKCU startup registration is independent of the development source/build path.

Revoke with:
```powershell
& $worker -mode wsl-unenroll -root 'D:\workspace\hooshix-agent'
```
This removes the exact user's HKCU Run entry and stops the current owner worker. User logoff also terminates the session worker.

## MCP call after the new signed version is installed

```json
{"command":"pwd; id -un; uname -a","shell":"wsl","cwd":"D:\\workspace\\hooshix-agent"}
```

The service still requires `HOOSHIX_EXEC_ENABLED=1` (explicit, off by default). The `cwd` on the request is the **Windows enrollment anchor**, not the Linux cwd. The distro and Linux working directory are fixed by the user at enrollment and cannot be supplied by remote MCP requests. WSL startup occurs as the signed-in Windows user, executing the distro's configured Linux default user.

The WSL proxy performs no credential delegation, no generic Windows shell fallback and no Git safe.directory change. A bounded shell request (6,000 chars), process timeout (120s) and maximum response (2 MiB) apply.

## Scope and important limitations
- This adds an explicitly opted-in **WSL shell via `exec`**. It does **not yet** make native `read_file`, `list_directory`, Git MCP tools or `open_project` directly accept WSL Linux filesystem paths. Those require a separate workspace-file broker and Linux-to-Windows project-handle identity mapping.
- `exec` is unrestricted after the operator enables it; a Linux shell command may intentionally change files outside its initial working directory. The enrolled Linux root is the initial cwd, **not a filesystem sandbox**. This is why WSL uses its own opt-in.
- WSL execution cannot work while the corresponding Windows owner is signed out, unless a separately approved and audited non-interactive session agent is provisioned.
- A Git worker enrollment **does not** imply a WSL exec enrollment.
- This does not repair missing Python inside Windows; Linux Python runs inside the selected WSL distribution if installed.
- Real WSL execution on the owner's Windows machine must pass before cutover; a CI runner can test ACL/IPC without having a real WSL distribution installed.

## Validation gates
1. Local SYSTEM account is denied WSL enrollment and WSL direct execution; an un-enrolled WSL proxy responds 126.
2. Windows GitHub Actions under a normal user token passes `HOOSHIX_REQUIRE_WSL_BROKER_E2E=1` pipe creation/identity/revocation tests.
3. The owner runs the three executable commands above and observes expected Linux cwd and Linux username.
4. Only then build the signed installer, test stop/upgrade/start/rollback independently from the MCP service connection, and update enrolled executable paths to the installed version.