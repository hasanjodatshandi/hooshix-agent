package tray

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
)

func freshStatus(phase, state string) host.Status {
	return host.Status{
		Phase:      phase,
		State:      state,
		Listener:   "http://127.0.0.1:3001",
		UpdatedAt:  clock().UTC().Format(time.RFC3339),
		PublicBase: "https://mcp.example.test",
	}
}

func TestColourFollowsWhatTheOperatorCanActuallyDo(t *testing.T) {
	tests := []struct {
		name     string
		snapshot Snapshot
		expected readiness
	}{
		{"serving", Snapshot{Service: "running", Published: true, Phase: host.PhaseRunning, State: host.StateReady}, readinessGreen},
		{"alive but not ready", Snapshot{Service: "running", Published: true, Phase: host.PhaseRunning, State: host.StateDegraded}, readinessYellow},
		{"not serving", Snapshot{Service: "running", Published: true, Phase: host.PhaseRunning, State: host.StateDown}, readinessYellow},
		{"booting", Snapshot{Service: "running", Published: true, Phase: host.PhaseStarting, State: host.StateDown}, readinessYellow},
		{"respawning", Snapshot{Service: "running", Published: true, Phase: host.PhaseRecovering, State: host.StateDown}, readinessYellow},
		{"no report yet", Snapshot{Service: "running"}, readinessYellow},
		{"publisher went quiet", Snapshot{Service: "running", Published: true, Stale: true, Phase: host.PhaseRunning, State: host.StateReady}, readinessYellow},
		{"service stopped", Snapshot{Service: "stopped", Published: true, Phase: host.PhaseRunning, State: host.StateReady}, readinessRed},
		{"scm unreachable", Snapshot{Service: "unknown"}, readinessRed},
		{"service running but server stopped", Snapshot{Service: "running", Published: true, Phase: host.PhaseStopped, State: host.StateDown}, readinessRed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := readinessOf(test.snapshot); got != test.expected {
				t.Fatalf("readinessOf(%+v) = %d, want %d", test.snapshot, got, test.expected)
			}
		})
	}
}

// A stopped service leaves its last status.json behind. If the stale document
// decided the colour, an operator would see green with nothing serving — the
// exact failure that made the old watchdog unreadable.
func TestStaleDocumentCanNeverReadAsConnected(t *testing.T) {
	stale := freshStatus(host.PhaseRunning, host.StateReady)
	stale.UpdatedAt = clock().Add(-2 * time.Minute).UTC().Format(time.RFC3339)
	snapshot := Merge("running", stale, nil)
	if !snapshot.Stale {
		t.Fatalf("expected a two-minute-old report to be stale: %+v", snapshot)
	}
	if readinessOf(snapshot) == readinessGreen {
		t.Fatalf("a stale report must not be green: %s", displayText(snapshot))
	}
	if !strings.Contains(displayText(snapshot), "stopped reporting") {
		t.Fatalf("expected the silence to be named, got %q", displayText(snapshot))
	}

	current := Merge("running", freshStatus(host.PhaseRunning, host.StateReady), nil)
	if current.Stale || readinessOf(current) != readinessGreen {
		t.Fatalf("a fresh ready report must be green: %+v", current)
	}
}

func TestMergeTreatsAnUnreadableDocumentAsNoReport(t *testing.T) {
	snapshot := Merge("", host.Status{}, errors.New("file does not exist"))
	if snapshot.Published {
		t.Fatalf("expected no published report")
	}
	if snapshot.Service != "unknown" {
		t.Fatalf("an empty SCM answer must be reported as unknown, got %q", snapshot.Service)
	}
	if readinessOf(snapshot) != readinessRed {
		t.Fatalf("an unqueryable service is red, not decorative")
	}
	if !strings.Contains(displayText(snapshot), "unavailable") {
		t.Fatalf("expected an unavailable message, got %q", displayText(snapshot))
	}

	// A document written by a different producer (or truncated by a power loss)
	// cannot prove liveness either.
	broken := freshStatus(host.PhaseRunning, host.StateReady)
	broken.UpdatedAt = "not a timestamp"
	if merged := Merge("running", broken, nil); !merged.Stale {
		t.Fatalf("an unparseable timestamp must count as stale: %+v", merged)
	}
}

func TestStatusLinesStayReadable(t *testing.T) {
	snapshot := Merge("running", freshStatus(host.PhaseRunning, host.StateReady), nil)
	lines := statusLines(snapshot)
	if len(lines) < 2 {
		t.Fatalf("expected a status line and the local address, got %v", lines)
	}
	if !strings.Contains(lines[0], "connected and ready") {
		t.Fatalf("expected the serving text first, got %v", lines)
	}
	if !strings.Contains(strings.Join(lines, "\n"), "http://127.0.0.1:3001") {
		t.Fatalf("expected the local address while serving, got %v", lines)
	}

	// A crash loop has to say so, and the reason must not stretch the menu.
	crashing := freshStatus(host.PhaseRecovering, host.StateDown)
	crashing.Restarts = 12
	crashing.LastError = strings.Repeat("server exited with code 7 ", 20)
	joined := strings.Join(statusLines(Merge("running", crashing, nil)), "\n")
	if !strings.Contains(joined, "Server restarts: 12") {
		t.Fatalf("expected the restart count while recovering, got %q", joined)
	}
	if !strings.Contains(joined, "...") {
		t.Fatalf("expected a truncated error, got %q", joined)
	}
	for _, line := range strings.Split(joined, "\n") {
		if len(line) > 90 {
			t.Fatalf("menu row too long to read: %d chars — %q", len(line), line)
		}
	}
}
