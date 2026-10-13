//go:build !windows

package svc

import "errors"

// errWindowsOnly is reported by every SCM operation off Windows. The package
// still builds there so `go vet ./...` and the unit tests run on a Linux CI
// runner, which is where most of this repository is verified.
var errWindowsOnly = errors.New("the HooshiX MCP service host is Windows-only")

// IsWindowsService reports whether this process was started by the SCM.
func IsWindowsService() bool { return false }

// RunService starts the supervisor.
func RunService(string) error { return errWindowsOnly }

// Install registers the service with SCM.
func Install(string) error { return errWindowsOnly }

// Uninstall removes the service registration.
func Uninstall() error { return errWindowsOnly }

// Start starts the service.
func Start() error { return errWindowsOnly }

// Stop stops the service.
func Stop() error { return errWindowsOnly }

// Restart stops and starts the service.
func Restart() error { return errWindowsOnly }

// QueryStatus reports the SCM state name.
func QueryStatus() (string, error) { return "", errWindowsOnly }

// ServicePid reports the process id SCM knows for the service.
func ServicePid() (int, error) { return 0, errWindowsOnly }
