package wslfs

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("/usr/bin/git", args...)
	cmd.Dir = dir
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed %s %v", args, out, err)
	}
}
func TestLinuxNativeReadOnlyGitUsesPinnedRoot(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires Linux owner git")
	}
	root := t.TempDir()
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Test Owner")
	testGit(t, root, "config", "user.email", "owner@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello\n"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "--", "hello.txt")
	testGit(t, root, "commit", "-qm", "First commit")
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello\nmodified\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ op, query, contains string }{
		{"git_status", "", "hello.txt"},
		{"git_diff", "", "modified"},
		{"git_diff", "staged", ""},
		{"git_log", "5", "First commit"},
	} {
		got := Run(root, Request{Version: 1, Operation: tc.op, Path: ".", Query: tc.query})
		if !got.OK || !strings.Contains(got.GitStdout, tc.contains) {
			t.Fatalf("%s query %q result: %+v", tc.op, tc.query, got)
		}
	}
	if _, err := os.Stat(filepath.Join(root, ".git", "index.lock")); !os.IsNotExist(err) {
		t.Fatalf("Git read unexpectedly held index.lock: %v", err)
	}
}
func TestNativeReadOnlyGitRejectsUnsafeArgumentsAndRepositoryLinks(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	outer := t.TempDir()
	root := filepath.Join(outer, "repo")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "init", "-q")
	for _, tc := range []Request{
		{Version: 1, Operation: "git_status", Path: "src"},
		{Version: 1, Operation: "git_status", Path: ".", Query: "--help"},
		{Version: 1, Operation: "git_diff", Path: ".", Query: "--ext-diff"},
		{Version: 1, Operation: "git_log", Path: ".", Query: "9999"},
		{Version: 1, Operation: "git_log", Path: ".", Query: "5;rm -rf /"},
		{Version: 1, Operation: "git_commit", Path: ".", Query: "unsafe"},
	} {
		got := Run(root, tc)
		if got.OK {
			t.Fatalf("git operation accepted unsafe frame %+v", tc)
		}
	}
	moved := filepath.Join(outer, "realgit")
	if err := os.Rename(filepath.Join(root, ".git"), moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(moved, filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	if got := Run(root, Request{Version: 1, Operation: "git_status", Path: "."}); got.OK {
		t.Fatalf("linked .git metadata crossed root: %+v", got)
	}
}
func TestNativeGitIgnoresUntrustedExternalWorktreeAndCommands(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux owner broker only")
	}
	base := t.TempDir()
	root := filepath.Join(base, "project")
	outside := filepath.Join(base, "outside")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(outside, 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Test")
	testGit(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("root\n"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "--", "tracked.txt")
	testGit(t, root, "commit", "-qm", "pinned-root")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("root\nupdated\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "sensitive.txt"), []byte("NEVER-READ"), 0600); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(base, "external-command-executed")
	script := filepath.Join(base, "external.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho executed > "+marker+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "config", "core.worktree", outside)
	testGit(t, root, "config", "core.fsmonitor", script)
	testGit(t, root, "config", "diff.external", script)
	for _, op := range []string{"git_status", "git_diff"} {
		got := Run(root, Request{Version: 1, Operation: op, Path: "."})
		if !got.OK || !strings.Contains(got.GitStdout, "tracked.txt") {
			t.Fatalf("pinned-root Git %s should find tracked.txt: %+v", op, got)
		}
		if strings.Contains(got.GitStdout, "NEVER-READ") {
			t.Fatalf("Git %s exposed file outside workspace", op)
		}
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("external repo helper ran: %v", err)
	}
}

func TestNonLinuxGitReadFailClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux only")
	}
	if got := Run(t.TempDir(), Request{Version: 1, Operation: "git_status", Path: "."}); got.OK {
		t.Fatalf("native Linux git unexpectedly executed on Windows: %+v", got)
	}
}
