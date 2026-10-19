//go:build linux

package main

import (
	"flag"
	"fmt"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
	"os"
)

func main() {
	root := flag.String("root", "", "exact Linux root pinned by owner-session Windows worker")
	flag.Parse()
	if *root == "" || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "invalid wslfs arguments")
		os.Exit(2)
	}
	if err := wslfs.Serve(*root, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "invalid wslfs protocol")
		os.Exit(1)
	}
}