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
| `cmd/make-tray-icons` | regenerates the tinted `.ico` assets (see below) |
| `internal/svc` | the SCM boundary: registration, DACL, failure policy, start/stop |
| `internal/host` | the supervisor: settings, child process, health, status document |
| `internal/tray` | icon colour, menu, and the Win32 host that renders them |
| `cmd/setup` | one-click installer (planned) |

Build and test on Windows: `go build ./...`, `go vet ./...`, `go test ./...`.
Regenerate the tinted icons with `go run ./cmd/make-tray-icons`, which rewrites
`internal/tray/icons/*.ico` and is the only place the colours are chosen.

`go build ./...`, `go vet ./...` and `go test ./...` pass on Windows, and
`GOOS=linux` (amd64 and arm64) builds and vets clean, because the Windows-only
code sits behind `//go:build windows` with stubs beside it. That keeps the
module portable enough for a Linux CI runner to test the supervisor logic.

## Settings document

`%ProgramData%\HooshiXMCP\settings.json` is the machine-wide description of the
install. Nothing here is baked into the binary, so moving the app or changing
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
`HOOSHIX_PERMISSION_LEVEL` can never silently downgrade the assistant.

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
hooshix-mcp-tray                      :: reads %ProgramData%\HooshiXMCP\settings.json
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
