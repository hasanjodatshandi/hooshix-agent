package wslfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestRestoreDeletedRejectsMultipleInputFramesBeforeAnyMutation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux files only")
	}
	root := t.TempDir()
	content := "backup"
	sum := sha256.Sum256([]byte(content))
	req := Request{Version: 1, Operation: "restore_deleted", Path: "example.txt", Content: content, ExpectedSHA256: hex.EncodeToString(sum[:])}
	payload, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := Serve(root, bytes.NewReader(append(append(payload, '\n'), payload...)), &output); err == nil {
		t.Fatal("multiple restore frames accepted")
	}
	if _, err := os.Lstat(filepath.Join(root, "example.txt")); !os.IsNotExist(err) {
		t.Fatalf("rejected multi-frame request caused a mutation: %v", err)
	}
	output.Reset()
	if err := Serve(root, bytes.NewReader(append(payload, '\n')), &output); err != nil {
		t.Fatal(err)
	}
	var response Response
	if err := json.Unmarshal(output.Bytes(), &response); err != nil || !response.OK || !response.Restored {
		t.Fatalf("single frame restore rejected: %+v %v", response, err)
	}
}

func TestRestoreDeletedRecreatesOnlyAbsentTarget(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("kernel-enforced create is Linux-only")
	}
	root := t.TempDir()
	original := "original\nمتن"
	sum := sha256.Sum256([]byte(original))
	digest := hex.EncodeToString(sum[:])
	request := Request{
		Version: 1, Operation: "restore_deleted", Path: "README.md",
		Content: original, ExpectedSHA256: digest,
	}
	got := Run(root, request)
	if !got.OK || !got.Restored || got.SHA256 != digest {
		t.Fatalf("restore of deleted file failed: %+v", got)
	}
	data, err := os.ReadFile(filepath.Join(root, "README.md"))
	if err != nil || string(data) != original {
		t.Fatalf("restored data mismatch: %q %v", data, err)
	}
	// A replay is not permission to clobber the restored file.
	if got := Run(root, request); got.OK {
		t.Fatalf("restore replay overwrote target: %+v", got)
	}
	data, _ = os.ReadFile(filepath.Join(root, "README.md"))
	if string(data) != original {
		t.Fatal("restore replay corrupted bytes")
	}
}

func TestRestoreDeletedRefusesStaleAndUnsafeTargets(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux restore only")
	}
	base := t.TempDir()
	root := filepath.Join(base, "root")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "private"), []byte("TOPSECRET"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(base, "private"), filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "safe"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(base, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "safe", "existing.txt"), []byte("new edit"), 0600); err != nil {
		t.Fatal(err)
	}
	old := "previous"
	digestBytes := sha256.Sum256([]byte(old))
	digest := hex.EncodeToString(digestBytes[:])
	for _, test := range []struct{ name, path, content, expected string }{
		{"existing", "safe/existing.txt", old, digest},
		{"symlink", "alias", old, digest},
		{"escaped-parent", "escape/private", old, digest},
		{"traversal", "../private", old, digest},
		{"sensitive", ".env", old, digest},
		{"metadata", ".git/config", old, digest},
		{"root", ".", old, digest},
		{"bad-digest", "safe/new.txt", old, strings.Repeat("a", 64)},
		{"invalid-digest", "safe/new.txt", old, "bad"},
		{"oversized", "safe/new.txt", strings.Repeat("a", int(MaxFileBytes)+1), digest},
		{"binary", "safe/new.txt", "contains\x00nul", digest},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := Run(root, Request{Version: 1, Operation: "restore_deleted", Path: test.path, Content: test.content, ExpectedSHA256: test.expected})
			if got.OK {
				t.Fatalf("unsafe restore was accepted: %+v", got)
			}
		})
	}
	external, _ := os.ReadFile(filepath.Join(base, "private"))
	existing, _ := os.ReadFile(filepath.Join(root, "safe", "existing.txt"))
	if string(external) != "TOPSECRET" || string(existing) != "new edit" {
		t.Fatal("restore clobbered existing content")
	}
	if _, err := os.Lstat(filepath.Join(root, "safe", "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("invalid restore created a file: %v", err)
	}
}

func TestConcurrentRestoreDeletedHasOneWinner(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	content := "from-backup"
	sha := sha256.Sum256([]byte(content))
	req := Request{Version: 1, Operation: "restore_deleted", Path: "restored.txt", Content: content, ExpectedSHA256: hex.EncodeToString(sha[:])}
	var wg sync.WaitGroup
	outcomes := make(chan Response, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); outcomes <- Run(root, req) }()
	}
	wg.Wait()
	close(outcomes)
	successes := 0
	for r := range outcomes {
		if r.OK {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("expected one restoring writer, got %d", successes)
	}
	observed, err := os.ReadFile(filepath.Join(root, "restored.txt"))
	if err != nil || string(observed) != content {
		t.Fatalf("bad restored content: %s %v", observed, err)
	}
}

func TestNonLinuxRestoreFailsClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux broker has restore implementation")
	}
	content := "previous"
	sum := sha256.Sum256([]byte(content))
	got := Run(t.TempDir(), Request{Version: 1, Operation: "restore_deleted", Path: "x", Content: content, ExpectedSHA256: hex.EncodeToString(sum[:])})
	if got.OK {
		t.Fatalf("non-Linux restore unexpectedly succeeded: %+v", got)
	}
}
