package wslfs

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestLinuxDeleteExistingRevisionGuard(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	f := filepath.Join(root, "delete-me.txt")
	if err := os.WriteFile(f, []byte("snapshot"), 0600); err != nil {
		t.Fatal(err)
	}
	stale := Run(root, Request{Version: 1, Operation: "delete_existing", Path: "delete-me.txt", ExpectedSHA256: writeSHA("not-snapshot")})
	if stale.OK {
		t.Fatalf("stale revision deleted file: %+v", stale)
	}
	b, err := os.ReadFile(f)
	if err != nil || string(b) != "snapshot" {
		t.Fatalf("stale delete affected content: %q %v", b, err)
	}
	good := Run(root, Request{Version: 1, Operation: "delete_existing", Path: "delete-me.txt", ExpectedSHA256: writeSHA("snapshot")})
	if !good.OK {
		t.Fatalf("valid delete failed: %+v", good)
	}
	if _, err := os.Lstat(f); !os.IsNotExist(err) {
		t.Fatalf("file still exists: %v", err)
	}
	if result := Run(root, Request{Version: 1, Operation: "delete_existing", Path: "delete-me.txt", ExpectedSHA256: writeSHA("snapshot")}); result.OK {
		t.Fatalf("replayed delete unexpectedly succeeded: %+v", result)
	}
	// Durable pre-state restoration uses separate restore_deleted with digest.
	restored := Run(root, Request{Version: 1, Operation: "restore_deleted", Path: "delete-me.txt", Content: "snapshot", ExpectedSHA256: writeSHA("snapshot")})
	if !restored.OK {
		t.Fatalf("delete recovery failed: %+v", restored)
	}
	b, err = os.ReadFile(f)
	if err != nil || string(b) != "snapshot" {
		t.Fatalf("restore not exact %q %v", b, err)
	}
}
func TestLinuxDeleteExistingSensitiveAndSymlinks(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	outer := t.TempDir()
	root := filepath.Join(outer, "repo")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outer, "outside"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outer, "outside"), filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outer, filepath.Join(root, "parent")); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range []string{"alias", "parent/outside", "../outside", "/tmp/outside", ".env", ".git/config", "."} {
		got := Run(root, Request{Version: 1, Operation: "delete_existing", Path: candidate, ExpectedSHA256: writeSHA("private")})
		if got.OK {
			t.Fatalf("dangerous delete was accepted: %s %+v", candidate, got)
		}
	}
	b, _ := os.ReadFile(filepath.Join(outer, "outside"))
	if string(b) != "private" {
		t.Fatal("deleted file beyond workspace")
	}
}
func TestLinuxConcurrentDeleteSingleWinner(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "once.txt"), []byte("only-once"), 0600); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan Response, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- Run(root, Request{Version: 1, Operation: "delete_existing", Path: "once.txt", ExpectedSHA256: writeSHA("only-once")})
		}()
	}
	wg.Wait()
	close(results)
	winners := 0
	for res := range results {
		if res.OK {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("expected one delete winner, got %d", winners)
	}
}
func TestLinuxRestoreCreatedRejectsChangedRevision(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	target := filepath.Join(root, "created.txt")
	if err := os.WriteFile(target, []byte("created"), 0600); err != nil {
		t.Fatal(err)
	}
	stale := Run(root, Request{Version: 1, Operation: "restore_created", Path: "created.txt", ExpectedSHA256: writeSHA("old")})
	if stale.OK {
		t.Fatalf("stale undo creation succeeded: %+v", stale)
	}
	bytes, err := os.ReadFile(target)
	if err != nil || string(bytes) != "created" {
		t.Fatalf("stale restore altered content: %q %v", bytes, err)
	}
	restored := Run(root, Request{Version: 1, Operation: "restore_created", Path: "created.txt", ExpectedSHA256: writeSHA("created")})
	if !restored.OK || !restored.Restored {
		t.Fatalf("valid restore failed: %+v", restored)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("restored creation still present: %v", err)
	}
	if got := Run(root, Request{Version: 1, Operation: "restore_created", Path: "created.txt", ExpectedSHA256: writeSHA("created")}); got.OK {
		t.Fatalf("repeated restore should not delete anything: %+v", got)
	}
}

