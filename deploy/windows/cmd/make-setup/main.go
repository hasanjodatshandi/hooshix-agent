// Command make-setup assembles the single-file HooshiX MCP installer: it packs a
// prepared runtime tree and appends it to the compiled setup executable.
//
// It is a build tool, so it runs on any operating system — the artifact it
// writes is a Windows image either way, and assembling is a byte copy. Keeping
// it separate from the installer itself means the installer carries no packing
// code and a payload-less setup.exe is always the mistake of this step, never a
// mystery at install time.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
)

func main() {
	var (
		executable = flag.String("setup", "", "path of the compiled hooshix-mcp-setup executable (required)")
		tree       = flag.String("tree", "", "directory holding runtime/, app/ and bin/ to ship (required)")
		archive    = flag.String("archive", "", "where to write the packed payload (default: <out>.zip)")
		out        = flag.String("out", "", "installer file to write (required)")
	)
	flag.Usage = usage
	flag.Parse()

	missing := []string{}
	for _, required := range []struct{ name, value string }{
		{"-setup", *executable}, {"-tree", *tree}, {"-out", *out},
	} {
		if required.value == "" {
			missing = append(missing, required.name)
		}
	}
	if len(missing) > 0 {
		fmt.Fprintln(os.Stderr, "make-setup: missing", missing)
		usage()
		os.Exit(2)
	}
	if *archive == "" {
		*archive = *out + ".zip"
	}

	// Packing is checked before anything is written so that an empty app
	// directory — the usual symptom of a build that skipped `pnpm build` — fails
	// here instead of shipping an installer that installs nothing.
	stats, err := setup.PackArchive(*tree, *archive)
	if err != nil {
		fail(err)
	}
	fmt.Printf("packed %d files (%s) into %s\n", stats.Files, setup.HumanBytes(stats.Bytes), *archive)

	payload, err := setup.WriteBundle(*executable, *archive, *out)
	if err != nil {
		fail(err)
	}
	info, err := os.Stat(*out)
	if err != nil {
		fail(fmt.Errorf("measure %s: %w", *out, err))
	}
	fmt.Printf("%s: %s with %s of runtime at offset %d, crc32 0x%08x\n",
		*out, setup.HumanBytes(info.Size()), setup.HumanBytes(payload.Size), payload.Offset, payload.Checksum)
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage: make-setup -setup <setup.exe> -tree <payload tree> -out <installer> [-archive <zip>]

Assembles [executable][runtime archive][trailer] into one double-clickable file.
The archive is kept beside the installer so a re-run can inspect what went in.`)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "make-setup:", err)
	os.Exit(1)
}
