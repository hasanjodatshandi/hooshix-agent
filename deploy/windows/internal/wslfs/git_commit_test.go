package wslfs

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLinuxNativeGitCommitUsesCASWithoutHooks(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Workspace Owner")
	testGit(t, root, "config", "user.email", "owner@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("a"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "a.txt")
	testGit(t, root, "commit", "-qm", "First commit")
	previous := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	hook := filepath.Join(root, ".git", "hooks", "reference-transaction")
	marker := filepath.Join(base, "hook-was-run")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\ntouch '"+marker+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	staged := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"a.txt"}})
	if !staged.OK {
		t.Fatalf("staging failed: %+v", staged)
	}
	commit := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".", Content: "WSL safe commit"})
	if !commit.OK || (len(commit.GitStdout) != 40 && len(commit.GitStdout) != 64) {
		t.Fatalf("native commit failed: %+v", commit)
	}
	observed := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	if observed != commit.GitStdout {
		t.Fatalf("HEAD mismatch: %q != %q", observed, commit.GitStdout)
	}
	parent := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD^"))
	if parent != previous {
		t.Fatalf("incorrect commit parent: %q", parent)
	}
	if log := gitResult(t, root, "log", "-1", "--format=%s"); !strings.Contains(log, "WSL safe commit") {
		t.Fatalf("message mismatch %q", log)
	}
	if _, err := os.Lstat(marker); !os.IsNotExist(err) {
		t.Fatalf("reference transaction hook unexpectedly ran %v", err)
	}
	if replay := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".", Content: "WSL safe commit"}); replay.OK {
		t.Fatalf("commit replay with no staged changes succeeded: %+v", replay)
	}
}
func TestLinuxNativeGitCommitRejectsInvalidMessageAndSymlinkedRefs(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Test")
	testGit(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "a.txt")
	testGit(t, root, "commit", "-qm", "First")
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"a.txt"}}); !got.OK {
		t.Fatal(got)
	}
	for _, message := range []string{"", "  ", "with\x00nul", strings.Repeat("x", 501)} {
		if got := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".", Content: message}); got.OK {
			t.Fatalf("invalid commit message accepted: %q", message)
		}
	}
	if got := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".", Content: "ok", Query: "--unsafe"}); got.OK {
		t.Fatal("git commit accepted unknown query")
	}
	branch := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "--short", "HEAD"))
	loose := filepath.Join(root, ".git", "refs", "heads", branch)
	if err := os.Rename(loose, loose+".saved"); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "external-head")
	if err := os.WriteFile(outside, []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, loose); err != nil {
		t.Fatal(err)
	}
	if got := Run(root, Request{Version: 1, Operation: "git_commit", Path: ".", Content: "unsafe"}); got.OK {
		t.Fatalf("Git commit wrote through redirected ref: %+v", got)
	}
	content, err := os.ReadFile(outside)
	if err != nil || string(content) != "protected" {
		t.Fatal("commit changed file outside Git root")
	}
}
func TestNonLinuxGitCommitFailsClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux only")
	}
	if got := Run(t.TempDir(), Request{Version: 1, Operation: "git_commit", Path: ".", Content: "test"}); got.OK {
		t.Fatalf("non-Linux commit executed: %+v", got)
	}
}
