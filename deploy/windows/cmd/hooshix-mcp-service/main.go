// Command hooshix-mcp-service installs, controls and runs the HooshiX MCP
// Windows service.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/svc"
)

const usage = `usage:
  hooshix-mcp-service service <install|uninstall|start|stop|restart|status|run-service> [-settings <path>]
  hooshix-mcp-service status [-settings <path>]`

func main() {
	os.Exit(dispatch(os.Args[1:], os.Stdout, os.Stderr))
}

func dispatch(args []string, stdout, stderr *os.File) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	switch args[0] {
	case "service":
		return serviceMain(args[1:], stdout, stderr)
	case "status":
		return statusMain(flagValue(args[1:], "-settings"), stdout, stderr)
	case "-h", "--help", "help":
		fmt.Fprintln(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown command %q\n%s\n", args[0], usage)
		return 2
	}
}

func serviceMain(args []string, stdout, stderr *os.File) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	sub, rest := args[0], args[1:]
	settingsPath := flagValue(rest, "-settings")

	var err error
	switch sub {
	case "install":
		executable, execErr := os.Executable()
		if execErr != nil {
			err = fmt.Errorf("resolve own executable: %w", execErr)
			break
		}
		// The registered image path carries no --settings argument: the state
		// directory is machine-wide and is resolved from ProgramData at start,
		// so moving or renaming a data volume cannot orphan the service.
		err = svc.Install(executable)
	case "uninstall":
		err = svc.Uninstall()
	case "start":
		err = svc.Start()
	case "stop":
		err = svc.Stop()
	case "restart":
		err = svc.Restart()
	case "status":
		var state string
		if state, err = svc.QueryStatus(); err == nil {
			fmt.Fprintf(stdout, "service status: %s\n", state)
		}
	case "run-service":
		err = svc.RunService(settingsPath)
	default:
		err = fmt.Errorf("unknown service subcommand: %s", sub)
	}
	return report(stderr, "service", err)
}

// statusMain reports the two independent facts the tray renders: what SCM
// believes about the service, and what the service published about the server.
func statusMain(settingsPath string, stdout, stderr *os.File) int {
	dataRoot := dataRootFromSettings(settingsPath)
	state, queryErr := svc.QueryStatus()
	if queryErr != nil {
		fmt.Fprintf(stderr, "service: %v\n", queryErr)
	} else {
		fmt.Fprintf(stdout, "service: %s\n", state)
	}
	if dataRoot == "" {
		fmt.Fprintln(stderr, "status: ProgramData is unavailable, so no state directory is known")
		return 1
	}
	status, readErr := host.Read(dataRoot)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			fmt.Fprintln(stdout, "server: no status.json yet (the service has not published one)")
			return boolExitCode(queryErr)
		}
		fmt.Fprintf(stderr, "server: %v\n", readErr)
		return 1
	}
	fmt.Fprintf(stdout, "server: phase=%s state=%s pid=%d restarts=%d listener=%s\n",
		status.Phase, status.State, status.Pid, status.Restarts, status.Listener)
	if status.LastError != "" {
		fmt.Fprintf(stdout, "last error: %s (exit %d)\n", status.LastError, status.LastExitCode)
	}
	return boolExitCode(queryErr)
}

func boolExitCode(err error) int {
	if err != nil {
		return 1
	}
	return 0
}

// dataRootFromSettings resolves where status.json lives. Reading status has to
// work even when the settings document is broken — that is exactly the state an
// operator needs diagnostics in — so a load failure falls back to the directory
// the document sits in, which is the machine-wide state directory by contract.
func dataRootFromSettings(settingsPath string) string {
	if settingsPath == "" {
		if defaultPath, err := host.DefaultSettingsPath(); err == nil {
			settingsPath = defaultPath
		}
	}
	if settingsPath == "" {
		return ""
	}
	if settings, err := host.LoadSettings(settingsPath); err == nil {
		return settings.DataRoot
	}
	return filepath.Dir(settingsPath)
}

// flagValue extracts "-flag value" from a flat argument list.
func flagValue(args []string, name string) string {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == name {
			return args[index+1]
		}
	}
	return ""
}

func report(stderr *os.File, area string, err error) int {
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", area, err)
		return 1
	}
	return 0
}
