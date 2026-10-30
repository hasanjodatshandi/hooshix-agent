# HooshiX MCP as a Windows service

The connector has to answer a ChatGPT request at any moment, including right
after a reboot and before anyone signs in. A logon-triggered scheduled task or a
watchdog script cannot provide that, and it is why the old launcher needed a
manual restart on every code change. This module registers the server as a real
SCM service (`start= auto`, LocalSystem) and supervises the Node process from
inside it.

## Layout

| Path | Contents |
|---|---|
| `cmd/hooshix-mcp-service` | the service binary: install, control, run, status |
| `cmd/hooshix-mcp-tray` | the notification-area binary the user actually clicks |
| `cmd/hooshix-mcp-setup` | the installer: `Setup.exe` installs and uninstalls itself |
| `cmd/make-setup` | build-time assembler that appends the runtime to setup.exe |
| `cmd/make-tray-icons` | regenerates the tinted `.ico` assets (see below) |
| `internal/svc` | the SCM boundary: registration, DACL, failure policy, start/stop |
| `internal/host` | the supervisor: settings, child process, health, status document |
| `internal/tray` | icon colour, menu, and the Win32 host that renders them |
| `internal/setup` | the payload: archive, trailer, layout, and the machine entries |

Build and test on Windows: `go build ./...`, `go vet ./...`, `go test ./...`.
Regenerate the tinted icons with `go run ./cmd/make-tray-icons`, which rewrites
`internal/tray/icons/*.ico` and is the only place the colours are chosen.

`go build ./...`, `go vet ./...` and `go test ./...` pass on Windows, and
`GOOS=linux` (amd64 and arm64) builds and vets clean, because the Windows-only
code sits behind `//go:build windows` with stubs beside it. That keeps the
module portable enough for a Linux CI runner to test the supervisor logic.

## Installing

The deliverable is one file a non-technical operator double-clicks:

```bat
pnpm run installer:windows            :: build dist, then assemble the installer
pnpm run installer:windows -- --skip-build    :: reuse the current dist
pnpm run installer:windows -- --node <node.exe> --out <file>
```

`scripts/build-windows-installer.mjs` checks the toolchain against `.nvmrc` and
`packageManager`, compiles `dist/` with that same pinned runtime, installs
production dependencies hoisted (flat, no symlinks, `--frozen-lockfile`) into a
scratch tree outside the repository, cross-compiles the three Windows binaries,
zips the whole runtime, and appends it to setup.exe. The result is
`deploy/windows/build/HooshiX-MCP-Setup-<version>.exe` (about 61 MB: a
`node.exe`, `dist/`, and `node_modules/`) beside its `.sha256`. That directory
is gitignored — the artifact is a download, never a commit.

One elevation prompt covers everything. In order, the installer:

1. reads the appended archive and checks its CRC32 **before writing anything**,
   so a truncated download fails with "get setup.exe again" on an untouched
   machine;
2. unregisters the previous service, then waits for port 3001 to be released —
   which is also the proof that the old `node.exe` image is unlocked — and
   refuses to continue while a tray icon it did not start is holding the file
   (the message names the menu item, it never kills a process);
3. extracts under `%ProgramFiles%\HooshiX MCP`, rejecting any entry that would
   escape the directory, arrive as a symbolic link, or exceed the byte bound;
4. writes `%ProgramFiles%\HooshiX MCP\settings.json` **only when absent** — a
   document left there by an older build under `%ProgramData%\HooshiXMCP` is
   copied up instead of overwritten, so an upgrade keeps the operator's origin,
   port and any knob they switched on;
5. copies its own payload-less head to `bin\uninstall.exe`, which is what the
   entry in Programs runs, so removing an install never needs the download;
6. writes the HKLM startup value for the tray and the Programs entry, registers
   the service and starts it.

What lands on the machine is exactly `%Program Files%\HooshiX MCP` — including
its `settings.json` — `HKLM\...\Run\HooshiX MCP tray` and
`HKLM\...\Uninstall\HooshiXMCP`. `--uninstall` removes those two keys and the
install directory and keeps the data root — the database, approvals and logs are
the operator's, so `--purge-data` has to be asked for. `--base-url` sets the
HTTPS origin at install time; with no argument the deployment default
(`https://mcp.hooshix-agent.ir`) is used, and an `http://` origin is refused.

Permission knobs stay out of the installer on purpose. `HOOSHIX_PERMISSION_LEVEL`,
`HOOSHIX_DIRECT_AUTO_APPROVE`, `HOOSHIX_EXEC_ENABLED` and `CTX_ISOLATION_MODE`
are never written: shipping them switched on would hand every fresh install an
endpoint that executes anything the model asks for.