func TestLinuxModifyExistingAndRestoreModified(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	name := filepath.Join(root, "file.txt")
	before := "red red blue"
	if err := os.WriteFile(name, []byte(before), 0644); err != nil {
		t.Fatal(err)
	}
	modified := Run(root, Request{Version: 1, Operation: "modify_existing", Path: "file.txt", Query: "red", Content: "green", ExpectedSHA256: writeSHA(before)})
	if !modified.OK || modified.ReplacedOccurrences != 2 || modified.SHA256 != writeSHA("green green blue") {
		t.Fatalf("modify failed: %+v", modified)
	}
	b, _ := os.ReadFile(name)
	if string(b) != "green green blue" {
		t.Fatalf("modified content incorrect: %q", b)
	}
	if res := Run(root, Request{Version: 1, Operation: "modify_existing", Path: "file.txt", Query: "missing", Content: "x", ExpectedSHA256: writeSHA(string(b))}); res.OK {
		t.Fatalf("not-found replace unexpectedly succeeded: %+v", res)
	}
	if res := Run(root, Request{Version: 1, Operation: "restore_modified", Path: "file.txt", Content: before, ExpectedSHA256: writeSHA("green green blue"), RestoredSHA256: writeSHA("wrong")}); res.OK {
		t.Fatalf("corrupted snapshot unexpectedly restored: %+v", res)
	}
	restored := Run(root, Request{Version: 1, Operation: "restore_modified", Path: "file.txt", Content: before, ExpectedSHA256: writeSHA("green green blue"), RestoredSHA256: writeSHA(before)})
	if !restored.OK || !restored.Restored || restored.SHA256 != writeSHA(before) {
		t.Fatalf("restore failed %+v", restored)
	}
	b, _ = os.ReadFile(name)
	if string(b) != before {
		t.Fatalf("restored contents incorrect: %q", b)
	}
	if again := Run(root, Request{Version: 1, Operation: "restore_modified", Path: "file.txt", Content: before, ExpectedSHA256: writeSHA("green green blue"), RestoredSHA256: writeSHA(before)}); again.OK {
		t.Fatalf("replayed restore should be stale: %+v", again)
	}
}
func TestLinuxModifySizeConflictAndStageHidden(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "src.txt"), []byte("a"), 0600); err != nil {
		t.Fatal(err)
	}
	tests := []Request{
		{Version: 1, Operation: "modify_existing", Path: "src.txt", Query: "a", Content: "x", ExpectedSHA256: writeSHA("wrong")},
		{Version: 1, Operation: "modify_existing", Path: "src.txt", Query: "", Content: "x", ExpectedSHA256: writeSHA("a")},
		{Version: 1, Operation: "modify_existing", Path: "src.txt", Query: "a", Content: strings.Repeat("x", int(MaxFileBytes)+1), ExpectedSHA256: writeSHA("a")},
		{Version: 1, Operation: "modify_existing", Path: "src.txt", Query: "a", Content: "x", ExpectedSHA256: ""},
	}
	for _, req := range tests {
		if got := Run(root, req); got.OK {
			t.Fatalf("unsafe modify succeeded %+v", got)
		}
	}
	b, _ := os.ReadFile(filepath.Join(root, "src.txt"))
	if string(b) != "a" {
		t.Fatal("unsafe modify changed original")
	}
	stage := ".hooshix-wsl-stage-private"
	if err := os.WriteFile(filepath.Join(root, stage), []byte("not visible"), 0600); err != nil {
		t.Fatal(err)
	}
	listed := Run(root, Request{Version: 1, Operation: "list", Path: "."})
	for _, name := range listed.Entries {
		if name == stage {
			t.Fatal("transaction staging visible in list")
		}
	}
	found := Run(root, Request{Version: 1, Operation: "search", Path: ".", Query: "not visible"})
	if !found.OK || len(found.Matches) != 0 {
		t.Fatalf("transaction stage exposed in search %+v", found)
	}
	if got := Run(root, Request{Version: 1, Operation: "read", Path: stage}); got.OK {
		t.Fatal("transaction stage was directly readable")
	}
}
func TestNonLinuxDangerousOperationsFailClosed(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("only non-Linux")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"modify_existing", "delete_existing", "restore_modified"} {
		got := Run(root, Request{Version: 1, Operation: op, Path: "file.txt", Query: "before", Content: "after", ExpectedSHA256: writeSHA("before"), RestoredSHA256: writeSHA("after")})
		if got.OK {
			t.Fatalf("nonlinux unsafe mutation succeeded for %s", op)
		}
	}
}
