package gitworker

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateScopedCommands(t *testing.T) {
	root := t.TempDir()
	resolved, err := CanonicalRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	good := []Request{
		{1, "git_status", root, []string{"status", "--porcelain=v1", "--branch"}},
		{1, "git_diff", root, []string{"diff", "--cached", "--"}},
		{1, "git_log", root, []string{"log", "--max-count=20", "--oneline", "--decorate"}},
		{1, "git_commit", root, []string{"commit", "-m", "test"}},
		{1, "git_checkout", root, []string{"switch", "-c", "task/new-branch"}},
		{1, "git_add", root, []string{"add", "--", "src/one.go"}},
	}
	for _, req := range good {
		if e := Validate(req, resolved); e != nil {
			t.Errorf("%s: %v", req.Tool, e)
		}
	}
	bad := []Request{
		{1, "git_status", filepath.Join(root, "outside"), []string{"status", "--porcelain=v1", "--branch"}},
		{1, "exec", root, []string{"cmd.exe", "/c", "whoami"}},
		{1, "git_status", root, []string{"-c", "safe.directory=*", "status"}},
		{1, "git_add", root, []string{"add", "--", "../secret"}},
		{1, "git_add", root, []string{"add", "--", ":(glob)**"}},
		{1, "git_add", root, []string{"add", "--", "C:\\Windows\\system.ini"}},
		{1, "git_commit", root, []string{"commit", "--exec-path"}},
		{1, "git_log", root, []string{"log", "--max-count=9999", "--oneline", "--decorate"}},
		{2, "git_status", root, []string{"status", "--porcelain=v1", "--branch"}},
	}
	for _, req := range bad {
		if e := Validate(req, resolved); e == nil {
			t.Errorf("accepted %+v", req)
		}
	}
}

func TestPipeNameStableAndRootResolution(t *testing.T) {
	a := t.TempDir()
	root, err := CanonicalRoot(a)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(PipeName(root), `\\.\pipe\HooshiXGitWorker-`) {
		t.Fatalf("bad pipe: %s", PipeName(root))
	}
	if PipeName(root) != PipeName(strings.ToUpper(root)) {
		t.Fatal("pipe identity is not case independent")
	}
	if _, err := CanonicalRoot(filepath.Join(a, "absent")); err == nil {
		t.Fatalf("expected missing root: %v", err)
	}
}