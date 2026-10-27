package setup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestStagedInstallerPayload is an opt-in real-installer, no-elevation
// integration test. It never touches the service, registry or ProgramData.
func TestStagedInstallerPayload(t *testing.T) {
	source := os.Getenv("HOOSHIX_STAGING_INSTALLER")
	if source == "" {
		t.Skip("set HOOSHIX_STAGING_INSTALLER to an actual new installer")
	}
	source, err := filepath.Abs(source)
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	payload, err := Locate(f)
	if err != nil {
		t.Fatalf("installer trailer/CRC invalid: %v", err)
	}

	sandbox := t.TempDir()
	dataRoot := filepath.Join(sandbox, "existing-data")
	if err = os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dataRoot, "existing-data-unchanged.txt")
	if err = os.WriteFile(sentinel, []byte("preserved"), 0o600); err != nil {
		t.Fatal(err)
	}
	stage := filepath.Join(sandbox, "isolated-program-files")
	n, err := ExtractArchive(f, payload, stage, nil)
	if err != nil {
		t.Fatalf("non-elevated staged extraction failed: %v", err)
	}
	if n < 4 {
		t.Fatalf("suspiciously small staged payload: %d files", n)
	}
	for _, rel := range []string{
		"runtime/node.exe",
		"app/dist/index-http.js",
		"bin/hooshix-mcp-service.exe",
		"bin/hooshix-git-worker.exe",
	} {
		path := filepath.Join(stage, filepath.FromSlash(rel))
		info, e := os.Stat(path)
		if e != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			t.Fatalf("missing/invalid packed runtime file %s: %v", rel, e)
		}
	}
	if _, err = os.Stat(filepath.Join(stage, ".git")); !os.IsNotExist(err) {
		t.Fatal("VCS metadata must never enter installer payload")
	}
	// Execute the exact Node runtime the installer would place under Program Files.
	runtimeBin := filepath.Join(stage, "runtime", "node.exe")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, runtimeBin, "--version")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("embedded Node cannot start: %v %s", err, output)
	}
	expected, err := os.ReadFile(filepath.Join("..", "..", "..", "..", ".nvmrc"))
	if err != nil {
		t.Fatalf("read runtime pin: %v", err)
	}
	if strings.TrimSpace(string(output)) != "v"+strings.TrimSpace(string(expected)) {
		t.Fatalf("runtime version mismatch: got %q expected %q", strings.TrimSpace(string(output)), strings.TrimSpace(string(expected)))
	}
	// The worker is a real Windows EXE, but no enrollment has occurred.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel2()
	worker := exec.CommandContext(ctx2, filepath.Join(stage, "bin", "hooshix-git-worker.exe"),
		"-mode", "proxy", "-root", stage, "-tool", "git_status", "--", "status", "--porcelain=v1", "--branch")
	output, err = worker.CombinedOutput()
	if err != nil {
		t.Fatalf("bundled Git worker cannot execute: %v %s", err, output)
	}
	var response struct {
		ExitCode int    `json:"exitCode"`
		Stderr   string `json:"stderr"`
	}
	if err = json.Unmarshal(output, &response); err != nil {
		t.Fatalf("invalid worker response: %v %q", err, output)
	}
	if response.ExitCode != 126 || !strings.Contains(response.Stderr, "offline") {
		t.Fatalf("un-enrolled worker did not fail closed: %+v", response)
	}
	// Corrupt a *copy* of the actual installer. Validation must reject it
	// before any install or write into a destination can take place.
	tampered := filepath.Join(sandbox, "corrupted-copy.exe")
	original, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	copy, err := os.Create(tampered)
	if err != nil {
		original.Close()
		t.Fatal(err)
	}
	if _, err = io.Copy(copy, original); err != nil {
		original.Close()
		copy.Close()
		t.Fatal(err)
	}
	original.Close()
	corruptByte := []byte{0}
	if _, err = copy.ReadAt(corruptByte, payload.Offset+10); err != nil {
		copy.Close()
		t.Fatal(err)
	}
	corruptByte[0] ^= 0xff
	if _, err = copy.WriteAt(corruptByte, payload.Offset+10); err != nil {
		copy.Close()
		t.Fatal(err)
	}
	if err = copy.Close(); err != nil {
		t.Fatal(err)
	}
	broken, err := os.Open(tampered)
	if err != nil {
		t.Fatal(err)
	}
	_, err = Locate(broken)
	broken.Close()
	if err == nil {
		t.Fatal("tampered installer unexpectedly passed CRC verification")
	}
	if _, err = os.Stat(filepath.Join(sandbox, "corrupt-install")); !os.IsNotExist(err) {
		t.Fatal("corrupted archive created an install directory")
	}
	saved, err := os.ReadFile(sentinel)
	if err != nil || string(saved) != "preserved" {
		t.Fatalf("operator data was modified by staging smoke: %v", err)
	}
	t.Log(fmt.Sprintf("staging smoke: extracted %d files, verified runtime pin, owner worker fail-closed and tamper rejection", n))
}
