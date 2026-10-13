// Package svc registers and drives the HooshiX MCP Windows service.
//
// The service runs under LocalSystem so the connector answers before anyone
// logs in — the property a logon-triggered scheduled task cannot provide. The
// server itself is a Node child process owned by the supervisor in
// internal/host; this package is only the SCM boundary.
package svc

// ServiceName is the SCM registration name. The installer, the tray and the
// operational docs all refer to the service by this name, so it lives in one
// untagged file that both the Windows build and the cross-platform build see.
const ServiceName = "HooshiXMCP"

const displayName = "HooshiX MCP Server"

const description = "HooshiX MCP server: hosts the Model Context Protocol endpoint for ChatGPT and other connectors."

// serviceStartStopSDDL is the service DACL Install applies. SYSTEM and
// Administrators keep full control; interactive users (IU) get exactly
// SERVICE_QUERY_STATUS (LC), SERVICE_START (RP) and SERVICE_STOP (WP) — the
// rights a status line and two menu items need, and nothing else.
//
// The bits matter: "LCSWLOCRRC" is frequently written as though it covered
// start and stop, but it contains neither RP (0x10) nor WP (0x20), and a tray
// built on it fails with access denied on every control call while still
// appearing to work.
const serviceStartStopSDDL = "D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;LCRPWP;;;IU)"
