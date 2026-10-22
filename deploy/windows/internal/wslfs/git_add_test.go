package wslfs

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func gitResult(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("/usr/bin/git", args...)
	c.Dir = dir
	c.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	o, e := c.CombinedOutput()
	if e != nil {
		t.Fatalf("git %v: %s %v", args, o, e)
	}
	return string(o)
}
func TestLinuxGitAddStagesRegularFilesWithoutWorkingTreeMutation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Test")
	testGit(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "existing.txt"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "existing.txt")
	testGit(t, root, "commit", "-qm", "initial")
	if err := os.WriteFile(filepath.Join(root, "existing.txt"), []byte("new\r\nvalue"), 0600); err != nil {
		t.Fatal(err)
	}
	data := []byte{0, 1, 255, 254, 42}
	if err := os.WriteFile(filepath.Join(root, "binary.bin"), data, 0600); err != nil {
		t.Fatal(err)
	}
	got := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"existing.txt", "binary.bin"}})
	if !got.OK {
		t.Fatalf("native add failed: %+v", got)
	}
	names := gitResult(t, root, "diff", "--cached", "--name-only")
	for _, name := range []string{"existing.txt", "binary.bin"} {
		if !strings.Contains(names, name) {
			t.Fatalf("%s missing in index: %q", name, names)
		}
	}
	staged := gitResult(t, root, "show", ":existing.txt")
	if staged != "new\r\nvalue" {
		t.Fatalf("staging unexpectedly used text filters: %q", staged)
	}
	cmd := exec.Command("/usr/bin/git", "show", ":binary.bin")
	cmd.Dir = root
	actual, err := cmd.Output()
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("binary content changed: %v %v", actual, err)
	}
	tree, err := os.ReadFile(filepath.Join(root, "existing.txt"))
	if err != nil || string(tree) != "new\r\nvalue" {
		t.Fatalf("git add modified worktree: %q %v", tree, err)
	}
}
func TestLinuxGitAddRejectsEscapesAndMetadataRedirects(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "init", "-q")
	if err := os.WriteFile(filepath.Join(root, "safe.txt"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "outside"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(base, "outside"), filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	for _, paths := range [][]string{
		nil, {}, {"."}, {"../outside"}, {"/etc/passwd"}, {"link"}, {"missing.txt"},
		{".git/config"}, {"safe.txt", "safe.txt"}, {"*.txt"}, {"a:1"}, {"safe.txt", "../outside"},
	} {
		got := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Paths: paths})
		if got.OK {
			t.Fatalf("invalid path selection accepted %+v", paths)
		}
	}
	if got := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Query: "--help", Paths: []string{"safe.txt"}}); got.OK {
		t.Fatal("untrusted query accepted")
	}
	if got := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"safe.txt"}, Content: "inject"}); got.OK {
		t.Fatal("unexpected content accepted")
	}
	outside, _ := os.ReadFile(filepath.Join(base, "outside"))
	if string(outside) != "secret" {
		t.Fatal("external file changed")
	}
	for _, target := range []string{".git/index", ".git/objects"} {
		t.Run(target, func(t *testing.T) {
			nested := t.TempDir()
			testGit(t, nested, "init", "-q")
			if err := os.WriteFile(filepath.Join(nested, "file.txt"), []byte("hello"), 0600); err != nil {
				t.Fatal(err)
			}
			original := filepath.Join(nested, filepath.FromSlash(target))
			if _, err := os.Lstat(original); os.IsNotExist(err) {
				if err := os.WriteFile(original, []byte("unsafe"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.RemoveAll(original); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(filepath.Join(base, "outside"), original); err != nil {
				t.Fatal(err)
			}
			result := Run(nested, Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"file.txt"}})
			if result.OK {
				t.Fatalf("redirected %s accepted: %+v", target, result)
			}
		})
	}
}

func TestLinuxGitAddDoesNotExecuteRepositoryCleanFilters(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	testGit(t, root, "init", "-q")
	testGit(t, root, "config", "user.name", "Test")
	testGit(t, root, "config", "user.email", "test@example.invalid")
	marker := filepath.Join(root, "filter-executed")
	script := filepath.Join(root, "evil-clean.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho ran > '"+marker+"'\ncat\n"), 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "config", "filter.evil.clean", script)
	if err := os.WriteFile(filepath.Join(root, ".gitattributes"), []byte("value.txt filter=evil\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "value.txt"), []byte("unfiltered"), 0600); err != nil {
		t.Fatal(err)
	}
	got := Run(root, Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"value.txt"}})
	if !got.OK {
		t.Fatalf("safe Git add failed: %+v", got)
	}
	if _, err := os.Lstat(marker); !os.IsNotExist(err) {
		t.Fatalf("repository clean filter was executed: %v", err)
	}
	if staged := gitResult(t, root, "show", ":value.txt"); staged != "unfiltered" {
		t.Fatalf("Git content unexpectedly filtered: %q", staged)
	}
}

func TestNonLinuxGitAddFailsClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Windows fail-closed")
	}
	if got := Run(t.TempDir(), Request{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"src/file.txt"}}); got.OK {
		t.Fatalf("non Linux git add succeeded %+v", got)
	}
}
