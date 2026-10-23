package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This regression is about fail-closed behavior on the *installed* Git/WSL
// worker binary, not about registering or terminating the owner's processes.
func TestWorkerIdlePreflight(t *testing.T) {
	layout := Layout{BinDir: filepath.Join(t.TempDir(), "bin")}
	if err := layout.CheckWorkerIdle(); err != nil {
		t.Fatalf("fresh install should be allowed: %v", err)
	}
	if err := os.MkdirAll(layout.BinDir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(layout.WorkerBinary(), []byte("not-running"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := layout.CheckWorkerIdle(); err != nil {
		t.Fatalf("an idle executable must not block upgrade: %v", err)
	}

	// A directory in place of the image is a portable stand-in for an EXE
	// that Windows refuses to open for overwrite while running.
	if err := os.Remove(layout.WorkerBinary()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(layout.WorkerBinary(), 0o750); err != nil {
		t.Fatal(err)
	}
	err := layout.CheckWorkerIdle()
	if err == nil || !strings.Contains(err.Error(), "service and files were not changed") {
		t.Fatalf("expected actionable, pre-mutation busy-worker refusal; got %v", err)
	}
}

func TestInstallerChecksOwnerWorkerBeforeServiceStopOrExtraction(t *testing.T) {
	mainPath := filepath.Join("..", "..", "cmd", "hooshix-mcp-setup", "main.go")
	raw, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)
	preflight := strings.Index(src, "layout.CheckWorkerIdle()")
	stop := strings.Index(src, "svc.PrepareForUpgrade(")
	extract := strings.Index(src, "setup.ExtractArchive(")
	if preflight < 0 || stop < 0 || extract < 0 || preflight >= stop || preflight >= extract {
		t.Fatalf("worker image must be checked before SCM stop and extraction (worker=%d stop=%d extract=%d)", preflight, stop, extract)
	}
}
