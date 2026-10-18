//go:build windows

// hooshix-git-worker runs in the repository owner's own Windows session.
// It is never launched as an administrator or a Windows service.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/gitworker"
)

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	options := flag.NewFlagSet("hooshix-git-worker", flag.ContinueOnError)
	options.SetOutput(os.Stderr)
	mode := options.String("mode", "", "worker, proxy, enroll or unenroll")
	root := options.String("root", "", "approved absolute repository root")
	tool := options.String("tool", "", "specific governed Git tool (proxy only)")
	if e := options.Parse(args); e != nil {
		return 2
	}
	if *root == "" {
		fmt.Fprintln(os.Stderr, "-root required")
		return 2
	}
	switch *mode {
	case "enroll":
		if *tool != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.Enroll(*root); err != nil {
			fmt.Fprintln(os.Stderr, "Git enrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "owner Git worker enrolled for current Windows user")
		return 0
	case "unenroll":
		if *tool != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.Unenroll(*root); err != nil {
			fmt.Fprintln(os.Stderr, "Git revocation:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "owner Git worker startup entry revoked")
		return 0
	case "worker":
		if *tool != "" || len(options.Args()) != 0 {
			fmt.Fprintln(os.Stderr, "worker mode does not accept Git arguments")
			return 2
		}
		if e := gitworker.Serve(*root); e != nil {
			fmt.Fprintln(os.Stderr, "Git worker:", e)
			return 1
		}
		return 0
	case "proxy":
		if *tool == "" {
			fmt.Fprintln(os.Stderr, "proxy requires -tool")
			return 2
		}
		response, e := gitworker.Proxy(*root, *tool, options.Args())
		if e != nil {
			result := gitworker.Response{ExitCode: 126, Stderr: e.Error()}
			_ = json.NewEncoder(os.Stdout).Encode(result)
			return 0
		}
		_ = json.NewEncoder(os.Stdout).Encode(response)
		return 0
	default:
		fmt.Fprintln(os.Stderr, "-mode worker|proxy|enroll|unenroll is required")
		return 2
	}
}