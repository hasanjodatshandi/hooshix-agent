//go:build windows

package gitworker

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
)

// TestWSLFSRealLinuxBrokerSIGKILLAfterCAS exercises a REAL SIGKILL of a
// test-only Linux broker PROCESS after successful Git ref CAS, before it sends
// any JSON response to the signed-in Windows owner worker. The production
// Linux broker and its runtime do not expose this fault switch.
func TestWSLFSRealLinuxBrokerSIGKILLAfterCAS(t *testing.T) {
	broker := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER")
	testBin := os.Getenv("HOOSHIX_WSLFS_E2E_LINUX_CRASH_TEST_BIN")
	testDigest := os.Getenv("HOOSHIX_WSLFS_E2E_LINUX_CRASH_TEST_SHA256")
	if broker == "" || testBin == "" {
		if os.Getenv("HOOSHIX_REQUIRE_WSLFS_BROKER_E2E") == "1" {
			t.Fatal("required normal and test-only Linux broker binaries missing")
		}
		t.Skip("opt-in, requires the pinned normal and Linux fault-test broker executables")
	}
	if !strings.HasPrefix(broker, "/tmp/hooshix-wslfs-e2e-") ||
		!strings.HasPrefix(testBin, "/tmp/hooshix-wslfs-e2e-") ||
		path.Clean(broker) != broker || path.Clean(testBin) != testBin ||
		strings.Contains(broker, "..") || strings.Contains(testBin, "..") ||
		path.Dir(broker) != path.Dir(testBin) {
		t.Fatal("both Linux executables must be in the same disposable E2E bin directory")
	}
	digestPattern := regexp.MustCompile("^[0-9a-f]{64}$")
	normalDigest := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER_SHA256")
	if !digestPattern.MatchString(normalDigest) || !digestPattern.MatchString(testDigest) {
		t.Fatal("both binaries require explicit SHA-256 pins")
	}
	for _, pair := range [][2]string{{broker, normalDigest}, {testBin, testDigest}} {
		sum := runWSLFSFixtureCommand(t, "", "/usr/bin/sha256sum", "--", pair[0])
		digest, _, ok := strings.Cut(sum, " ")
		if !ok || digest != pair[1] {
			t.Fatal("Linux broker test binary SHA-256 mismatch")
		}
	}
	me, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(me, systemSID) {
		t.Fatal("test must run under signed-in Windows owner")
	}
	anchor := ownerOwnedTestRoot(t)
	canonical, err := CanonicalRoot(anchor)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil || !sameSID(owner, me) {
		t.Fatal("E2E owner anchor SID mismatch")
	}

	// Script is a disposable Linux test runner only. Its single purpose is to
	// bridge the fixed --root argument into the Go test child's environment.
	// No untrusted content is interpolated into a shell command.
	wrapper := path.Join(path.Dir(testBin), "broker-crash-after-cas-wrapper")
	script := "#!/bin/sh\n" +
		"[ \"$1\" = \"--root\" ] || exit 2\n" +
		"[ -n \"$2\" ] || exit 2\n" +
		"export HOOSHIX_WSLFS_LINUX_CRASH_TEST_CHILD=1\n" +
		"export HOOSHIX_WSLFS_LINUX_CRASH_TEST_ROOT=\"$2\"\n" +
		"exec \"" + testBin + "\" '-test.run=^TestLinuxBrokerKillAfterCommitCASChild$'\n"
	writer := exec.Command("wsl.exe", "--distribution", "Ubuntu", "--exec", "/usr/bin/tee", wrapper)
	writer.Stdin = strings.NewReader(script)
	if out, e := writer.CombinedOutput(); e != nil {
		t.Fatalf("failed to create test-only Linux wrapper: %v %s", e, out)
	}
	runWSLFSFixtureCommand(t, "", "/usr/bin/chmod", "0700", "--", wrapper)
	t.Cleanup(func() {
		cmd := exec.Command("wsl.exe", "--distribution", "Ubuntu", "--exec", "/usr/bin/rm", "--", wrapper)
		if out, e := cmd.CombinedOutput(); e != nil {
			t.Logf("Linux test wrapper cleanup: %v %s", e, out)
		}
	})

	linuxRoot := runWSLFSFixtureCommand(t, "", "/usr/bin/mktemp", "-d", "-p", "/tmp",
		"hooshix-wslfs-e2e-workspace-XXXXXXXX")
	if !strings.HasPrefix(linuxRoot, "/tmp/hooshix-wslfs-e2e-workspace-") ||
		path.Clean(linuxRoot) != linuxRoot || strings.ContainsAny(linuxRoot, "\r\n") {
		t.Fatal("invalid disposable Ubuntu repository root")
	}
	t.Cleanup(func() {
		cmd := exec.Command("wsl.exe", "--distribution", "Ubuntu", "--exec",
			"/usr/bin/rm", "-rf", "--", linuxRoot)
		if out, e := cmd.CombinedOutput(); e != nil {
			t.Logf("disposable Ubuntu cleanup: %v %s", e, out)
		}
	})
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "init", "-q")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "config", "user.name", "HooshiX Linux Crash E2E")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "config", "user.email", "crash-e2e@example.invalid")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "commit", "--allow-empty", "-qm", "initial")
	original := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/touch", "--", "crashed-broker.txt")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "add", "--", "crashed-broker.txt")

	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatal(err)
	}
	requestID := hex.EncodeToString(buf[:])
	workers := []*exec.Cmd{}
	t.Cleanup(func() {
		for _, child := range workers {
			if child != nil && child.Process != nil && child.ProcessState == nil {
				_ = child.Process.Kill()
				_ = child.Wait()
			}
		}
	})
	start := func(kind string) {
		child := exec.Command(os.Args[0], "-test.run=^TestWSLFSRealBrokerChild$")
		child.Env = append(os.Environ(),
			"HOOSHIX_WSLFS_E2E_CHILD_KIND="+kind,
			"HOOSHIX_WSLFS_E2E_OWNER_ROOT="+canonical,
			"HOOSHIX_WSLFS_E2E_LINUX_ROOT="+linuxRoot,
			"HOOSHIX_WSLFS_E2E_BROKER="+broker,
			"HOOSHIX_WSLFS_E2E_LINUX_CRASH_WRAPPER="+wrapper)
		if err := child.Start(); err != nil {
			t.Fatalf("cannot start disposable %s owner worker: %v", kind, err)
		}
		workers = append(workers, child)
	}
	wait := func(kind string) {
		t.Helper()
		for until := time.Now().Add(15 * time.Second); time.Now().Before(until); {
			req := wslfs.Request{Version: 1, Operation: "probe", Path: "."}
			var response wslfs.Response
			var err error
			if kind == "read" {
				response, err = ProxyWSLFiles(canonical, req)
			} else {
				response, err = ProxyWSLGitWriteProbe(canonical, req)
			}
			if err == nil && response.OK && response.Distro == "Ubuntu" && response.LinuxRoot == linuxRoot {
				return
			}
			time.Sleep(150 * time.Millisecond)
		}
		t.Fatalf("WSL owner %s pipe failed readiness", kind)
	}
	start("read")
	wait("read")
	start("git-linux-crash")
	wait("git")
	// A malformed message must be rejected normally, without killing the test
	// Linux broker. Verify HEAD is unchanged and the Git owner worker remains.
	rejected, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit", Path: ".", Query: requestID, Content: " ",
	}, "Ubuntu", linuxRoot)
	if err != nil || rejected.OK || rejected.Error != "wslgit_invalid_commit_message" {
		t.Fatalf("test Linux broker killed/accepted an invalid commit: %+v %v", rejected, err)
	}
	if old := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD"); old != original {
		t.Fatal("invalid commit changed original HEAD")
	}
	// The Linux process kills ITSELF using SIGKILL strictly after CAS, before
	// any response. The Windows named pipe may still reply with a failure code,
	// but must never provide a positive acknowledgment or retry the mutation.
	failed, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit", Path: ".", Query: requestID,
		Content: "Linux broker killed after durable ref CAS",
	}, "Ubuntu", linuxRoot)
	if err != nil || failed.OK || failed.Error != "wslfs_worker_execution_failed" {
		t.Fatalf("SIGKILLed Linux process did not produce an ambiguous failure: %+v %v", failed, err)
	}
	after := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD")
	if after == original {
		t.Fatal("Linux broker did not durably commit before SIGKILL")
	}
	if count := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-list", "--count", "HEAD"); count != "2" {
		t.Fatalf("unexpected durable history after crash: %s", count)
	}
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/test", "!", "-e", ".git/index.lock")
	// A regular git command is a better independent verification of the lack
	// of a stale lock than any automatic removal.
	if state := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "status", "--porcelain"); state != "" {
		t.Fatalf("Linux SIGKILL left working tree/index inconsistent: %q", state)
	}
	// Recovery reads the exact original nonce through the INDEPENDENT owner
	// read-only pipe, never the Git-write pipe and never a second git commit.
	confirmed, readErr := ProxyWSLFiles(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: requestID,
	})
	if readErr != nil || !confirmed.OK || confirmed.State != "applied" || confirmed.GitStdout != after {
		t.Fatalf("read pipe did not reconcile committed nonce: %+v %v", confirmed, readErr)
	}
	missed, missedErr := ProxyWSLFiles(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit_reconcile", Path: ".",
		Query: "00000000000000000000000000000000",
	})
	if missedErr != nil || !missed.OK || missed.State != "unresolved" || missed.GitStdout != "" {
		t.Fatalf("unknown nonce should stay unresolved: %+v %v", missed, missedErr)
	}
	// Linux worker is executed afresh for each request and remains usable after
	// one SIGKILL; this re-probe does not send another Git mutation.
	alive, probeErr := ProxyWSLGitWriteProbe(canonical, wslfs.Request{
		Version: 1, Operation: "probe", Path: ".",
	})
	if probeErr != nil || !alive.OK || alive.Distro != "Ubuntu" || alive.LinuxRoot != linuxRoot {
		t.Fatalf("Linux broker could not be re-launched after SIGKILL: %+v %v", alive, probeErr)
	}
	if final := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD"); final != after {
		t.Fatal("Linux crash reconciliation changed HEAD")
	}
	if count := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-list", "--count", "HEAD"); count != "2" {
		t.Fatal("restarted Linux broker duplicated the commit")
	}
	t.Log("Linux test broker SIGKILLed itself after real Git CAS; Windows owner pipe reported unknown, independent read reconciliation recovered exactly one commit")
}
