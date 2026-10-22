package wslfs

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLinuxGitBranchCreateUsesPinnedRepository(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Test")
	testGit(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("branch test"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "--", "README.md")
	testGit(t, root, "commit", "-qm", "root commit")
	result := Run(root, Request{Version: 1, Operation: "git_branch", Path: ".", Query: "feature/safe-branch"})
	if !result.OK {
		t.Fatalf("branch creation failed: %+v", result)
	}
	output, err := exec.Command("/usr/bin/git", "-C", root, "branch", "--list", "feature/safe-branch").CombinedOutput()
	if err != nil || !strings.Contains(string(output), "feature/safe-branch") {
		t.Fatalf("branch missing: %q %v", output, err)
	}
	if second := Run(root, Request{Version: 1, Operation: "git_branch", Path: ".", Query: "feature/safe-branch"}); second.OK {
		t.Fatalf("replayed branch operation succeeded: %+v", second)
	}
}
func TestGitBranchRejectsUntrustedArgvAndRepoLinks(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	base := t.TempDir()
	root := filepath.Join(base, "project")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "init", "-q")
	for _, name := range []string{"", "--help", "../outside", "refs//unsafe", "ref..name", "ref.lock",
		"ref@{x}", "feature/", "space branch", "-D", "--delete", "a;touch /tmp/pwned"} {
		if res := Run(root, Request{Version: 1, Operation: "git_branch", Path: ".", Query: name}); res.OK {
			t.Fatalf("unsafe git branch accepted %q: %+v", name, res)
		}
	}
	for _, req := range []Request{
		{Version: 1, Operation: "git_branch", Path: "../outside", Query: "safe"},
		{Version: 1, Operation: "git_branch", Path: ".", Query: "safe", Content: "irrelevant"},
		{Version: 1, Operation: "git_branch", Path: ".", Query: "safe", ExpectedSHA256: strings.Repeat("a", 64)},
	} {
		if res := Run(root, req); res.OK {
			t.Fatalf("invalid Git mutation frame accepted: %+v", req)
		}
	}
	outside := filepath.Join(base, "outside-git")
	if err := os.Rename(filepath.Join(root, ".git"), outside); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	if res := Run(root, Request{Version: 1, Operation: "git_branch", Path: ".", Query: "safe-name"}); res.OK {
		t.Fatalf("symlinked git metadata mutation accepted: %+v", res)
	}
}
func TestLinuxGitBranchRejectsRedirectedRefsAndReflogs(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	for _, target := range []string{"refs/heads", "logs/refs/heads"} {
		t.Run(target, func(t *testing.T) {
			parent := t.TempDir()
			root := filepath.Join(parent, "project")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			testGit(t, root, "init", "-q")
			testGit(t, root, "config", "user.name", "Test")
			testGit(t, root, "config", "user.email", "test@example.invalid")
			if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("safe"), 0600); err != nil {
				t.Fatal(err)
			}
			testGit(t, root, "add", "file.txt")
			testGit(t, root, "commit", "-qm", "init")
			original := filepath.Join(root, ".git", filepath.FromSlash(target))
			hidden := original + ".previous"
			if err := os.Rename(original, hidden); err != nil {
				t.Fatal(err)
			}
			external := filepath.Join(parent, "external")
			if err := os.Mkdir(external, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(external, original); err != nil {
				t.Fatal(err)
			}
			got := Run(root, Request{Version: 1, Operation: "git_branch", Path: ".", Query: "safe-branch"})
			if got.OK {
				t.Fatalf("redirected Git %s accepted: %+v", target, got)
			}
			entries, err := os.ReadDir(external)
			if err != nil || len(entries) != 0 {
				t.Fatalf("wrote outside repository: %+v %v", entries, err)
			}
		})
	}
}

func TestNonLinuxGitBranchFailClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("nonlinux only")
	}
	if res := Run(t.TempDir(), Request{Version: 1, Operation: "git_branch", Path: ".", Query: "safe-branch"}); res.OK {
		t.Fatalf("nonlinux branch mutation succeeded: %+v", res)
	}
}
