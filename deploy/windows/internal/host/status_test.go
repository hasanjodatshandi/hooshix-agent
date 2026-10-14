package host

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// The two Windows cases exist because the lock they reproduce is a property of
// the platform: replacing an existing file by rename is refused while any handle
// to it is open, which no share mode of the reader avoids.

func TestStatusWritePublishesADocumentAndCleansUpItsTemp(t *testing.T) {
	dir := t.TempDir()
	target := StatusPath(dir)
	if err := Write(target, Status{Phase: PhaseRunning, State: StateReady, Pid: 4242}); err != nil {
		t.Fatalf("Write: %v", err)
	}
	read, err := Read(dir)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if read.Pid != 4242 || read.Phase != PhaseRunning || read.UpdatedAt == "" {
		t.Fatalf("published the wrong document: %+v", read)
	}
	assertNoTempLeftovers(t, dir)
}

// Several goroutines publish (the two-second tick, a health result, a phase
// change). Each must carry its own temp, or one publisher deletes another's file.
func TestStatusWriteSurvivesConcurrentPublishers(t *testing.T) {
	dir := t.TempDir()
	target := StatusPath(dir)
	var failures sync.WaitGroup
	errs := make([]error, 24)
	for i := range errs {
		failures.Add(1)
		go func(index int) {
			defer failures.Done()
			errs[index] = Write(target, Status{Phase: PhaseRunning, Pid: index})
		}(i)
	}
	failures.Wait()
	for index, err := range errs {
		if err != nil {
			t.Fatalf("publisher %d failed: %v", index, err)
		}
	}
	if _, err := Read(dir); err != nil {
		t.Fatalf("the published document is not readable: %v", err)
	}
	assertNoTempLeftovers(t, dir)
}

func TestStatusWriteRetriesAroundATransientlyLockedDocument(t *testing.T) {
	requireWindowsLockSemantics(t)
	dir := t.TempDir()
	target := StatusPath(dir)
	if err := Write(target, Status{Phase: PhaseRunning}); err != nil {
		t.Fatalf("seeding Write: %v", err)
	}
	// A reader holds the document for longer than one rename attempt but well
	// inside the retry budget, exactly like the tray polling on the same tick.
	handle := openHeld(t, target)
	go func() {
		time.Sleep(50 * time.Millisecond)
		_ = handle.Close()
	}()
	if err := Write(target, Status{Phase: PhaseRecovering, Pid: 7}); err != nil {
		t.Fatalf("Write gave up while the reader was finishing: %v", err)
	}
	read, err := Read(dir)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if read.Phase != PhaseRecovering || read.Pid != 7 {
		t.Fatalf("the retried publication did not land: %+v", read)
	}
	assertNoTempLeftovers(t, dir)
}

// A lock that outlasts the budget is still a failure worth reporting — but it must
// not cost the previously published document, and must not leave a temp behind.
func TestStatusWriteGivesUpWithoutCorruptingTheLastDocument(t *testing.T) {
	requireWindowsLockSemantics(t)
	dir := t.TempDir()
	target := StatusPath(dir)
	if err := Write(target, Status{Phase: PhaseRunning, Pid: 11}); err != nil {
		t.Fatalf("seeding Write: %v", err)
	}
	handle := openHeld(t, target)
	defer handle.Close()
	err := Write(target, Status{Phase: PhaseStopped, Pid: 99})
	if err == nil {
		t.Skip("this machine let the rename through; the lock is not held as Windows holds it")
	}
	if !strings.HasPrefix(err.Error(), "publish status:") {
		t.Fatalf("unexpected failure: %v", err)
	}
	read, readErr := Read(dir)
	if readErr != nil {
		t.Fatalf("Read after a failed publish: %v", readErr)
	}
	if read.Pid != 11 {
		t.Fatalf("a failed publish replaced the last good document: %+v", read)
	}
	assertNoTempLeftovers(t, dir)
}

// openHeld keeps a read handle open with Go's ordinary share mode, which is what
// the tray and `service status` do, and which blocks a replace-existing rename.
func openHeld(t *testing.T, path string) *os.File {
	t.Helper()
	handle, err := os.OpenFile(path, os.O_RDONLY, 0)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	return handle
}

func requireWindowsLockSemantics(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("the rename-over-open-handle refusal is a Windows behaviour")
	}
}

func assertNoTempLeftovers(t *testing.T, dir string) {
	t.Helper()
	leftovers, err := filepath.Glob(filepath.Join(dir, "status.json.tmp*"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(leftovers) != 0 {
		t.Fatalf("temp files left behind: %v", leftovers)
	}
}
