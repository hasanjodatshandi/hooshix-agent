package wslfs

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSafePathRejectsEscapes(t *testing.T) {
	for _, s := range []string{"../x", "foo/../x", "/etc/passwd", "a//b", "a/./b", "a\\b", "a:b", "foo\x00bar"} {
		if _, err := SafePath(s); err == nil {
			t.Fatalf("accepted escape %q", s)
		}
	}
	for _, s := range []string{".", "subdir/file.txt", "abc"} {
		if _, err := SafePath(s); err != nil {
			t.Fatalf("rejected %q %v", s, err)
		}
	}
}
func TestRootedReadsAndSymlinkEscape(t *testing.T) {
	outer := t.TempDir()
	root := filepath.Join(outer, "project")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("hello\nworld"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outer, "private.txt"), []byte("TOPSECRET"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outer, "private.txt"), filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("PROTECTED"), 0600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		path string
		ok   bool
	}{
		{"README.md", true}, {"escape", false}, {"../private.txt", false},
		{".env", false}, {"not-there", false},
	}
	for _, c := range cases {
		r := Run(root, Request{Version: 1, Operation: "read", Path: c.path, IncludeSHA256: true})
		if r.OK != c.ok {
			t.Fatalf("read %q got %+v", c.path, r)
		}
		if c.ok && (!strings.Contains(r.Content, "hello") || len(r.SHA256) != 64) {
			t.Fatalf("unexpected read %+v", r)
		}
		if strings.Contains(r.Content, "TOPSECRET") || strings.Contains(r.Content, "PROTECTED") {
			t.Fatal("data escaped")
		}
	}
	listing := Run(root, Request{Version: 1, Operation: "list", Path: "."})
	if !listing.OK || len(listing.Entries) != 1 || len(listing.DetailedEntries) != 1 || listing.DetailedEntries[0].Type != "file" {
		t.Fatalf("listing %+v", listing)
	}
	search := Run(root, Request{Version: 1, Operation: "search", Path: ".", Query: "hello"})
	if !search.OK || len(search.Matches) != 1 || search.Matches[0].Path != "README.md" {
		t.Fatalf("search %+v", search)
	}
}
func TestSymlinkAliasToSensitiveInRootIsDenied(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("never exposed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(".env", filepath.Join(root, "innocent.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, ".ssh"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".ssh", "id_rsa"), []byte("private key"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(".ssh", filepath.Join(root, "docs")); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"innocent.txt", "docs/id_rsa", ".env", ".ssh/id_rsa"} {
		result := Run(root, Request{Version: 1, Operation: "read", Path: p})
		if result.OK || strings.Contains(result.Content, "private") || strings.Contains(result.Content, "exposed") {
			t.Fatalf("sensitive symlink alias allowed for %q: %+v", p, result)
		}
	}
	names := Run(root, Request{Version: 1, Operation: "list", Path: "."})
	if !names.OK {
		t.Fatal(names)
	}
	for _, e := range names.DetailedEntries {
		if e.Name == "innocent.txt" || e.Name == "docs" || e.Name == ".env" || e.Name == ".ssh" {
			t.Errorf("sensitive item or symlink appeared in list: %q", e.Name)
		}
	}
}

func TestPinnedWorkspaceRootCannotRedirectViaSymlink(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux production broker enforces canonical roots; Windows tests use temp junctions")
	}
	dir := t.TempDir()
	root := filepath.Join(dir, "real-project")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias-project")
	if err := os.Symlink(root, alias); err != nil {
		t.Fatal(err)
	}
	if got := Run(alias, Request{Version: 1, Operation: "probe", Path: "."}); got.OK {
		t.Fatalf("symlinked root must not be granted: %+v", got)
	}
	if got := Run(root, Request{Version: 1, Operation: "probe", Path: "."}); !got.OK {
		t.Fatalf("canonical root unexpectedly rejected: %+v", got)
	}
}

func TestBinaryDataNeverLeaksThroughTextFilesOrSearch(t *testing.T) {
	root := t.TempDir()
	for name, content := range map[string][]byte{
		"nul.bin":    {'h', 'i', 0, 's', 'e', 'c', 'r', 'e', 't'},
		"broken.bin": {0xff, 0xfe, 's', 'e', 'c', 'r', 'e', 't'},
	} {
		if e := os.WriteFile(filepath.Join(root, name), content, 0600); e != nil {
			t.Fatal(e)
		}
		result := Run(root, Request{Version: 1, Operation: "read", Path: name})
		if result.OK || result.Content != "" {
			t.Fatalf("binary read exposed by broker: %+v", result)
		}
	}
	result := Run(root, Request{Version: 1, Operation: "search", Path: ".", Query: "secret"})
	if !result.OK || len(result.Matches) > 0 {
		t.Fatalf("binary content searchable: %+v", result)
	}
}

func TestVersionAndUnimplementedWritesFailClosed(t *testing.T) {
	root := t.TempDir()
	for _, r := range []Request{{Version: 2, Operation: "read", Path: "."}, {Version: 1, Operation: "write", Path: "."}, {Version: 1, Operation: "read", Path: "../x"}} {
		if got := Run(root, r); got.OK {
			t.Fatalf("unexpected permission %+v", got)
		}
	}
}