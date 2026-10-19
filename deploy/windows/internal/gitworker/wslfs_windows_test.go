//go:build windows

package gitworker

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
)

func TestWSLFSOwnerChild(t *testing.T) {
	root := os.Getenv("HOOSHIX_WSLFS_TEST_ROOT")
	if root == "" {
		return
	}
	// The child must run as the actual owner token. It does not run WSL
	// because the test only exercises the authenticated named-pipe contract.
	if err := ServeWSLFiles(root, "Ubuntu", "/home/test", "/tmp/never-executed-broker"); err != nil {
		t.Fatal(err)
	}
}

func TestWSLFSOwnerPipeAndRevocation(t *testing.T) {
	if os.Getenv("HOOSHIX_WSLFS_TEST_ROOT") != "" {
		return
	}
	user, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(user, systemSID) {
		if os.Getenv("HOOSHIX_REQUIRE_WSLFS_BROKER_E2E") == "1" {
			t.Fatal("owner IPC gate cannot run as SYSTEM")
		}
		t.Skip("production LocalSystem cannot enroll a WSL file worker")
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
	if !sameSID(owner, user) {
		if os.Getenv("HOOSHIX_REQUIRE_WSLFS_BROKER_E2E") == "1" {
			t.Fatal("CI test fixture not owned by runner")
		}
		t.Skip("fixture owner differs from runner SID")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestWSLFSOwnerChild$")
	cmd.Env = append(os.Environ(), "HOOSHIX_WSLFS_TEST_ROOT="+canonical)
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	// Malformed paths must be denied before WSL is executed.
	if _, err = ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "read", Path: "../outside"}); err == nil {
		t.Fatal("cross-root path unexpectedly accepted")
	}
	if _, err = ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "exec", Path: "."}); err == nil {
		t.Fatal("shell execution unexpectedly allowed through file channel")
	}
	deadline := time.Now().Add(8 * time.Second)
	var result wslfs.Response
	for time.Now().Before(deadline) {
		result, err = ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: ".", Query: "__HOOSHIX_WSLFS_REVOKE__"})
		if err == nil {
			break
		}
		time.Sleep(75 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("WSLFS named pipe unreachable: %v", err)
	}
	if !result.OK {
		t.Fatalf("user owner revocation failed: %+v", result)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, err = ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: "."})
		if err != nil {
			break
		}
		time.Sleep(60 * time.Millisecond)
	}
	if err == nil {
		t.Fatal("revoked WSLFS owner worker still available")
	}
	if strings.Contains(result.Error, "private") {
		t.Fatal("sensitive process details in worker response")
	}
}