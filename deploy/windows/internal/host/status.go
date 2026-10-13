package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	// A fixed temp name is enough: one service process owns this document, and
	// a leftover from a killed predecessor is always overwritten before rename.
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o640); err != nil {
		return fmt.Errorf("write status temp: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("publish status: %w", err)
	}
	return nil
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
