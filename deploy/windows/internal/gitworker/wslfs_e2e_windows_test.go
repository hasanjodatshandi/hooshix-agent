//go:build windows

package gitworker

import (
	"crypto/sha256"
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

// An opt-in real Windows owner -> named pipe -> WSL process -> Linux broker
// integration suite. No registry enrollment, installed service, project
// workspace, or persistent WSL file is changed. The build artifact passed
// through HOOSHIX_WSLFS_E2E_BROKER must have been independently reviewed.
// Requires a signed-in owner session, not LocalSystem.
// ownerOwnedTestRoot creates an isolated Windows anchor under the source
// checkout, whose ownership is independently checked before a named pipe is
// exposed. %TEMP% may inherit a service/system owner even for a normal user.
// A test must never change ownership or relax its ACL to make the fixture pass.
func ownerOwnedTestRoot(t *testing.T) string {
	t.Helper()
	// Optional existing, explicitly owner-controlled Windows directory. It is
	// used ONLY as the named-pipe security anchor and process cwd. The test
	// neither modifies its contents nor cleans it up. An elevated process may
	// otherwise create throwaway directories owned by BUILTIN\\Administrators.
	if selected := os.Getenv("HOOSHIX_WSLFS_E2E_OWNER_ANCHOR"); selected != "" {
		root, err := CanonicalRoot(selected)
		if err != nil {
			t.Fatal(err)
		}
		owner, err := fileOwnerSID(root)
		if err != nil {
			t.Fatal(err)
		}
		current, err := currentSID()
		if err != nil {
			t.Fatal(err)
		}
		if !sameSID(owner, current) {
			t.Fatalf("existing E2E anchor owner mismatch: expected current owner SID")
		}
		return root
	}
	parent, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(parent, ".hooshix-wslfs-owner-e2e-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if e := os.RemoveAll(root); e != nil {
			t.Logf("temporary E2E fixture cleanup failed: %v", e)
		}
	})
	owner, err := fileOwnerSID(root)
	if err != nil {
		t.Fatal(err)
	}
	current, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if !sameSID(owner, current) {
		if os.Getenv("HOOSHIX_REQUIRE_WSLFS_BROKER_E2E") == "1" {
			t.Fatal("required owner E2E fixture has wrong SID: use an owner-runner or an existing explicitly owned anchor")
		}
		t.Skip("new owner E2E fixture not owned by the caller SID; specify a preowned test anchor")
	}
	return root
}

// If an elevated process creates a directory owned by the Administrators
// group instead of the exact Windows caller SID, native WSL owner enrollment
// must fail rather than widening the allowed identity.
func TestWSLFSRejectsUnownedTemporaryAnchor(t *testing.T) {
	root := t.TempDir()
	owner, err := fileOwnerSID(root)
	if err != nil {
		t.Fatal(err)
	}
	user, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(owner, user) {
		t.Skip("temporary directory is owned by caller")
	}
	if err := ServeWSLFiles(root, "Ubuntu", "/tmp", "/tmp/hooshix-no-broker"); err == nil {
		t.Fatal("WSL read-only worker accepted a directory owned by another SID")
	}
	if err := ServeWSLFileWrites(root, "Ubuntu", "/tmp", "/tmp/hooshix-no-broker"); err == nil {
		t.Fatal("WSL file-write worker accepted a directory owned by another SID")
	}
	if err := ServeWSLGitWrites(root, "Ubuntu", "/tmp", "/tmp/hooshix-no-broker"); err == nil {
		t.Fatal("WSL Git-write worker accepted a directory owned by another SID")
	}
}

