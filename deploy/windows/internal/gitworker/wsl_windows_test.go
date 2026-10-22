//go:build windows

package gitworker

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestWSLWorkerConfigurationRejectsUnsafeEntries(t *testing.T) {
	good := []struct{ d, p string }{{"Ubuntu", "/home/coder/workspace"}, {"Ubuntu-26.04", "/mnt/d/uni"}}
	for _, tc := range good {
		if err := ValidateWSLConfig(tc.d, tc.p); err != nil {
			t.Errorf("valid config rejected: %v", err)
		}
	}
	bad := []struct{ d, p string }{{"", "/home/coder"}, {"Ubuntu;echo BOOM", "/home/coder"}, {"Ubuntu", "../outside"}, {"Ubuntu", "/home/../escape"}, {"Ubuntu", "//host/share"}}
	for _, tc := range bad {
		if err := ValidateWSLConfig(tc.d, tc.p); err == nil {
			t.Errorf("unsafe WSL enrollment accepted: %+v", tc)
		}
	}
}

func TestWSLWorkerOwnerChild(t *testing.T) {
	root := os.Getenv("HOOSHIX_WSL_BROKER_TEST_ROOT")
	if root == "" {
		return
	}
	if err := ServeWSL(root, "Ubuntu", "/home/owner"); err != nil {
		t.Fatal(err)
	}
}

func TestWSLWorkerOwnerIPC(t *testing.T) {
	if os.Getenv("HOOSHIX_WSL_BROKER_TEST_ROOT") != "" {
		return
	}
	sid, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(sid, systemSID) {
		if os.Getenv("HOOSHIX_REQUIRE_WSL_BROKER_E2E") == "1" {
			t.Fatal("native WSL broker CI was run as SYSTEM")
		}
		t.Skip("local SYSTEM service cannot stand in for a user-owned WSL worker")
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
	if !sameSID(owner, sid) {
		if os.Getenv("HOOSHIX_REQUIRE_WSL_BROKER_E2E") == "1" {
			t.Fatal("WSL fixture is not owned by the CI user")
		}
		t.Skip("runner temp fixture owner must match user SID")
	}
	child := exec.Command(os.Args[0], "-test.run=^TestWSLWorkerOwnerChild$")
	child.Env = append(os.Environ(), "HOOSHIX_WSL_BROKER_TEST_ROOT="+canonical)
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Process.Kill(); _ = child.Wait() })
	var result Response
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		result, err = ProxyWSL(canonical, "__HOOSHIX_WSL_STOP__")
		if err == nil {
			break
		}
		time.Sleep(75 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("WSL IPC handshake failed: %v", err)
	}
	if result.ExitCode != 0 {
		t.Fatalf("WSL worker revocation failed closed: %+v", result)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, err = ProxyWSL(canonical, "echo should-not-run")
		if err != nil {
			break
		}
		time.Sleep(65 * time.Millisecond)
	}
	if err == nil {
		t.Fatal("revoked worker still accepts WSL commands")
	}
	if _, err = ProxyWSL(canonical, strings.Repeat("x", 6200)); err == nil {
		t.Fatal("oversize request accepted")
	}
}
