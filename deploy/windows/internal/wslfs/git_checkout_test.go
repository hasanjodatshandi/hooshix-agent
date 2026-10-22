package wslfs

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func checkoutFixture(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "WSL Checkout Test")
	testGit(t, root, "config", "user.email", "checkout@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "tracked.txt")
	testGit(t, root, "commit", "-qm", "first")
	from := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "--short", "HEAD"))
	testGit(t, root, "branch", "safe-target")
	return root, from
}

func TestLinuxGitCheckoutSameTreeOnlyAndPreservesFiles(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux Git test")
	}
	root, oldBranch := checkoutFixture(t)
	before, err := os.ReadFile(filepath.Join(root, "tracked.txt"))
	if err != nil {
		t.Fatal(err)
	}
	req := Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "safe-target"}
	got := Run(root, req)
	if !got.OK || got.GitStdout != "safe-target" {
		t.Fatalf("safe checkout failed: %+v", got)
	}
	head := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "--short", "HEAD"))
	if head != "safe-target" {
		t.Fatalf("HEAD not changed: %q", head)
	}
	after, err := os.ReadFile(filepath.Join(root, "tracked.txt"))
	if err != nil || string(after) != string(before) {
		t.Fatalf("worktree changed on checkout %q %v", after, err)
	}
	if index := strings.TrimSpace(gitResult(t, root, "status", "--porcelain")); index != "" {
		t.Fatalf("checkout unexpectedly dirtied worktree %q", index)
	}
	if again := Run(root, req); again.OK {
		t.Fatalf("checkout replay unexpectedly accepted %+v", again)
	}
	back := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: oldBranch})
	if !back.OK {
		t.Fatalf("checkout back failed %+v", back)
	}
}

func TestLinuxGitCheckoutIdenticalTreeDifferentCommitSkipsHooks(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root, initial := checkoutFixture(t)
	testGit(t, root, "commit", "--allow-empty", "-qm", "empty commit, same tree")
	targetCommit := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	sourceCommit := strings.TrimSpace(gitResult(t, root, "rev-parse", "safe-target"))
	if targetCommit == sourceCommit {
		t.Fatal("fixture has same commit")
	}
	oldTree := strings.TrimSpace(gitResult(t, root, "rev-parse", "safe-target^{tree}"))
	newTree := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD^{tree}"))
	if oldTree != newTree {
		t.Fatal("fixture trees differ")
	}
	marker := filepath.Join(t.TempDir(), "hook-executed")
	hook := filepath.Join(root, ".git", "hooks", "reference-transaction")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\necho ran > '"+marker+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	observed := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "safe-target"})
	if !observed.OK {
		t.Fatalf("checkout differing commit with same tree denied %+v", observed)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("Git hook ran under restricted checkout: %v", err)
	}
	if branch := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "--short", "HEAD")); branch != "safe-target" {
		t.Fatalf("branch not changed %q", branch)
	}
	if before := gitResult(t, root, "show", "HEAD:tracked.txt"); before != "original" {
		t.Fatalf("worktree tracked file unexpectedly changed: %q", before)
	}
	if initial == "safe-target" {
		t.Fatal("invalid test branch setup")
	}
}

func TestLinuxGitCheckoutRejectsDifferentTreesAndDirtyOrUntracked(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux Git test")
	}
	root, initial := checkoutFixture(t)
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("new tree"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "tracked.txt")
	testGit(t, root, "commit", "-qm", "second")
	oldTree := strings.TrimSpace(gitResult(t, root, "rev-parse", "safe-target^{tree}"))
	targetTree := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD^{tree}"))
	if oldTree == targetTree {
		t.Fatal("test fixture trees match unexpectedly")
	}
	got := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "safe-target"})
	if got.OK {
		t.Fatalf("checkout changed branch despite divergent tree %+v", got)
	}
	if strings.TrimSpace(gitResult(t, root, "symbolic-ref", "--short", "HEAD")) != initial {
		t.Fatal("divergent-tree checkout changed HEAD")
	}
	testGit(t, root, "branch", "same-tree")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("uncommitted"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "same-tree"}); got.OK {
		t.Fatalf("dirty worktree checkout unexpectedly accepted: %+v", got)
	}
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("new tree"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "untracked.txt"), []byte("untracked"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "same-tree"}); got.OK {
		t.Fatalf("untracked file checkout unexpectedly accepted %+v", got)
	}
}

func TestLinuxGitCheckoutRejectsSymlinksInvalidNamesAndMetadata(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux Git test")
	}
	root, initial := checkoutFixture(t)
	base := t.TempDir()
	outside := filepath.Join(base, "external")
	if err := os.WriteFile(outside, []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, branch := range []string{"", "-D", "../outside", "refs//bad", "bad..branch", "--help", "absent", "safe-target;echo"} {
		if got := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: branch}); got.OK {
			t.Fatalf("invalid checkout %q succeeded %+v", branch, got)
		}
	}
	for _, req := range []Request{
		{Version: 1, Operation: "git_checkout", Path: "tracked.txt", Query: "safe-target"},
		{Version: 1, Operation: "git_checkout", Path: ".", Query: "safe-target", Content: "injected"},
		{Version: 1, Operation: "git_checkout", Path: ".", Query: "safe-target", Paths: []string{"tracked.txt"}},
	} {
		if got := Run(root, req); got.OK {
			t.Fatalf("unexpected checkout request accepted %+v", req)
		}
	}
	head := filepath.Join(root, ".git", "HEAD")
	if err := os.Rename(head, head+".saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, head); err != nil {
		t.Fatal(err)
	}
	if got := Run(root, Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "safe-target"}); got.OK {
		t.Fatalf("redirected HEAD was updated %+v", got)
	}
	b, _ := os.ReadFile(outside)
	if string(b) != "safe" {
		t.Fatal("Git wrote outside pinned workspace")
	}
	_ = initial
}

func TestNonLinuxGitCheckoutFailsClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Windows-side fail closed")
	}
	if got := Run(t.TempDir(), Request{Version: 1, Operation: "git_checkout", Path: ".", Query: "main"}); got.OK {
		t.Fatalf("checkout unexpectedly executed on non-Linux %+v", got)
	}
}
