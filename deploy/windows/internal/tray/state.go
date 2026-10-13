// Package tray renders the HooshiX MCP service state in the notification area
// and issues the operator's start/stop/restart commands.
//
// It holds no credential and makes no privileged call: the state comes from the
// service's published status.json plus SCM queries, and the commands go through
// SCM, where install time granted interactive users exactly query, start and
// stop. That is what lets the tray run unelevated in the user's session.
package tray

import (
	"strconv"
	"strings"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
)

// Snapshot is everything the tray knows, merged from the two sources it reads.
// SCM answers for the service; the published document answers for the server
// inside it, and the two disagree routinely — a stopped service leaves its last
// status.json on disk.
type Snapshot struct {
	Service   string // SCM state name, or "unknown" when it could not be queried
	Phase     string // host phase reported by the service
	State     string // host probe state
	Listener  string
	Restarts  int
	LastError string
	Published bool // a usable status.json was read
	Stale     bool // that document is older than liveReportWindow
}

// liveReportWindow is how long a published document counts as current. The
// service rewrites it every two seconds, so anything older means the publisher
// is gone even though SCM may still believe the service is starting.
const liveReportWindow = 30 * time.Second

// clock is replaced in tests so staleness is a tested state rather than a
// function of when the suite happens to run.
var clock = time.Now

// Merge combines one SCM answer with one published document.
func Merge(serviceState string, status host.Status, readErr error) Snapshot {
	snapshot := Snapshot{Service: serviceState}
	if serviceState == "" {
		snapshot.Service = "unknown"
	}
	if readErr != nil {
		return snapshot
	}
	publishedAt, parseErr := time.Parse(time.RFC3339, status.UpdatedAt)
	snapshot.Phase = status.Phase
	snapshot.State = status.State
	snapshot.Listener = status.Listener
	snapshot.Restarts = status.Restarts
	snapshot.LastError = status.LastError
	snapshot.Published = true
	// A document without a parseable timestamp cannot prove anything is alive.
	snapshot.Stale = parseErr != nil || clock().Sub(publishedAt) > liveReportWindow
	return snapshot
}

type readiness int

const (
	readinessGreen readiness = iota
	readinessYellow
	readinessRed
)

// readinessOf maps a snapshot to the icon colour.
//
// Red means the connector cannot serve: SCM does not report the service
// running, or the service says it stopped. Yellow means alive but not serving —
// starting, respawning after a crash, degraded readiness, or a publisher that
// went quiet. Green requires the running service's own live "ready" report, so
// a stale document or a half-booted server can never be shown as connected.
func readinessOf(snapshot Snapshot) readiness {
	if snapshot.Service != "running" {
		return readinessRed
	}
	if !snapshot.Published || snapshot.Stale {
		return readinessYellow
	}
	switch snapshot.Phase {
	case host.PhaseStopped, host.PhaseStopping:
		return readinessRed
	case host.PhaseRunning:
		if snapshot.State == host.StateReady {
			return readinessGreen
		}
		return readinessYellow
	default:
		return readinessYellow
	}
}

// displayText is the one-line answer to "is it working?", in operator language
// rather than internal tokens.
func displayText(snapshot Snapshot) string {
	switch readinessOf(snapshot) {
	case readinessGreen:
		return "connected and ready"
	case readinessRed:
		if snapshot.Service == "unknown" {
			return "service status unavailable"
		}
		return "not running (service " + snapshot.Service + ")"
	}
	switch {
	case !snapshot.Published:
		return "running, waiting for its first report"
	case snapshot.Stale:
		return "running, but the service stopped reporting"
	case snapshot.Phase == host.PhaseRecovering:
		return "restarting after a failure"
	case snapshot.State == host.StateDegraded:
		return "running, but not ready to serve"
	default:
		return "starting up"
	}
}

// statusLines renders the disabled header rows at the top of the menu. Long
// error text is truncated because a menu row that wraps is a menu nobody reads.
func statusLines(snapshot Snapshot) []string {
	lines := []string{"HooshiX MCP: " + displayText(snapshot)}
	if snapshot.Listener != "" && !snapshot.Stale && snapshot.Published {
		lines = append(lines, "Local address: "+snapshot.Listener)
	}
	if snapshot.Restarts > 0 {
		lines = append(lines, "Server restarts: "+strconv.Itoa(snapshot.Restarts))
	}
	if text := strings.TrimSpace(snapshot.LastError); text != "" {
		const maxLen = 70
		if len(text) > maxLen {
			text = text[:maxLen] + "..."
		}
		lines = append(lines, "Last error: "+text)
	}
	return lines
}
