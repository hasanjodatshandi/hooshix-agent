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

func TestLinuxAtomicCreateConfinedAndExclusive(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires Linux openat2 and O_TMPFILE")
	}
	base := t.TempDir()
	root := filepath.Join(base, "project")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "outside"), []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(base, filepath.Join(root, "redirect")); err != nil {
		t.Fatal(err)
	}
	payload := "سلام WSL\natomic"
	sum := sha256.Sum256([]byte(payload))
	result := Run(root, Request{Version: 1, Operation: "create", Path: "src/new.txt", Content: payload})
	if !result.OK || !result.Created || result.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("valid create: %+v", result)
	}
	actual, err := os.ReadFile(filepath.Join(root, "src/new.txt"))
	if err != nil || string(actual) != payload {
		t.Fatalf("unexpected new file %q, %v", actual, err)
	}
	if result := Run(root, Request{Version: 1, Operation: "create", Path: "src/new.txt", Content: "overwrite"}); result.OK {
		t.Fatalf("create must never overwrite: %+v", result)
	}
	original, _ := os.ReadFile(filepath.Join(root, "src/new.txt"))
	if string(original) != payload {
		t.Fatal("target was overwritten")
	}
	for _, candidate := range []string{"../outside", "redirect/outside", ".env", "src/../outside", "src/new.pem", ".git/config", "."} {
		if got := Run(root, Request{Version: 1, Operation: "create", Path: candidate, Content: "secret"}); got.OK {
			t.Fatalf("unsafe create succeeded for %q: %+v", candidate, got)
		}
	}
	if got := Run(root, Request{Version: 1, Operation: "create", Path: "missing/child.txt", Content: "data"}); got.OK {
		t.Fatalf("unapproved parent creation succeeded: %+v", got)
	}
	if got := Run(root, Request{Version: 1, Operation: "create", Path: "src/oversized.txt", Content: strings.Repeat("x", int(MaxFileBytes)+1)}); got.OK {
		t.Fatalf("oversized write was accepted: %+v", got)
	}
	if got := Run(root, Request{Version: 1, Operation: "create", Path: "src/binary.txt", Content: "invalid\x00binary"}); got.OK {
		t.Fatalf("NUL file content accepted: %+v", got)
	}
	outside, _ := os.ReadFile(filepath.Join(base, "outside"))
	if string(outside) != "protected" {
		t.Fatal("write escaped root")
	}
}

func TestLinuxConcurrentCreateHasSingleWinner(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires Linux openat2")
	}
	root := t.TempDir()
	const concurrent = 8
	var wg sync.WaitGroup
	results := make(chan Response, concurrent)
	for i := 0; i < concurrent; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- Run(root, Request{Version: 1, Operation: "create", Path: "unique.txt", Content: "test"})
		}()
	}
	wg.Wait()
	close(results)
	winners := 0
	for result := range results {
		if result.OK {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("expected one atomic create, got %d", winners)
	}
	contents, err := os.ReadFile(filepath.Join(root, "unique.txt"))
	if err != nil || string(contents) != "test" {
		t.Fatalf("file damaged: %q, %v", contents, err)
	}
}

func TestNonLinuxMutationUnavailable(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux implements secure create")
	}
	result := Run(t.TempDir(), Request{Version: 1, Operation: "create", Path: "x", Content: "test"})
	if result.OK {
		t.Fatalf("non-Linux build performed mutation: %+v", result)
	}
}
