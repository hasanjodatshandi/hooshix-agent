package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

// wslWarmupBudget bounds one launcher call. Starting a distribution that is
// already running costs a few hundred milliseconds; the budget exists for the
// cold case and for a launcher that hangs, which must not stall the first spawn
// of the server indefinitely.
const wslWarmupBudget = 30 * time.Second

// wslLogOutputLimit bounds how much of the launcher's own text reaches
// service.log. The line is operator diagnostics, not a transcript.
const wslLogOutputLimit = 200

// resolveWslProgram locates the distribution launcher. SystemRoot is asked
// rather than PATH: the service starts with no interactive profile and the host
// deliberately inherits almost nothing from the machine environment.
var resolveWslProgram = func() (string, error) {
	for _, root := range []string{os.Getenv("SystemRoot"), os.Getenv("windir")} {
		if root == "" {
			continue
		}
		candidate := filepath.Join(root, "System32", "wsl.exe")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", errors.New("wsl.exe is not under System32; Windows Subsystem for Linux is not installed on this machine")
}

// launchWsl runs the launcher and returns what it printed. It is a seam so the
// behaviour around the call — which arguments, what happens on failure, what
// gets logged — is testable without a live distribution.
var launchWsl = func(ctx context.Context, program string, args ...string) (string, error) {
	output, err := exec.CommandContext(ctx, program, args...).CombinedOutput()
	return string(output), err
}

// validateWslDistro rejects a name that could turn into an extra option instead
// of a distribution. The launcher is passed as one argv element with no shell
// involved, so a space is safe, but a name that begins with a dash would be
// parsed as a flag, and a quote or a backslash cannot name a real distribution.
func validateWslDistro(name string) error {
	if name == "" {
		return errors.New("a distribution name must not be empty")
	}
	if name != strings.TrimSpace(name) {
		return fmt.Errorf("distribution name %q has surrounding spaces", name)
	}
	if strings.HasPrefix(name, "-") {
		return fmt.Errorf("distribution name %q starts with a dash", name)
	}
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune(".-_ ", r) {
			continue
		}
		return fmt.Errorf("distribution name %q contains %q, which cannot appear in one", name, r)
	}
	return nil
}

// registerWslViews asks the launcher for each configured distribution before the
// server is spawned. Windows publishes a distribution's file view under
// \\wsl.localhost only once something in the logon session has actually spoken
// to the subsystem, so a service that never asks leaves every such path looking
// like it does not exist — and because that registration is per logon session,
// a service start is always cold. Measured on this machine: the first
// existsSync of a distribution path returns false, waiting fifteen seconds
// changes nothing, and the very next call after a launcher run resolves it.
//
// Failure is logged and not fatal. The launcher's own message is what makes the
// line actionable: a service still running as local system gets
// WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED here rather than an unexplained
// workspace_path_not_found later on a client.
func (s *Supervisor) registerWslViews(ctx context.Context) {
	if len(s.settings.WslDistros) == 0 {
		return
	}
	program, err := resolveWslProgram()
	if err != nil {
		s.logger.Error("wsl file views not registered", "error", err.Error(), "distros", strings.Join(s.settings.WslDistros, ","))
		return
	}
	for _, distro := range s.settings.WslDistros {
		if ctx.Err() != nil {
			return
		}
		call, cancel := context.WithTimeout(ctx, wslWarmupBudget)
		output, err := launchWsl(call, program, "-d", distro, "-e", "pwd")
		cancel()
		if err != nil {
			s.logger.Error("wsl file view registration failed", "distro", distro, "error", err.Error(), "launcher", describeLauncherOutput(output))
			continue
		}
		s.logger.Info("wsl file view registered", "distro", distro, "launcher", describeLauncherOutput(output))
	}
}

// describeLauncherOutput reduces whatever the launcher printed to one bounded
// line for the service log.
func describeLauncherOutput(output string) string {
	return truncate(oneLine(output), wslLogOutputLimit)
}

// oneLine collapses launcher output to the single line worth keeping.
func oneLine(output string) string {
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r", ""), "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