## Migrating a machine that already runs the connector

A machine where the server already runs some other way — a logon task, a respawn
script, an interactive `pnpm dev:http` — holds two things the service must not
duplicate: the listener on the port and the operator's data. In order:

1. **Read the live environment first.** Whatever the old launcher pinned (the
   permission ceiling, `CTX_ISOLATION_MODE`, the database path, the log
   directory, the token file) has to be written into
   `%ProgramFiles%\HooshiX MCP\settings.json` before the service starts, because a
   connector that comes back with a different ceiling looks identical from the
   outside. Those go in the `env` map, which overrides the defaults
   `internal/host/settings.go` would otherwise apply — including
   `HOOSHIX_DB_PATH`, whose default is a fresh `data/mcp.db`, not the operator's
   existing file.
2. **Stop the old mechanism by its own name** — disable its task, exit its script
   — and confirm the port is free. Neither the service nor the installer stops a
   process it did not start; both refuse to bind over one instead.
3. **Install and start.** `pnpm run installer:windows` plus Setup.exe is the
   delivered install. `hooshix-mcp-service service install` from an elevated
   prompt, beside a settings document that points at the checkout, is what a
   machine that develops the code wants: after that, `pnpm build` and
   `pnpm run service:restart` is the whole loop.
4. **Verify before removing anything.** `pnpm run service:status` shows the SCM
   state and the published server state together, `/health/ready` answers 200, and
   the tray icon is green. Only then does the old launcher get deleted.

## Settings document

`%ProgramFiles%\HooshiX MCP\settings.json` is the machine-wide description of the
install, kept beside the program so one folder holds the whole deployment. The
host looks for it there first and falls back to `%ProgramData%\HooshiXMCP` only
when it is absent, which is how an install upgraded before the move keeps
working. Nothing here is baked into the binary, so moving the app or changing
the port is a file edit:

```json
{
  "node": "C:\\Program Files\\HooshiX MCP\\runtime\\node.exe",
  "entry": "C:\\Program Files\\HooshiX MCP\\app\\dist\\index-http.js",
  "workingDirectory": "C:\\Program Files\\HooshiX MCP\\app",
  "dataRoot": "C:\\ProgramData\\HooshiXMCP",
  "env": {
    "HOOSHIX_HTTP_PORT": "3001",
    "HOOSHIX_PUBLIC_BASE_URL": "https://mcp.hooshix-agent.ir"
  }
}
```

Every field must be an absolute path and the layout is verified at load: a
missing runtime, a non-JavaScript entry or an unusable data root fails before
the first spawn. The host then owns the three paths the server writes —
`HOOSHIX_LOG_DIR`, `HOOSHIX_DB_PATH`, `HOOSHIX_BOOTSTRAP_TOKEN_FILE` — and
defaults each under `dataRoot`, because a service starts in `System32` with no
interactive profile. The child environment is built from this document plus a
small OS allowlist; nothing else is inherited, so an operator's stale
`HOOSHIX_PERMISSION_LEVEL` can never silently downgrade the assistant. The
allowlist matches names the way Windows resolves them, without regard to case,
and hands the server the allowlist's own spelling: the block a service starts
with says `Path` and `ComSpec`, and reading those names exactly left the server
without a search path, which made every command a client asked for fail as
`spawn cmd.exe ENOENT`. A block that still has no `PATH` is named in the service
log at boot, because the service otherwise starts, answers health checks and
fails only when a conversation asks it to run something.

This Windows-only release does not support Linux/WSL workspaces or install
a Linux broker. Only Windows project directories can be enrolled.

## What the supervisor does

- Refuses to start when the configured port is already bound, naming the
  condition instead of crash-looping against a squatter.
- Respawns the server with a `1s → 2s → 5s → 10s → 30s` backoff, resetting the
  ramp after a minute of stable running.
- Probes `/health/live` and `/health/ready` every 5s. `starting` only becomes
  `running` once the child actually answers, and a 503 on readiness is reported
  as `degraded` rather than a healthy service.
- Kills the child through a Windows job object (`KILL_ON_JOB_CLOSE`), so a host
  that dies abruptly cannot leave an unmanaged listener holding the port. It
  only ever terminates a process it spawned.
- Writes `service.log` beside the data root, size-bounded and rotated.

## Status document

`%ProgramData%\HooshiXMCP\status.json` is rewritten atomically every 2 seconds:

```json
{"phase":"running","state":"ready","pid":23604,
 "listener":"http://127.0.0.1:3001","publicBaseUrl":"https://mcp.hooshix-agent.ir",
 "restarts":1,"updatedAt":"2026-10-13T07:55:38Z"}
```

