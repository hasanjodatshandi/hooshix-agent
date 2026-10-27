package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRetiredLinuxPayloadCleanupOnlyTouchesHistoricalNames(t *testing.T) {
	root := t.TempDir()
	for _, rel := range retiredLinuxPayload {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("historical"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	kept := []string{"bin/hooshix-git-worker.exe", "bin/hooshix-mcp-service.exe", "app/LICENSE", "tools/keep-customer-file.txt"}
	for _, rel := range kept {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("preserved"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := removeRetiredLinuxPayload(root); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range retiredLinuxPayload {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("retired file %s remains: %v", rel, err)
		}
	}
	for _, rel := range kept {
		p := filepath.Join(root, filepath.FromSlash(rel))
		b, err := os.ReadFile(p)
		if err != nil || string(b) != "preserved" {
			t.Fatalf("other file %s was damaged: %v", rel, err)
		}
	}
}

func TestRetiredLinuxPayloadCleanupFailsClosedOnUnexpectedDirectory(t *testing.T) {
	root := t.TempDir()
	filename := filepath.Join(root, "bin", "hooshix-wsl-fs-broker-linux-amd64")
	if err := os.MkdirAll(filename, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filename, "user-data"), []byte("must not delete"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removeRetiredLinuxPayload(root); err == nil {
		t.Fatal("unexpected existing directory must not be removed")
	}
	if _, err := os.Stat(filepath.Join(filename, "user-data")); err != nil {
		t.Fatalf("user file damaged: %v", err)
	}
}
