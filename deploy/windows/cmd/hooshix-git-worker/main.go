//go:build windows

// Windows-only owner session Git worker. This is not an MCP server.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/gitworker"
	"os"
)

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	f := flag.NewFlagSet("hooshix-git-worker", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	mode := f.String("mode", "", "worker, proxy, enroll or unenroll")
	root := f.String("root", "", "approved absolute Windows repository root")
	tool := f.String("tool", "", "governed Windows Git tool")
	if err := f.Parse(args); err != nil {
		return 2
	}
	if *root == "" {
		fmt.Fprintln(os.Stderr, "-root required")
		return 2
	}
	switch *mode {
	case "enroll":
		if *tool != "" || len(f.Args()) != 0 {
			return 2
		}
		if err := gitworker.Enroll(*root); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "Windows owner Git worker enrolled")
		return 0
	case "unenroll":
		if *tool != "" || len(f.Args()) != 0 {
			return 2
		}
		if err := gitworker.Unenroll(*root); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "Windows owner Git worker revoked")
		return 0
	case "worker":
		if *tool != "" || len(f.Args()) != 0 {
			return 2
		}
		if err := gitworker.Serve(*root); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	case "proxy":
		if *tool == "" {
			fmt.Fprintln(os.Stderr, "proxy requires -tool")
			return 2
		}
		response, err := gitworker.Proxy(*root, *tool, f.Args())
		if err != nil {
			response = gitworker.Response{ExitCode: 126, Stderr: err.Error()}
		}
		_ = json.NewEncoder(os.Stdout).Encode(response)
		return 0
	default:
		fmt.Fprintln(os.Stderr, "-mode worker|proxy|enroll|unenroll is required")
		return 2
	}
}