`phase` is what the service is doing (`starting`, `running`, `recovering`,
`stopping`, `stopped`); `state` is what the server reports
(`ready`, `degraded`, `down`).

A stopped service leaves its last `status.json` on disk, so the document alone
can lie. The tray merges it with the SCM answer and treats anything older than
30 seconds as stale, which is what makes the colour rules below safe to read at
a glance.

## Tray icon

```bat
hooshix-mcp-tray                      :: reads %ProgramFiles%\HooshiX MCP\settings.json
hooshix-mcp-tray -settings <path>     :: explicit settings document
```

The icon colour is the whole point, so it only claims what it can prove:

| Colour | Meaning | Condition |
|---|---|---|
| green | serving requests | SCM `running` **and** a fresh `phase: running` + `state: ready` |
| yellow | alive, not serving yet | starting, recovering, `degraded`, or a publisher that went quiet |
| red | cannot be used | SCM is not running, cannot be queried, or the service says it stopped |

The menu reads `Open logs`, `Start service`, `Stop service`, `Restart service`,
`Close tray icon`, with the status rows above them, and grey out Start while
running and Stop/Restart while not. The colours come from three tinted variants
of the brand mark, generated by `cmd/make-tray-icons` (16/32/48/256 px PNG
frames) and embedded with `//go:embed`, so the tray needs no asset directory.

What it deliberately does **not** do:

- It holds no credential and probes no port. It reads `status.json` and asks
  SCM — nothing more — which is why it runs unelevated in the user's session.
- `Close tray icon` never stops the service. It closes the icon; the connector
  keeps answering ChatGPT.
- Its own log goes to `%LOCALAPPDATA%\HooshiXMCP\tray.log` (rotated at 1 MB),
  never into the machine-wide tree that LocalSystem owns.
- One icon per session: a second launch logs the reason and exits `0`, so a
  logon launch racing a manual one does not stack icons.

Behaviour worth knowing when it looks wrong:

- Clicks use `NOTIFYICON_VERSION_4`. If the shell refuses the version upgrade,
  the tray falls back to the legacy mouse messages and logs it; `Ctrl+Alt+M`
  opens the same menu either way.
- Explorer restarts (a `TaskbarCreated` broadcast) leave a cached icon that
  shows but swallows clicks, so the tray re-registers the icon *and* the click
  version, retrying once and logging a hard failure.
- A balloon follows a colour **change** only. The first snapshot after login
  just paints the icon: an "it is down" balloon at every logon trains the user
  to ignore the balloon.
- Service commands run off the message-loop thread because Stop and Restart wait
  for SCM; a frozen pump would stop answering clicks while the operator watches.

The installer builds the tray with the GUI subsystem so no console window flashes
at logon:

```bat
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H=windowsgui" -o hooshix-mcp-tray.exe ./cmd/hooshix-mcp-tray
```

The icons and menu need a real shell, so that part is verified by running it on a
desktop; the colour and staleness rules in `internal/tray/state.go` are portable
and covered by `go test ./...`.

## Controlling the service

```bat
hooshix-mcp-service service install      :: register + auto-start + failure policy (elevated)
hooshix-mcp-service service start | stop | restart
hooshix-mcp-service service status
hooshix-mcp-service status               :: SCM state plus the published server state
hooshix-mcp-service service run-service  :: run the supervisor in a console (development)
```

`install` applies this service DACL:

```
D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;LCRPWP;;;IU)
```

Interactive users get exactly `SERVICE_QUERY_STATUS` (LC), `SERVICE_START` (RP)
and `SERVICE_STOP` (WP). That single line is what lets a normal, non-elevated
tray control the service — `LCSWLOCRRC` is a common write-up that contains
neither RP nor WP. Each operation opens the service with only the right it needs,
since `mgr.OpenService` would otherwise demand `SERVICE_ALL_ACCESS`.

After a code change the loop is `pnpm build` then `hooshix-mcp-service service
restart`: SCM starts the new binary, and no watchdog or logon task is involved.

## Safety rules this module keeps

- Persistence is auto-start. A logon task is never the mechanism, and
  `tests/windows-service-deployment.test.ts` fails if `schtasks` or `ONLOGON`
  appears in these sources.
- A process the supervisor did not spawn is never killed or replaced.
- Stopping on an operator request exits `0`; only a self-terminated supervisor
  exits `1`, otherwise the restart-on-failure policy would undo every Stop.
- The tray asks SCM and reads one JSON document. It never enumerates, adopts,
  or terminates a process, so a menu click cannot reach the wrong Node instance.
- The installer carries its runtime instead of fetching one, verifies it before
  the first write, and stops with an explanation rather than ending a process it
  did not start.
