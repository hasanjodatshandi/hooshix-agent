//go:build linux

package wslfs

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Test-only child: acquire HooshiX's real index lease and begin a real
// git update-ref CAS. A test-only Git reference-transaction hook holds the
// update-ref process in its "prepared" phase, AFTER ref locks are acquired
// and BEFORE Git decides whether to publish the new ref. The parent test
// kills this child and all of its descendant processes in a dedicated
// process group. Production runPinnedGit still disables ALL Git hooks.
func TestLinuxGitPreparedUpdateRefCrashChild(t *testing.T) {
	if os.Getenv("HOOSHIX_PREPARED_CRASH_TEST_CHILD") != "1" {
		return
	}
	root := os.Getenv("HOOSHIX_PREPARED_CRASH_ROOT")
	hookdir := os.Getenv("HOOSHIX_PREPARED_CRASH_HOOKS")
	old := os.Getenv("HOOSHIX_PREPARED_CRASH_OLD")
	next := os.Getenv("HOOSHIX_PREPARED_CRASH_NEW")
	ref := os.Getenv("HOOSHIX_PREPARED_CRASH_REF")
	if !strings.HasPrefix(root, "/tmp/") || !strings.HasPrefix(hookdir, "/tmp/") ||
		!gitObjectID.MatchString(old) || !gitObjectID.MatchString(next) ||
		!strings.HasPrefix(ref, "refs/heads/") ||
		validateNewGitBranch(strings.TrimPrefix(ref, "refs/heads/")) != nil {
		os.Exit(71)
	}
	workspace, err := os.OpenRoot(root)
	if err != nil {
		os.Exit(72)
	}
	defer workspace.Close()
	lease, err := acquireGitIndexLease(workspace)
	if err != nil {
		os.Exit(73)
	}
	defer lease.Close()
	cmd := exec.Command("/usr/bin/git", "-c", "core.hooksPath="+hookdir,
		"update-ref", "--no-deref", ref, next, old)
	cmd.Dir = root
	cmd.Env = []string{
		"PATH=/usr/bin:/bin", "HOME=/nonexistent",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_TERMINAL_PROMPT=0",
		"HOOSHIX_PREPARED_MARKER=" + os.Getenv("HOOSHIX_PREPARED_MARKER"),
		"HOOSHIX_RELEASE_MARKER=" + os.Getenv("HOOSHIX_RELEASE_MARKER"),
	}
	if e := cmd.Run(); e != nil {
		os.Exit(74)
	}
	os.Exit(0)
}

func TestLinuxGitCrashDuringPreparedUpdateRefPreservesUnknownStateAndLocks(t *testing.T) {
	root, initial := checkoutFixture(t)
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("staged during crash window"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, root, "add", "tracked.txt")
	old := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	tree := strings.TrimSpace(gitResult(t, root, "write-tree"))
	next := strings.TrimSpace(gitResult(t, root, "commit-tree", tree, "-p", old,
		"-m", "prepared ref transaction should not become durable"))
	ref := "refs/heads/" + initial

	// The hook is strictly a fixture to pause Git's REAL update-ref inside
	// reference transaction preparation; production hooks stay disabled.
	hooks := t.TempDir()
	hook := filepath.Join(hooks, "reference-transaction")
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"prepared\" ]; then\n" +
		"  : > \"$HOOSHIX_PREPARED_MARKER\"\n" +
		"  while [ ! -e \"$HOOSHIX_RELEASE_MARKER\" ]; do /usr/bin/sleep 0.03; done\n" +
		"fi\n"
	if err := os.WriteFile(hook, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	prepared := filepath.Join(t.TempDir(), "prepared")
	release := filepath.Join(t.TempDir(), "release")
	child := exec.Command(os.Args[0], "-test.run=^TestLinuxGitPreparedUpdateRefCrashChild$")
	child.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	child.Env = append(os.Environ(),
		"HOOSHIX_PREPARED_CRASH_TEST_CHILD=1",
		"HOOSHIX_PREPARED_CRASH_ROOT="+root,
		"HOOSHIX_PREPARED_CRASH_HOOKS="+hooks,
		"HOOSHIX_PREPARED_CRASH_OLD="+old,
		"HOOSHIX_PREPARED_CRASH_NEW="+next,
		"HOOSHIX_PREPARED_CRASH_REF="+ref,
		"HOOSHIX_PREPARED_MARKER="+prepared,
		"HOOSHIX_RELEASE_MARKER="+release)
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	// Do not kill anyone else's process: this is a brand-new isolated
	// process group created by THIS test only.
	terminated := false
	t.Cleanup(func() {
		if !terminated {
			_ = syscall.Kill(-child.Process.Pid, syscall.SIGKILL)
			_ = child.Wait()
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	sawPrepared := false
	for time.Now().Before(deadline) {
		if _, err := os.Stat(prepared); err == nil {
			sawPrepared = true
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if !sawPrepared {
		t.Fatal("Git did not reach prepared ref transaction")
	}
	indexLock := filepath.Join(root, ".git", "index.lock")
	refLock := filepath.Join(root, ".git", filepath.FromSlash(ref)+".lock")
	for _, f := range []string{indexLock, refLock} {
		st, err := os.Lstat(f)
		if err != nil || !st.Mode().IsRegular() {
			t.Fatalf("Git did not hold a regular lock at prepared stage: %s, %v", f, err)
		}
	}
	if before := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD")); before != old {
		t.Fatal("Git ref changed before prepared transaction commit")
	}
	// Real SIGKILL at the *prepared* stage, while Git update-ref is
	// executing. The process group contains only our disposable Go child,
	// Git update-ref process and its reference-transaction hook/sleep.
	if err := syscall.Kill(-child.Process.Pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	terminated = true
	if now := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD")); now != old {
		t.Fatalf("in-flight Git ref incorrectly committed after SIGKILL: %s", now)
	}
	// Ordinary signal death is not expected to release Git's file-based
	// locks. The product MUST NOT delete locks merely because a timeout or
	// missing Windows acknowledgment occurs.
	for _, f := range []string{indexLock, refLock} {
		st, err := os.Lstat(f)
		if err != nil || !st.Mode().IsRegular() {
			t.Fatalf("crash evidence lock missing or redirected: %s, %v", f, err)
		}
	}
	for _, req := range []Request{
		{Version: 1, Operation: "git_commit", Path: ".", Content: "must not replay",
			Query: "fedcba9876543210fedcba9876543210"},
		{Version: 1, Operation: "git_add", Path: ".", Paths: []string{"tracked.txt"}},
	} {
		response := Run(root, req)
		if response.OK {
			t.Fatalf("stale lock allowed mutation or replay: %+v", response)
		}
	}
	unchanged := strings.TrimSpace(gitResult(t, root, "rev-parse", "HEAD"))
	if unchanged != old {
		t.Fatal("failed mutation altered original HEAD")
	}
	result := Run(root, Request{Version: 1, Operation: "git_commit_reconcile", Path: ".",
		Query: "fedcba9876543210fedcba9876543210"})
	if !result.OK || result.State != "unresolved" {
		t.Fatalf("ambiguous crash was mistaken for a verified commit: %+v", result)
	}
	for _, f := range []string{indexLock, refLock} {
		if _, err := os.Lstat(f); err != nil {
			t.Fatalf("broker unexpectedly deleted a crash/foreign lock: %s %v", f, err)
		}
	}
	// The enclosing t.TempDir owns this entire synthetic repo and its locks.
	// The test does not remove individual lock files: that would model the
	// unsafe recovery behavior we must prevent in production.
}
