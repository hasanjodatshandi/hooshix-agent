// Command hooshix-mcp-tray shows the HooshiX MCP service in the Windows
// notification area and issues the operator's start/stop/restart commands.
//
// It is not a service and controls nothing that needs elevation: it reads the
// status the service publishes, asks SCM with the rights install time granted
// interactive users, and stops when the icon is closed — never stopping the
// service with it.
package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/tray"
)

const usage = `usage:
  hooshix-mcp-tray [-settings <path>]`

func main() {
	os.Exit(dispatch(os.Args[1:], os.Stdout, os.Stderr))
}

func dispatch(args []string, stdout, stderr *os.File) int {
	settingsPath := ""
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "-h", "--help", "help":
			fmt.Fprintln(stdout, usage)
			return 0
		case "-settings":
			if index+1 >= len(args) {
				fmt.Fprintln(stderr, "-settings needs a path")
				return 2
			}
			index++
			settingsPath = args[index]
		default:
			fmt.Fprintf(stderr, "unknown argument %q\n%s\n", args[index], usage)
			return 2
		}
	}
	err := tray.Run(settingsPath)
	switch {
	case err == nil:
		return 0
	case errors.Is(err, tray.ErrAlreadyRunning):
		// A second icon for the same session is not a failure: the first one
		// stays, and a logon task racing a manual launch must not look broken.
		return 0
	default:
		fmt.Fprintf(stderr, "tray: %v\n", err)
		return 1
	}
}
