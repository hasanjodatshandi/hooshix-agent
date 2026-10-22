//go:build linux

package wslfs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Simulates a transport failure after the durable Git reference CAS but
// before a broker response. This hook exists only in the in-package call;
// neither a pipe parameter nor an environment variable can activate it.
func TestLinuxGitCommitLostAckReconcilesWithoutReplay(t *testing.T) {
	root, _ := checkoutFixture(t)
	original := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("new staged content"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "tracked.txt")
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	id := "1234567890abcdef1234567890abcdef"
	calls := 0
	result, err := secureRootGitCommitWithPostCAS(workspace, "durable before ack", id,
		func(commit string) error { calls++; return errors.New("simulated lost ACK") })
	if err == nil || result.OK || result.Error != "wslgit_commit_ack_lost_after_cas" || calls != 1 {
		t.Fatalf("fault injection did not return ambiguous state: %+v %v calls=%d", result, err, calls)
	}
	durable := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	if durable == original {
		t.Fatal("simulated lost ACK lost durable commit")
	}
	if parent := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD^")); parent != original {
		t.Fatalf("commit parent changed: %q", parent)
	}
	confirmed := Run(root, Request{Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: id})
	if !confirmed.OK || confirmed.State != "applied" || confirmed.GitStdout != durable {
		t.Fatalf("read-only reconciliation did not find committed request: %+v", confirmed)
	}
	absent := Run(root, Request{Version: 1, Operation: "git_commit_reconcile", Path: ".",
		Query: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	if !absent.OK || absent.State != "unresolved" || absent.GitStdout != "" {
		t.Fatalf("unknown request must remain unresolved: %+v", absent)
	}
	if again := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".",
		Query: id, Content: "durable before ack"}); again.OK {
		t.Fatalf("replay should not produce second commit: %+v", again)
	}
	if after := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD")); after != durable {
		t.Fatal("reconciliation or replay changed HEAD")
	}
	if status := strings.TrimSpace(gitResult(t, root, "status", "--porcelain")); status != "" {
		t.Fatalf("index/worktree altered by reconciliation: %q", status)
	}
}
func TestLinuxGitCommitReconcileRejectsInvalidFrames(t *testing.T) {
	root, _ := checkoutFixture(t)
	for _, req := range []Request{
		{Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: ""},
		{Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: "aa"},
		{Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: strings.Repeat("z", 32)},
		{Version: 1, Operation: "git_commit_reconcile", Path: "tracked.txt", Query: strings.Repeat("a", 32)},
		{Version: 1, Operation: "git_commit_reconcile", Path: ".", Content: "forbidden", Query: strings.Repeat("a", 32)},
	} {
		if got := Run(root, req); got.OK {
			t.Fatalf("invalid read-only reconcile accepted: %+v", req)
		}
	}
}
func TestNonLinuxGitCommitReconcileFailsClosed(t *testing.T) {
	// Kept here for source visibility; non-Linux execution is covered by the
	// !linux implementation and separate Windows suite.
}
