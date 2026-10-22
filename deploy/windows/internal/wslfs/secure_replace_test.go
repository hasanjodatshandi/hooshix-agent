package wslfs

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func writeSHA(s string) string {
	digest := sha256.Sum256([]byte(s))
	return hex.EncodeToString(digest[:])
}
func TestLinuxWriteExistingCAS(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux confined replace")
	}
	root := t.TempDir()
	original := "before\nمتن"
	target := filepath.Join(root, "file.txt")
	if err := os.WriteFile(target, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	req := Request{Version: 1, Operation: "write_existing", Path: "file.txt", Content: "after", ExpectedSHA256: writeSHA(original)}
	got := Run(root, req)
	if !got.OK || got.SHA256 != writeSHA("after") {
		t.Fatalf("valid CAS failed %+v", got)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "after" {
		t.Fatalf("unexpected result %q %v", data, err)
	}
	if got := Run(root, req); got.OK {
		t.Fatalf("stale replay overwrote content: %+v", got)
	}
	info, err := os.Stat(target)
	if err != nil || info.Mode().Perm() != 0644 {
		t.Fatalf("original permissions not preserved: %v %v", info, err)
	}
}
func TestLinuxWriteExistingRejectsUnsafeTargets(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	outer := t.TempDir()
	root := filepath.Join(outer, "repo")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outer, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "ok.txt"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outer, "secret"), filepath.Join(root, "alias.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outer, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ name, path, expected, content string }{
		{"wrong-sha", "src/ok.txt", writeSHA("not-original"), "new"},
		{"missing-sha", "src/ok.txt", "", "new"},
		{"missing", "src/missing.txt", writeSHA("original"), "new"},
		{"symlink", "alias.txt", writeSHA("secret"), "new"},
		{"symlink-parent", "escape/secret", writeSHA("secret"), "new"},
		{"traversal", "../secret", writeSHA("secret"), "new"},
		{"sensitive", ".env", writeSHA("original"), "new"},
		{"sensitive-nested", ".git/config", writeSHA("original"), "new"},
		{"root", ".", writeSHA("original"), "new"},
		{"nul", "src/ok.txt", writeSHA("original"), "n\x00ul"},
		{"too-big", "src/ok.txt", writeSHA("original"), strings.Repeat("a", int(MaxFileBytes)+1)},
		{"unicode-invalid", "src/ok.txt", writeSHA("original"), string([]byte{0xff})},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := Run(root, Request{Version: 1, Operation: "write_existing", Path: c.path, Content: c.content, ExpectedSHA256: c.expected})
			if got.OK {
				t.Fatalf("invalid write accepted: %+v", got)
			}
		})
	}
	data, _ := os.ReadFile(filepath.Join(root, "src", "ok.txt"))
	secret, _ := os.ReadFile(filepath.Join(outer, "secret"))
	if string(data) != "original" || string(secret) != "secret" {
		t.Fatal("rejected write changed protected content")
	}
}
func TestLinuxConcurrentWriteExistingOnlyOneWins(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "target.txt"), []byte("initial"), 0600); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	got := make(chan Response, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got <- Run(root, Request{Version: 1, Operation: "write_existing", Path: "target.txt", Content: "revision-" + string(rune('a'+i)), ExpectedSHA256: writeSHA("initial")})
		}(i)
	}
	wg.Wait()
	close(got)
	passed := 0
	for v := range got {
		if v.OK {
			passed++
		}
	}
	if passed != 1 {
		t.Fatalf("expected only one CAS winner, got %d", passed)
	}
}
func TestNonLinuxWriteExistingIsDenied(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux implementation enabled")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	got := Run(root, Request{Version: 1, Operation: "write_existing", Path: "file", Content: "new", ExpectedSHA256: writeSHA("old")})
	if got.OK {
		t.Fatalf("Windows write succeeded: %+v", got)
	}
}
