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

// TestWSLFSRealOwnerPipePostCASDisconnect exercises a real Windows named pipe
// being disconnected AFTER the Linux Git broker returns a successful durable
// CAS, but BEFORE the Windows owner worker writes its success acknowledgment.
// Only the test executable can inject this drop. The installed Windows worker
// and Linux broker do not have a fault-injection mode or user input for it.
func TestWSLFSRealOwnerPipePostCASDisconnect(t *testing.T) {
	broker := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER")
	if broker == "" {
		if os.Getenv("HOOSHIX_REQUIRE_WSLFS_BROKER_E2E") == "1" {
			t.Fatal("required owner Git ack-loss E2E broker was not provisioned")
		}
		t.Skip("requires reviewed disposable Linux broker")
	}
	if !(strings.HasPrefix(broker, "/tmp/hooshix-wslfs-e2e-") ||
		(strings.HasPrefix(broker, "/mnt/") &&
			strings.HasSuffix(broker, "/hooshix-wsl-fs-broker-e2e-linux-amd64"))) ||
		path.Clean(broker) != broker || strings.Contains(broker, "..") {
		t.Fatal("ack-loss test broker outside isolated allowlist")
	}
	digest := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER_SHA256")
	if !regexp.MustCompile("^[a-f0-9]{64}$").MatchString(digest) {
		t.Fatal("explicit broker digest required")
	}
	hashLine := runWSLFSFixtureCommand(t, "", "/usr/bin/sha256sum", "--", broker)
	hash, _, ok := strings.Cut(hashLine, " ")
	if !ok || hash != digest {
		t.Fatal("disposable broker checksum mismatch")
	}
	current, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(current, systemSID) {
		t.Fatal("test requires signed-in owner, not LocalSystem")
	}
	anchor := ownerOwnedTestRoot(t)
	canonical, err := CanonicalRoot(anchor)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil || !sameSID(owner, current) {
		t.Fatal("Windows anchor not owned by signed-in test user")
	}

	linuxRoot := runWSLFSFixtureCommand(t, "", "/usr/bin/mktemp", "-d", "-p", "/tmp",
		"hooshix-wslfs-e2e-workspace-XXXXXXXX")
	if !strings.HasPrefix(linuxRoot, "/tmp/hooshix-wslfs-e2e-workspace-") ||
		path.Clean(linuxRoot) != linuxRoot || strings.ContainsAny(linuxRoot, "\r\n") {
		t.Fatal("invalid disposable Ubuntu test root")
	}
	t.Cleanup(func() {
		cmd := exec.Command("wsl.exe", "--distribution", "Ubuntu", "--exec",
			"/usr/bin/rm", "-rf", "--", linuxRoot)
		if out, e := cmd.CombinedOutput(); e != nil {
			t.Logf("disposable Ubuntu cleanup incomplete: %v %s", e, out)
		}
	})
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "init", "-q")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "config", "user.name", "HooshiX Ack Loss Test")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "config", "user.email", "ack-loss@example.invalid")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "commit", "--allow-empty", "-qm", "initial")

	oldHEAD := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/touch", "--", "ack-loss.txt")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "add", "--", "ack-loss.txt")
	staged := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "diff", "--cached", "--name-only")
	if staged != "ack-loss.txt" {
		t.Fatalf("fixture index was not prepared: %q", staged)
	}

	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		t.Fatal(err)
	}
	requestID := hex.EncodeToString(random[:])
	children := []*exec.Cmd{}
	t.Cleanup(func() {
		for _, child := range children {
			if child != nil && child.Process != nil && child.ProcessState == nil {
				_ = child.Process.Kill()
				_ = child.Wait()
			}
		}
	})
	start := func(kind string) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^TestWSLFSRealBrokerChild$")
		cmd.Env = append(os.Environ(),
			"HOOSHIX_WSLFS_E2E_CHILD_KIND="+kind,
			"HOOSHIX_WSLFS_E2E_OWNER_ROOT="+canonical,
			"HOOSHIX_WSLFS_E2E_LINUX_ROOT="+linuxRoot,
			"HOOSHIX_WSLFS_E2E_BROKER="+broker,
			"HOOSHIX_WSLFS_E2E_ACKLOSS_ID="+requestID)
		if err := cmd.Start(); err != nil {
			t.Fatalf("could not start test owner pipe %q: %v", kind, err)
		}
		children = append(children, cmd)
		return cmd
	}
	ready := func(kind string) {
		t.Helper()
		for until := time.Now().Add(15 * time.Second); time.Now().Before(until); {
			req := wslfs.Request{Version: 1, Operation: "probe", Path: "."}
			var resp wslfs.Response
			var err error
			if kind == "read" {
				resp, err = ProxyWSLFiles(canonical, req)
			} else {
				resp, err = ProxyWSLGitWriteProbe(canonical, req)
			}
			if err == nil && resp.OK && resp.Distro == "Ubuntu" && resp.LinuxRoot == linuxRoot {
				return
			}
			time.Sleep(150 * time.Millisecond)
		}
		t.Fatalf("disposable %s owner pipe did not become ready", kind)
	}
	_ = start("read")
	ready("read")
	broken := start("git-drop-after-commit")
	ready("git")
	// The fault hook must NEVER drop a negative broker response or invent
	// success. An invalid message is rejected; the actual Git pipe stays up
	// and the initial HEAD remains unchanged.
	denied, deniedErr := ProxyWSLGitWriteBound(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit", Path: ".", Query: requestID, Content: "   ",
	}, "Ubuntu", linuxRoot)
	if deniedErr != nil || denied.OK || denied.Error != "wslgit_invalid_commit_message" {
		t.Fatalf("test fault hook disconnected before any successful Git CAS: %+v %v", denied, deniedErr)
	}
	if stillOld := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD"); stillOld != oldHEAD {
		t.Fatal("invalid commit advanced HEAD before the intended fault")
	}
	reply, transportErr := ProxyWSLGitWriteBound(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit", Path: ".", Query: requestID, Content: "durable despite lost acknowledgment",
	}, "Ubuntu", linuxRoot)
	if transportErr == nil || reply.OK {
		t.Fatalf("test must physically lose Windows ACK, got %+v err=%v", reply, transportErr)
	}
	// The worker's test hook returned after Linux reported OK, then the
	// actual Windows pipe disconnected before sending a single response byte.
	if e := broken.Wait(); e == nil {
		t.Fatal("test-only ACK-loss owner worker unexpectedly exited successfully")
	}
	for i, cmd := range children {
		if cmd == broken {
			children[i] = nil
		}
	}
	if stale, staleErr := ProxyWSLGitWriteProbe(canonical, wslfs.Request{
		Version: 1, Operation: "probe", Path: ".",
	}); staleErr == nil && stale.OK {
		t.Fatal("disconnected Windows Git write owner pipe still answered after worker exited")
	}
	headAfter := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD")
	if headAfter == oldHEAD {
		t.Fatal("lost ACK test did not durably advance HEAD")
	}
	if count := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-list", "--count", "HEAD"); count != "2" {
		t.Fatalf("unexpected number of commits after lost ACK: %s", count)
	}
	confirmed, err := ProxyWSLFiles(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: requestID,
	})
	if err != nil || !confirmed.OK || confirmed.State != "applied" ||
		confirmed.GitStdout != headAfter {
		t.Fatalf("read-only reconciliation missed durable CAS: %+v %v", confirmed, err)
	}
	unknown, unknownErr := ProxyWSLFiles(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit_reconcile", Path: ".",
		Query: "00000000000000000000000000000000",
	})
	if unknownErr != nil || !unknown.OK || unknown.State != "unresolved" ||
		unknown.GitStdout != "" {
		t.Fatalf("unknown commit nonce must not be mistaken for a replayable failure: %+v %v", unknown, unknownErr)
	}
	if status := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "status", "--porcelain"); status != "" {
		t.Fatalf("lost ACK left an inconsistent worktree/index: %q", status)
	}
	// Simulate owner Git write pipe recovery by re-creating an independent
	// test-only worker. Reconnect does NOT resubmit any Git mutation.
	_ = start("git")
	ready("git")
	recovered, err := ProxyWSLFiles(canonical, wslfs.Request{
		Version: 1, Operation: "git_commit_reconcile", Path: ".", Query: requestID,
	})
	if err != nil || !recovered.OK || recovered.State != "applied" ||
		recovered.GitStdout != headAfter {
		t.Fatalf("reconnection lost idempotency evidence: %+v %v", recovered, err)
	}
	if again := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-list", "--count", "HEAD"); again != "2" {
		t.Fatalf("reconnect created or lost a commit: %q", again)
	}
	if final := runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "rev-parse", "HEAD"); final != headAfter {
		t.Fatalf("reconnection unexpectedly modified HEAD: %q", final)
	}
	t.Log("real Windows Named Pipe disconnected after durable Linux CAS; owner read reconciliation and write-pipe recovery verified with no replay")
}
