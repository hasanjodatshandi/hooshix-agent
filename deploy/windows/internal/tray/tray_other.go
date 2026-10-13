//go:build !windows

package tray

import "errors"

// ErrAlreadyRunning is never produced off Windows, but it is part of the
// package's contract and the command's exit-code mapping refers to it.
var ErrAlreadyRunning = errors.New("another HooshiX tray icon is already running")

// Run exists so the tray package compiles and its cross-platform logic is
// testable on the CI runner. The notification area itself is a Windows concept.
func Run(string) error {
	return errors.New("the HooshiX MCP tray is Windows-only")
}
