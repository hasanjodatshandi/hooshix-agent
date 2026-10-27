//go:build windows

package gitworker

import (
	"bytes"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestUserOwnedWorkerSubprocess(t *testing.T) {
	root := os.Getenv("HOOSHIX_GIT_WORKER_TEST_ROOT")
	if root == "" {
		return
	}
	if err := Serve(root); err != nil {
		t.Fatal(err)
	}
}
func TestGitOwnerWorkerRoundTrip(t *testing.T) {
	if os.Getenv("HOOSHIX_GIT_WORKER_TEST_ROOT") != "" {
		return
	}
	sid, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(sid, systemSID) {
		if os.Getenv("HOOSHIX_REQUIRE_GIT_WORKER_E2E") == "1" {
			t.Fatal("native CI worker ran as LocalSystem")
		}
		t.Skip("service-account execution cannot stand in for a human user-session owner")
	}
	root := t.TempDir()
	canonical, err := CanonicalRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		t.Fatal(err)
	}
	// Windows CI may give temporary folders to the Administrators GROUP rather
	// than the process user SID. Correct ownership of only this disposable
	// fixture; production Serve/Proxy owner checks remain strict and unchanged.
	if !sameSID(owner, sid) && os.Getenv("HOOSHIX_REQUIRE_GIT_WORKER_E2E") == "1" {
		userSID, e := windows.StringToSid(sid)
		if e != nil {
			t.Fatal(e)
		}
		if e := windows.SetNamedSecurityInfo(canonical, windows.SE_FILE_OBJECT,
			windows.OWNER_SECURITY_INFORMATION, userSID, nil, nil, nil); e != nil {
			t.Fatalf("cannot set temporary CI fixture owner to runner SID: %v", e)
		}
		owner, err = fileOwnerSID(canonical)
		if err != nil {
			t.Fatal(err)
		}
	}
	if !sameSID(owner, sid) {
		if os.Getenv("HOOSHIX_REQUIRE_GIT_WORKER_E2E") == "1" {
			t.Fatalf("CI fixture owner %s differs from runner identity", owner)
		}
		t.Skipf("test runner temp directory belongs to %s, not its user token", owner)
	}
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if output, e := cmd.CombinedOutput(); e != nil {
			t.Fatalf("git %q failed: %v (%s)", args, e, output)
		}
	}
	runGit("init", "-b", "main")
	runGit("config", "--local", "user.name", "Temporary Owner Test")
	runGit("config", "--local", "user.email", "owner-test@example.invalid")
	if err = os.WriteFile(root+"/file.txt", []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
	// The test binary uses exactly the same Windows user token as the worker.
	worker := exec.Command(os.Args[0], "-test.run=^TestUserOwnedWorkerSubprocess$", "-test.v")
	worker.Env = append(os.Environ(), "HOOSHIX_GIT_WORKER_TEST_ROOT="+root)
	var diagnostic bytes.Buffer
	worker.Stderr = &diagnostic
	if err = worker.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = worker.Process.Kill(); _ = worker.Wait() })
	var status Response
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		status, err = Proxy(root, "git_status", []string{"status", "--porcelain=v1", "--branch"})
		if err == nil {
			break
		}
		time.Sleep(70 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("owner worker not reachable: %v; diagnostics=%s", err, diagnostic.String())
	}
	if status.ExitCode != 0 || !strings.Contains(status.Stdout, "file.txt") {
		t.Fatalf("Git status failed: %+v", status)
	}
	result, e := Proxy(root, "git_add", []string{"add", "--", "file.txt"})
	if e != nil || result.ExitCode != 0 {
		t.Fatalf("governed add failed: %v %+v", e, result)
	}
	result, e = Proxy(root, "git_commit", []string{"commit", "-m", "owner worker approved fixture commit"})
	if e != nil || result.ExitCode != 0 {
		t.Fatalf("governed commit failed: %v %+v", e, result)
	}
	result, e = Proxy(root, "git_log", []string{"log", "--max-count=1", "--oneline", "--decorate"})
	if e != nil || result.ExitCode != 0 || !strings.Contains(result.Stdout, "owner worker approved") {
		t.Fatalf("owner Git log failed: %v %+v", e, result)
	}
	// Invalid arbitrary commands are rejected BEFORE a pipe request.
	if _, e = Proxy(root, "exec", []string{"powershell.exe"}); e == nil {
		t.Fatal("arbitrary shell command was accepted")
	}
	if _, e = Proxy(root, "git_add", []string{"add", "--", "../outside"}); e == nil {
		t.Fatal("traversal was accepted")
	}
	stopped, e := Proxy(root, "worker_stop", nil)
	if e != nil || stopped.ExitCode != 0 {
		t.Fatalf("owner worker shutdown failed: %v %+v", e, stopped)
	}
	// After opting out the old pipe is no longer an authority.
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, e = Proxy(root, "git_status", []string{"status", "--porcelain=v1", "--branch"})
		if e != nil {
			break
		}
		time.Sleep(70 * time.Millisecond)
	}
	if e == nil {
		t.Fatal("revoked Git worker still accepts requests")
	}
}
