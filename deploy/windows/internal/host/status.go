package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Service phases. The tray renders these, so the vocabulary is part of the
// Windows contract, not an internal detail.
const (
	PhaseStarting   = "starting"
	PhaseRunning    = "running"
	PhaseRecovering = "recovering"
	PhaseStopping   = "stopping"
	PhaseStopped    = "stopped"
)

// Probe states, derived from the server's own unauthenticated health routes.
const (
	StateReady    = "ready"
	StateDegraded = "degraded"
	StateDown     = "down"
)

// Status is what the tray reads. It is written by the service (LocalSystem)
// into the machine-wide state directory, which keeps the tray free of any
// credential or privileged call.
type Status struct {
	Phase        string `json:"phase"`
	State        string `json:"state"`
	Pid          int    `json:"pid,omitempty"`
	Listener     string `json:"listener"`
	PublicBase   string `json:"publicBaseUrl,omitempty"`
	Restarts     int    `json:"restarts"`
	LastExitCode int    `json:"lastExitCode,omitempty"`
	LastError    string `json:"lastError,omitempty"`
	UpdatedAt    string `json:"updatedAt"`
}

// StatusPath is the JSON document's location inside the state directory.
func StatusPath(dataRoot string) string { return filepath.Join(dataRoot, "status.json") }

// A publication that meets a locked document waits this long between attempts,
// for this many attempts. The tray polls the same two-second cadence the service
// publishes on, so the two regularly overlap, and one collision used to cost an
// error line and one missed report.
const (
	publishAttempts = 5
	publishRetry    = 20 * time.Millisecond
)

// Publication attempts are serialized inside the service. Concurrent
// rename-over-existing operations can contend on Windows, independently
// of unique temporary filenames. External readers still use bounded retry.
var statusPublishMu sync.Mutex

// Write publishes the status atomically. A tray that caught a half-written
// document would render a broken tooltip, so the file is renamed into place.
func Write(path string, status Status) error {
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	raw, err := json.Marshal(status)
	if err != nil {
		return fmt.Errorf("encode status: %w", err)
	}
	// One temp per publication, not one shared temp name. Status changes are
	// published from several goroutines (the two-second tick, a health result, a
	// phase change), and a shared name let them collide on each other's file and
	// let a failed rename delete the file the winner was about to publish.
	temporary, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-")
	if err != nil {
		return fmt.Errorf("write status temp: %w", err)
	}
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporary.Name())
	}()
	if _, err := temporary.Write(append(raw, '\n')); err != nil {
		return fmt.Errorf("write status temp: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close status temp: %w", err)
	}
	// The retry is what makes this survive Windows. Replacing an existing file by
	// rename is refused with ERROR_ACCESS_DENIED while ANY handle to it is open —
	// measured on this machine with a handle that shared delete, so no share mode
	// chosen by a reader avoids it. The lock belongs to the reader and clears in
	// milliseconds, so the publisher waits rather than reporting a fault.
	statusPublishMu.Lock()
	defer statusPublishMu.Unlock()
	for attempt := 0; attempt < publishAttempts; attempt++ {
		err = os.Rename(temporary.Name(), path)
		if err == nil {
			return nil
		}
		if attempt != publishAttempts-1 {
			time.Sleep(publishRetry)
		}
	}
	return fmt.Errorf("publish status: %w", err)
}

// ReadStatus loads the published document for the tray and `service status`.
// A missing file is not an error: the service may simply not have started yet.
func Read(dataRoot string) (Status, error) {
	raw, err := os.ReadFile(StatusPath(dataRoot))
	if err != nil {
		return Status{}, err
	}
	status := Status{}
	if err := json.Unmarshal(raw, &status); err != nil {
		return Status{}, fmt.Errorf("parse %s: %w", StatusPath(dataRoot), err)
	}
	return status, nil
}