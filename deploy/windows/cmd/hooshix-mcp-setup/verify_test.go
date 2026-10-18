package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
)

func TestVerifyInstallerAcceptsValidBundleAndRejectsTampering(t *testing.T) {
	root := t.TempDir()
	exe := filepath.Join(root, "setup.bin")
	archive := filepath.Join(root, "payload.zip")
	candidate := filepath.Join(root, "candidate.exe")
	if err := os.WriteFile(exe, bytes.Repeat([]byte("MZ"), 100), 0o600); err != nil {
		t.Fatal(err)
	}
	zipped, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	archiveWriter := zip.NewWriter(zipped)
	fileWriter, err := archiveWriter.Create("runtime/node.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fileWriter.Write([]byte("fake-runtime-fixture")); err != nil {
		t.Fatal(err)
	}
	if err := archiveWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := zipped.Close(); err != nil {
		t.Fatal(err)
	}
	payload, err := setup.WriteBundle(exe, archive, candidate)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := verifyInstaller(candidate, &out); err != nil {
		t.Fatalf("valid payload rejected: %v", err)
	}
	if !strings.Contains(out.String(), "verified runtime payload:") {
		t.Fatalf("missing proof: %q", out.String())
	}

	// The fixture bytes are a ZIP runtime, not executable code. Modify a byte of
	// the appended archive; CRC verification must reject before installation.
	raw, err := os.ReadFile(candidate)
	if err != nil {
		t.Fatal(err)
	}
	raw[int(payload.Offset)+10] ^= 0x7f
	if err := os.WriteFile(candidate, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyInstaller(candidate, &out); err == nil {
		t.Fatal("tampered payload was accepted")
	}
}

func TestVerifyInstallerRejectsMissingPayloadWithoutInstalling(t *testing.T) {
	file := filepath.Join(t.TempDir(), "payloadless.exe")
	if err := os.WriteFile(file, []byte("MZ"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyInstaller(file, &bytes.Buffer{}); err == nil {
		t.Fatal("payloadless installer was accepted")
	}
}