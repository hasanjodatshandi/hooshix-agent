package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
)

func TestIsUninstallerReadsItsOwnName(t *testing.T) {
	// The Programs entry runs a copy of this program without its payload, so the
	// name is the only thing that tells the two modes apart after a double-click.
	for _, path := range []string{`C:\Program Files\HooshiX MCP\bin\uninstall.exe`, `D:\tmp\UNINSTALL.EXE`} {
		if !isUninstaller(path) {
			t.Errorf("%s was not recognised as the uninstaller", path)
		}
	}
	for _, path := range []string{`C:\Users\me\Downloads\setup.exe`, `D:\tmp\uninstall-helper.exe`} {
		if isUninstaller(path) {
			t.Errorf("%s was taken for the uninstaller", path)
		}
	}
}

func TestQuoteArgumentsKeepsOneArgumentOneArgument(t *testing.T) {
	if got, want := quoteArguments([]string{"--uninstall", "--purge-data"}), "--uninstall --purge-data"; got != want {
		t.Errorf("quoteArguments = %q, want %q", got, want)
	}
	// ShellExecute takes a single string, so an argument with a space that is not
	// quoted would arrive in the elevated copy as two.
	if got, want := quoteArguments([]string{"--base-url", "https://a b.example"}),
		`--base-url "https://a b.example"`; got != want {
		t.Errorf("quoteArguments = %q, want %q", got, want)
	}
	if got := quoteArguments(nil); got != "" {
		t.Errorf("no arguments produced %q", got)
	}
}

func TestProgressThrottlesAndReachesComplete(t *testing.T) {
	var out bytes.Buffer
	progress := reportProgress(&out)
	for done := int64(0); done <= 100; done++ {
		progress(done*1_000, 100_000)
	}
	text := out.String()
	if lines := strings.Count(text, "extracting"); lines > 25 {
		t.Errorf("a file-per-line progress of %d updates is spam, want a throttled few", lines)
	}
	if !strings.Contains(text, "100%") {
		t.Errorf("the progress never reported completion: %q", text)
	}
	if !strings.Contains(text, "MB") && !strings.Contains(text, "KB") {
		t.Errorf("the progress reports no sizes an operator can read: %q", text)
	}
}

// The two install tests below must fail before the service calls. svc.Uninstall
// and svc.Install act on the machine's real service control manager, so a test
// that gets past them would be unregistering whatever HooshiX install this
// computer is running.
func TestRunInstallRefusesAnUnassembledExecutableAndWritesNothing(t *testing.T) {
	root := t.TempDir()
	layout, err := setup.NewLayout(filepath.Join(root, "Program Files"), filepath.Join(root, "ProgramData"))
	if err != nil {
		t.Fatalf("build the layout: %v", err)
	}
	self := filepath.Join(root, "setup.exe")
	if err := os.WriteFile(self, bytes.Repeat([]byte("MZ"), 200), 0o640); err != nil {
		t.Fatalf("write a payload-less installer: %v", err)
	}

	var out bytes.Buffer
	err = runInstall(layout, self, "https://mcp.example", &out)
	if !errors.Is(err, setup.ErrNoPayload) {
		t.Fatalf("an installer with no runtime = %v, want ErrNoPayload", err)
	}
	if _, statErr := os.Stat(layout.InstallDir); statErr == nil {
		t.Errorf("the install directory %s was created even though the payload check failed", layout.InstallDir)
	}
}

func TestRunInstallRefusesAnInsecureOriginBeforeWriting(t *testing.T) {
	root := t.TempDir()
	layout, err := setup.NewLayout(filepath.Join(root, "Program Files"), filepath.Join(root, "ProgramData"))
	if err != nil {
		t.Fatalf("build the layout: %v", err)
	}

	var out bytes.Buffer
	// http:// is the mistake this flag invites: ChatGPT refuses the connector and
	// the install looks fine from the inside.
	if err := runInstall(layout, filepath.Join(root, "setup.exe"), "http://mcp.example", &out); err == nil {
		t.Fatal("an http origin was accepted")
	}
	if _, statErr := os.Stat(layout.InstallDir); statErr == nil {
		t.Error("the install directory was created even though the origin was rejected")
	}
}
