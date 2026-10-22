package wslfs

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLinuxRootedStatDifferentiatesMissingAndExisting(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux descriptor confinement required")
	}
	outer := t.TempDir()
	root := filepath.Join(outer, "root")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "empty.txt"), []byte{}, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outer, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outer, "secret"), filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	notFound := Run(root, Request{Version: 1, Operation: "stat", Path: "new.txt"})
	if !notFound.OK || notFound.State != "absent" {
		t.Fatalf("missing target cannot be proven: %+v", notFound)
	}
	empty := Run(root, Request{Version: 1, Operation: "stat", Path: "empty.txt"})
	sha := sha256.Sum256([]byte{})
	if !empty.OK || empty.State != "present" || empty.SHA256 != hex.EncodeToString(sha[:]) {
		t.Fatalf("empty text file cannot be attested: %+v", empty)
	}
	read := Run(root, Request{Version: 1, Operation: "read", Path: "empty.txt", IncludeSHA256: true})
	if !read.OK || read.Content != "" || read.SHA256 != empty.SHA256 {
		t.Fatalf("empty read not consistent: %+v", read)
	}
	for _, path := range []string{"alias", "../secret", ".env", "missing/file.txt", "."} {
		if got := Run(root, Request{Version: 1, Operation: "stat", Path: path}); got.OK {
			t.Fatalf("unsafe or indeterminate stat accepted %s %+v", path, got)
		}
	}
}
func TestNonLinuxStatDenied(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux only")
	}
	if result := Run(t.TempDir(), Request{Version: 1, Operation: "stat", Path: "file.txt"}); result.OK {
		t.Fatalf("non-Linux stat claimed Linux confidentiality: %+v", result)
	}
}
