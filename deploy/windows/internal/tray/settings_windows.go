//go:build windows

package tray

import (
	"errors"
	"net/url"
	"os/exec"
	"strings"
)

// Tray receives the public HTTPS origin from the service's read-only status
// document. It never reads the local application settings or makes HTTP calls.
func settingsPageURL(raw string) (string, error) {
	origin := strings.TrimSpace(raw)
	parsed, err := url.Parse(origin)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
		return "", errors.New("a plain HTTPS public origin is required for Windows settings")
	}
	// Fail closed on any casing or default-port spelling of the shared
	// project hostname. It is not assigned to a customer's installation.
	if strings.EqualFold(parsed.Hostname(), "mcp.hooshix-agent.ir") {
		return "", errors.New("set your own HTTPS origin before opening settings; see Program Files\\HooshiX MCP\\app\\QUICKSTART.txt")
	}
	return strings.TrimSuffix(parsed.String(), "/") + "/operator/settings", nil
}
func (app *App) openSettings() {
	snapshot := app.snapshot()
	if !snapshot.Published || snapshot.Stale {
		app.report("Open settings", errors.New("Windows service status is unavailable"))
		return
	}
	address, err := settingsPageURL(snapshot.PublicBaseURL)
	if err != nil {
		app.report("Open settings", err)
		return
	}
	proc := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", address)
	if err := proc.Start(); err != nil {
		app.report("Open settings", err)
		return
	}
	go func() { _ = proc.Wait() }()
}
