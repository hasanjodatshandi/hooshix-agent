# HooshiX MCP — Windows Free Edition

**License:** Apache License 2.0. This edition is free. It contains no
payment, subscription, trial expiration, or paid-feature entitlement checks.

## Supported systems

- Windows 10/11 (x64), a local Windows service, and a per-user notification tray
- Windows filesystem workspaces and Git on local Windows drives
- No WSL integration, Linux broker, WSL background worker, or distribution enrollment
- Linux containers remain for CI smoke testing only, not as a customer installation feature

## Installation and maintenance

The offline installer carries the pinned Node runtime, application and a customer-facing `app/QUICKSTART.txt`. Installation health is local only; it does not prove that the customer's HTTPS connector is reachable. Each customer must configure a customer-owned HTTPS origin and OAuth before calling ChatGPT tools. Double-click
the EXE and accept the administrator prompt. The installer creates the Windows
service and preserves its existing account, recovery policy and security descriptor
on upgrades.

Running the same full installer EXE again updates or repairs the existing installation.
For explicit maintenance, open an **administrator Windows terminal** and execute
the downloaded full installer with `--repair`. Repair preserves the existing
`%ProgramData%\HooshiXMCP\settings.json`, SQLite database, logs and credentials.

Every replacement of an existing program tree captures one prior-version snapshot
under `%ProgramData%\HooshiXMCP\recovery\previous-program`. If the upgrade
fails after the Windows service stops, Setup attempts to recover the previous
program files and restart the original service. Use `<full-installer.exe> --rollback`
to restore the last version explicitly. **Rollback restores program files only**;
it never rewinds customer workspaces or application databases. Schema changes
must remain backward compatible for this reason. Upgrade snapshots consume disk
space roughly equivalent to the previous installed program files.

Use Windows **Apps & features / Programs and Features → HooshiX MCP → Uninstall**
to remove the program and service; ordinary uninstall keeps customer data.
`--uninstall --purge-data` is a separately explicit destructive option.

An ongoing owner-session Git worker or tray icon can lock files. Setup refuses
to stop or overwrite the service in that case; close the tray or unenroll the
Windows Git worker through its owner first. Setup never kills those processes.

## Customer settings and projects

The historical default `https://mcp.hooshix-agent.ir` is **not** a customer-specific endpoint. Until the operator provides their own HTTPS origin, the tray refuses to open that default login page, preventing a customer from disclosing a privileged operator secret to the wrong website. Follow the bundled `%ProgramFiles%\\HooshiX MCP\\app\\QUICKSTART.txt` for first-run configuration. A green tray icon proves only local service readiness, never remote HTTPS reachability.

From the tray menu choose **Open Windows settings**. Sign in with the operator
credential. The page shows service URL/port, approved Windows roots, active
project and read-only automatic Git readiness. It offers a copyable
`open_project` request for each approved root.

To add a new local folder, provide a drive-letter Windows path in the page.
It generates a copyable `task_create` proposal; submit the request in ChatGPT.
The existing approval procedure remains mandatory. This avoids a web page
silently granting itself filesystem access. Git trust remains fail-closed for
unknown owners. Service-level URL/permission settings require local
administrator access rather than a browser form.

## Verified TLS/OAuth rehearsal versus customer network testing

An automated, isolated integration test now validates the full HTTPS-terminated
loopback flow from OAuth discovery and PKCE consent to real MCP SDK tool
listing and a read-only call, including rejection of requests that exceed
approved scopes. This is **not** proof of a public Internet route. Real
customer DNS, TLS, remote proxy/tunnel, firewall and interactive ChatGPT
connector onboarding must be validated on an independent customer setup.

### Customer public-connection acceptance update (2026-10-27)

The operator reported successful installation, ChatGPT OAuth registration
and MCP testing through `https://test.hooshix-agent.ir/mcp` in a disposable
Windows Sandbox. The earlier action-discovery error no longer occurred.
This is **user-reported acceptance**, not independently retained MCP
`tools/list`/`get_system_info` logs and not proof that every one of the 58
tools works end-to-end. The public Gateway path used separately installed
HooshiXAgent tunnel software; it is not bundled with the MCP installer.
Independent physical Windows customer acceptance remains outstanding.

## Release gates still required

- Green TypeScript, Windows-native, test coverage, release auditing and dependency security CI
- Windows Sandbox clean install, repair, upgrade, failure injection and rollback;
  check Windows SCM identity/DACL, URL, settings and SQLite bytes throughout
- Representative project Git and file operations with explicit approvals
- Customer setup/uninstall usability on a separate clean Windows PC

No commercial payments are enabled. Authenticode signing is deferred.
The PR is deliberately a Draft until all release gates pass.
