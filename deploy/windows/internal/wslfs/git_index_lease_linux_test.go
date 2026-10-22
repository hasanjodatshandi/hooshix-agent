//go:build linux

package wslfs

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A Git index.lock belongs to the process which created it. The broker
// must never overwrite or remove somebody else's active Git lock.
func TestLinuxGitMutationRejectsExternalIndexLock(t *testing.T) {
	root, _ := checkoutFixture(t)
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("staged"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "tracked.txt")
	old := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	lockPath := filepath.Join(root, ".git", "index.lock")
	if err := os.WriteFile(lockPath, []byte("other-writer"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, req := range []Request{
		{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"tracked.txt"}},
		{Version: 1, Operation: "git_commit", Path: ".", Content: "must fail"},
	} {
		got := Run(root, req)
		if got.OK {
			t.Fatalf("mutation bypassed external Git index lock: %+v", got)
		}
	}
	data, err := os.ReadFile(lockPath)
	if err != nil || string(data) != "other-writer" {
		t.Fatalf("external lock altered: %q %v", data, err)
	}
	if got := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD")); got != old {
		t.Fatalf("external lock protection advanced HEAD: %s != %s", got, old)
	}
}

// The staged-entry fingerprint must reject changes made between git
// write-tree and our exclusive index.lock acquisition. This test simulates
// the interleaving deterministically, without races or arbitrary sleeps.
func TestLinuxGitCommitRejectsChangedStagedEntries(t *testing.T) {
	root, _ := checkoutFixture(t)
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	pinned, err := secureRootOpen(workspace, ".")
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	before, err := runPinnedGit(pinned, []string{"ls-files", "--stage", "-z"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("concurrent staged content"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "tracked.txt")
	lease, err := acquireGitIndexLease(workspace)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if err := verifyPinnedGitStagingUnchanged(pinned, before); err == nil {
		t.Fatal("stale staged snapshot accepted after independent Git add")
	}
	if got := strings.TrimSpace(gitResult(t, root, "show", ":tracked.txt")); got != "concurrent staged content" {
		t.Fatalf("index was unexpectedly altered during check: %q", got)
	}
}

func TestLinuxGitIndexLeaseBlocksConcurrentStandardGitWriters(t *testing.T) {
	root, _ := checkoutFixture(t)
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	lease, err := acquireGitIndexLease(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireGitIndexLease(workspace); err == nil {
		t.Fatal("second writer acquired an existing exclusive Git index lock")
	}
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	// With the lock held, normal Git 'add' fails without changing index.
	cmd := exec.Command("/usr/bin/git", "add", "tracked.txt")
	cmd.Dir = root
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	if out, err := cmd.CombinedOutput(); err == nil {
		t.Fatalf("external Git add ignored index lock: %s", out)
	}
	if string(strings.TrimSpace(gitResult(t, root, "show", ":tracked.txt"))) != "original" {
		t.Fatal("Git index changed while lease held")
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(root, ".git", "index.lock")); !os.IsNotExist(err) {
		t.Fatalf("index lease not released: %v", err)
	}
	testGit(t, root, "add", "tracked.txt")
	if got := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".", Content: "safe after lock release"}); !got.OK {
		t.Fatalf("commit after lock release failed: %+v", got)
	}
}
