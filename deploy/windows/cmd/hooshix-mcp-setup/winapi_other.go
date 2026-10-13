//go:build !windows

package main

import (
	"errors"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
)

// errWindowsOnly is what the installer says anywhere else. The payload codec,
// the archive reader and the layout it writes are tested on any runner, so the
// build stays green here while the three things this file cannot do — raise a
// UAC prompt, write a registry entry, show a dialog — stay honestly absent.
var errWindowsOnly = errors.New("the HooshiX MCP installer runs on Windows: it asks for administrator rights, records the install in the registry and shows its result")

func ensureElevated([]string) (bool, error) { return false, errWindowsOnly }

func notify(string, string, bool) {}

func registerInstall(setup.Layout, string) error { return errWindowsOnly }

func removeRegistration() error { return errWindowsOnly }