func TestWSLFSRealBrokerChild(t *testing.T) {
	kind := os.Getenv("HOOSHIX_WSLFS_E2E_CHILD_KIND")
	if kind == "" {
		return
	}
	root := os.Getenv("HOOSHIX_WSLFS_E2E_OWNER_ROOT")
	linuxRoot := os.Getenv("HOOSHIX_WSLFS_E2E_LINUX_ROOT")
	broker := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER")
	var err error
	switch kind {
	case "read":
		err = ServeWSLFiles(root, "Ubuntu", linuxRoot, broker)
	case "write":
		err = ServeWSLFileWrites(root, "Ubuntu", linuxRoot, broker)
	case "git":
		err = ServeWSLGitWrites(root, "Ubuntu", linuxRoot, broker)
	case "git-linux-crash":
		// Go test executable only: the Linux executable is itself a Go test
		// binary which SIGKILLs after a successful durable commit CAS.
		faultBroker := os.Getenv("HOOSHIX_WSLFS_E2E_LINUX_CRASH_WRAPPER")
		if !strings.HasPrefix(faultBroker, "/tmp/hooshix-wslfs-e2e-") ||
			path.Clean(faultBroker) != faultBroker || strings.Contains(faultBroker, "..") {
			t.Fatal("invalid disposable Linux crash-test broker wrapper")
		}
		err = ServeWSLGitWrites(root, "Ubuntu", linuxRoot, faultBroker)
	case "git-drop-after-commit":
		// Test-executable-only fault path. The Linux broker performs the
		// real durable ref update, then this Windows owner pipe closes before
		// encoding the result. There is no production IPC or env switch.
		requestID := os.Getenv("HOOSHIX_WSLFS_E2E_ACKLOSS_ID")
		if !regexp.MustCompile("^[0-9a-f]{32}$").MatchString(requestID) {
			t.Fatal("test-only disconnect requires a valid mutation nonce")
		}
		err = serveWSLFilesWithBeforeReply(root, "Ubuntu", linuxRoot, broker, false, true,
			func(req WSLFileRequest, result wslfs.Response) bool {
				return req.File.Operation == "git_commit" &&
					req.File.Query == requestID && result.OK
			})
	default:
		t.Fatalf("unknown E2E child type %q", kind)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func runWSLFSFixtureCommand(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	argv := []string{"--distribution", "Ubuntu"}
	if cwd != "" {
		argv = append(argv, "--cd", cwd)
	}
	argv = append(argv, "--exec")
	argv = append(argv, args...)
	cmd := exec.Command("wsl.exe", argv...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("WSL test setup command failed: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out))
}

func TestWSLFSRealOwnerPipeToLinuxBroker(t *testing.T) {
	broker := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER")
	if broker == "" {
		if os.Getenv("HOOSHIX_REQUIRE_WSLFS_BROKER_E2E") == "1" {
			t.Fatal("required WSL E2E Linux broker binary not provisioned")
		}
		t.Skip("opt-in: set HOOSHIX_WSLFS_E2E_BROKER to reviewed Linux executable")
	}
	// Also support a reviewed cross-compiled Linux test ELF exposed by
	// WSL's normal /mnt mount. It is only executed, never modified in place.
	// This is a test-only input; production enrollment still requires the
	// installed and digest-verified Linux broker under the WSL user's home.
	fromTemp := strings.HasPrefix(broker, "/tmp/hooshix-wslfs-e2e-")
	fromMount := strings.HasPrefix(broker, "/mnt/") &&
		strings.HasSuffix(broker, "/hooshix-wsl-fs-broker-e2e-linux-amd64")
	if (!fromTemp && !fromMount) || path.Clean(broker) != broker || strings.Contains(broker, "..") {
		t.Fatal("E2E broker must be an isolated /tmp artifact or a reviewed mounted test ELF")
	}
	expectedDigest := os.Getenv("HOOSHIX_WSLFS_E2E_BROKER_SHA256")
	if !regexp.MustCompile("^[a-f0-9]{64}$").MatchString(expectedDigest) {
		t.Fatal("WSL E2E broker SHA-256 must be explicitly provided")
	}
	actualLine := runWSLFSFixtureCommand(t, "", "/usr/bin/sha256sum", "--", broker)
	actualHash, _, ok := strings.Cut(actualLine, " ")
	if !ok || actualHash != expectedDigest {
		t.Fatal("E2E executable digest does not match the reviewed Linux broker")
	}
	current, err := currentSID()
	if err != nil {
		t.Fatal(err)
	}
	if sameSID(current, systemSID) {
		t.Fatal("real WSL integration must run as signed-in Windows owner, not SYSTEM")
	}
	ownerRoot := ownerOwnedTestRoot(t)
	canonical, err := CanonicalRoot(ownerRoot)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if !sameSID(owner, current) {
		t.Fatal("temporary Windows anchor is not owned by current principal")
	}
	linuxRoot := runWSLFSFixtureCommand(t, "", "/usr/bin/mktemp", "-d", "-p", "/tmp", "hooshix-wslfs-e2e-workspace-XXXXXXXX")
	if !strings.HasPrefix(linuxRoot, "/tmp/hooshix-wslfs-e2e-workspace-") ||
		strings.ContainsAny(linuxRoot, "\r\n") || path.Clean(linuxRoot) != linuxRoot {
		t.Fatal("temporary Linux fixture path failed validation")
	}
	t.Cleanup(func() {
		// Cleanup is allowed only for a unique mktemp fixture created by this test.
		cmd := exec.Command("wsl.exe", "--distribution", "Ubuntu", "--exec",
			"/usr/bin/rm", "-rf", "--", linuxRoot)
		if out, e := cmd.CombinedOutput(); e != nil {
			t.Logf("WSL temporary cleanup failed: %v (%s)", e, out)
		}
	})
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "init", "-q")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "config", "user.name", "HooshiX WSL E2E")
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "config", "user.email", "wsl-e2e@example.invalid")
	children := []*exec.Cmd{}
	t.Cleanup(func() {
		for _, child := range children {
			if child.Process != nil {
				_ = child.Process.Kill()
				_ = child.Wait()
			}
		}
	})
	for _, kind := range []string{"read", "write", "git"} {
		child := exec.Command(os.Args[0], "-test.run=^TestWSLFSRealBrokerChild$")
		child.Env = append(os.Environ(), "HOOSHIX_WSLFS_E2E_CHILD_KIND="+kind,
			"HOOSHIX_WSLFS_E2E_OWNER_ROOT="+canonical,
			"HOOSHIX_WSLFS_E2E_LINUX_ROOT="+linuxRoot,
			"HOOSHIX_WSLFS_E2E_BROKER="+broker)
		if err := child.Start(); err != nil {
			t.Fatalf("could not start %s owner worker: %v", kind, err)
		}
		children = append(children, child)
	}
	// Exercise IPC independently through each named pipe rather than bypassing
	// the owner worker and invoking WSL directly.
	for _, kind := range []string{"read", "write", "git"} {
		var ready bool
		for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); {
			req := wslfs.Request{Version: 1, Operation: "probe", Path: "."}
			var response wslfs.Response
			var e error
			switch kind {
			case "read":
				response, e = ProxyWSLFiles(canonical, req)
			case "write":
				response, e = ProxyWSLFileWrites(canonical, req)
			case "git":
				response, e = ProxyWSLGitWriteProbe(canonical, req)
			}
			if e == nil && response.OK && response.Distro == "Ubuntu" && response.LinuxRoot == linuxRoot {
				ready = true
				break
			}
			time.Sleep(150 * time.Millisecond)
		}
		if !ready {
			t.Fatalf("%s owner WSL pipe did not attest actual Linux root", kind)
		}
	}
	// Read pipe cannot gain write permission from the separately running writer.
	if _, err := ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "create",
		Path: "blocked.txt", Content: "unsafe"}); err == nil {
		t.Fatal("read-only owner pipe accepted file mutation")
	}
	if _, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_branch", Path: ".", Query: "bad"}, "Ubuntu", linuxRoot); err == nil {
		t.Fatal("file-write pipe accepted Git mutation")
	}
	if _, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "create", Path: "bad.txt", Content: "unsafe"}, "Ubuntu", linuxRoot); err == nil {
		t.Fatal("Git-write pipe accepted file mutation")
	}
	if mismatch, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "create", Path: "mismatch.txt", Content: "unsafe"}, "Ubuntu", linuxRoot+"-other"); err == nil && mismatch.OK {
		t.Fatal("write worker accepted mismatched Linux root")
	}
	made, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "create", Path: "hello.txt", Content: "hello WSL E2E"}, "Ubuntu", linuxRoot)
	if err != nil || !made.OK || !made.Created {
		t.Fatalf("native create failed: %+v %v", made, err)
	}
	observed, err := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "read", Path: "hello.txt", IncludeSHA256: true})
	if err != nil || !observed.OK || observed.Content != "hello WSL E2E" || len(observed.SHA256) != 64 {
		t.Fatalf("owner read over WSL pipe failed: %+v %v", observed, err)
	}
	listed, err := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "list", Path: "."})
	if err != nil || !listed.OK || len(listed.Entries) == 0 {
		t.Fatalf("owner WSL list failed: %+v %v", listed, err)
	}
	staged, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_add", Path: ".", Paths: []string{"hello.txt"}}, "Ubuntu", linuxRoot)
	if err != nil || !staged.OK || staged.StagedFiles != 1 {
		t.Fatalf("owner Git staging failed: %+v %v", staged, err)
	}
	committed, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_commit", Path: ".", Content: "test commit"}, "Ubuntu", linuxRoot)
	// The current Git commit protocol intentionally rejects unborn HEAD.
	if err != nil {
		t.Fatalf("Git commit IPC transport failed: %v", err)
	}
	if committed.OK {
		t.Fatal("unborn HEAD unexpectedly accepted by restricted Git commit")
	}
	// Construct first commit with fixture Git, then exercise native branch and
	// no-worktree-change checkout through the owner Git write pipe.
	runWSLFSFixtureCommand(t, linuxRoot, "/usr/bin/git", "-c", "user.name=HooshiX E2E",
		"-c", "user.email=wsl-e2e@example.invalid", "commit", "-qm", "initial")
	branch, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_branch", Path: ".", Query: "feature/e2e"}, "Ubuntu", linuxRoot)
	if err != nil || !branch.OK {
		t.Fatalf("native Git branch failed: %+v %v", branch, err)
	}
	switched, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_checkout", Path: ".", Query: "feature/e2e"}, "Ubuntu", linuxRoot)
	if err != nil || !switched.OK || switched.GitStdout != "feature/e2e" {
		t.Fatalf("native Git checkout failed: %+v %v", switched, err)
	}
	// Exercise revision-bound file mutation and restoration through the
	// actual independent owner Windows write pipe, not a mock transport.
	updatedText := "hello WSL updated"
	written, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "write_existing", Path: "hello.txt", Content: updatedText,
		ExpectedSHA256: observed.SHA256}, "Ubuntu", linuxRoot)
	if err != nil || !written.OK || len(written.SHA256) != 64 {
		t.Fatalf("owner native write failed: %+v %v", written, err)
	}
	stale, staleErr := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "write_existing", Path: "hello.txt", Content: "stale write",
		ExpectedSHA256: observed.SHA256}, "Ubuntu", linuxRoot)
	if staleErr == nil && stale.OK {
		t.Fatal("stale WSL write revision overwrote newer content")
	}
	changed, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "modify_existing", Path: "hello.txt", Query: "updated", Content: "changed",
		ExpectedSHA256: written.SHA256}, "Ubuntu", linuxRoot)
	if err != nil || !changed.OK || changed.ReplacedOccurrences != 1 {
		t.Fatalf("owner native modify failed: %+v %v", changed, err)
	}
	deleted, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "delete_existing", Path: "hello.txt",
		ExpectedSHA256: changed.SHA256}, "Ubuntu", linuxRoot)
	if err != nil || !deleted.OK {
		t.Fatalf("owner native delete failed: %+v %v", deleted, err)
	}
	absent, err := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "stat", Path: "hello.txt"})
	if err != nil || !absent.OK || absent.State != "absent" {
		t.Fatalf("deleted file not verified absent: %+v %v", absent, err)
	}
	recovered, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "restore_deleted", Path: "hello.txt", Content: "hello WSL changed",
		ExpectedSHA256: changed.SHA256}, "Ubuntu", linuxRoot)
	if err != nil || !recovered.OK || !recovered.Restored {
		t.Fatalf("native deleted-file recovery failed: %+v %v", recovered, err)
	}
	restored, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "restore_modified", Path: "hello.txt", Content: updatedText,
		ExpectedSHA256: recovered.SHA256, RestoredSHA256: written.SHA256}, "Ubuntu", linuxRoot)
	if err != nil || !restored.OK || !restored.Restored {
		t.Fatalf("native prior-text restoration failed: %+v %v", restored, err)
	}
	finalState, err := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "read", Path: "hello.txt", IncludeSHA256: true})
	if err != nil || !finalState.OK || finalState.Content != updatedText ||
		finalState.SHA256 != written.SHA256 {
		t.Fatalf("read-after-restore mismatch: %+v %v", finalState, err)
	}
	// Undo creation without clobbering an externally modified file.
	newFile, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "create", Path: "transient.txt", Content: "transient"}, "Ubuntu", linuxRoot)
	if err != nil || !newFile.OK {
		t.Fatalf("transient create failed: %+v %v", newFile, err)
	}
	undone, err := ProxyWSLFileWritesBound(canonical, wslfs.Request{Version: 1,
		Operation: "restore_created", Path: "transient.txt",
		ExpectedSHA256: newFile.SHA256}, "Ubuntu", linuxRoot)
	if err != nil || !undone.OK || !undone.Restored {
		t.Fatalf("undo create failed: %+v %v", undone, err)
	}
	// Native Git write follows normal commit authoring once HEAD exists.
	restaged, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_add", Path: ".", Paths: []string{"hello.txt"}}, "Ubuntu", linuxRoot)
	if err != nil || !restaged.OK || restaged.StagedFiles != 1 {
		t.Fatalf("native Git stage after modifications failed: %+v %v", restaged, err)
	}
	commitRequestID := "b9ba430ce7cc4774a0621603b5ed1fd8"
	committedNative, err := ProxyWSLGitWriteBound(canonical, wslfs.Request{Version: 1,
		Operation: "git_commit", Path: ".", Query: commitRequestID,
		Content: "Native IPC commit"}, "Ubuntu", linuxRoot)
	if err != nil || !committedNative.OK || len(committedNative.GitStdout) < 40 {
		t.Fatalf("native Git commit failed: %+v %v", committedNative, err)
	}
	// The read-only owner pipe can reconcile the exact mutation nonce even
	// if the response to the Git-write owner pipe was dropped after ref CAS.
	confirmed, confirmErr := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "git_commit_reconcile", Path: ".", Query: commitRequestID})
	if confirmErr != nil || !confirmed.OK || confirmed.State != "applied" ||
		confirmed.GitStdout != committedNative.GitStdout {
		t.Fatalf("real owner-pipe read reconciliation failed: %+v %v", confirmed, confirmErr)
	}
	unknown, unknownErr := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "git_commit_reconcile", Path: ".",
		Query: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	if unknownErr != nil || !unknown.OK || unknown.State != "unresolved" {
		t.Fatalf("unrecognized mutation must remain unresolved: %+v %v", unknown, unknownErr)
	}
	log, err := ProxyWSLFiles(canonical, wslfs.Request{Version: 1,
		Operation: "git_log", Path: ".", Query: "1"})
	if err != nil || !log.OK || !strings.Contains(log.GitStdout, "Native IPC commit") {
		t.Fatalf("native Git read-after-commit failed: %+v %v", log, err)
	}
	// Independently verify SHA-256 of bytes traversing all three processes.
	observedFileDigest := sha256.Sum256([]byte(updatedText))
	if finalState.SHA256 != hex.EncodeToString(observedFileDigest[:]) {
		t.Fatal("native IPC file checksum inconsistent")
	}
	t.Log("owner Windows named pipes -> Ubuntu native broker read/write/restore/Git succeeded on disposable root")
}
