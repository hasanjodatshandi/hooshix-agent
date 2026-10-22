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

func TestWSLFSCreateRequiresSeparateCapability(t *testing.T) {
	root := t.TempDir()
	// The Linux broker may implement create, but the existing owner enrollment
	// is read-only. Windows IPC must not silently inherit write authority.
	req := WSLFileRequest{
		Version: 1,
		Root:    root,
		File:    wslfs.Request{Version: 1, Operation: "create", Path: "new.txt", Content: "payload"},
	}
	if err := validateFSRequest(req, root); err == nil {
		t.Fatal("read-only owner-session broker unexpectedly authorized create_file")
	}
}

func TestWSLFSRestoreRequiresSeparateCapability(t *testing.T) {
	root := t.TempDir()
	req := WSLFileRequest{
		Version: 1,
		Root:    root,
		File: wslfs.Request{
			Version: 1, Operation: "restore_deleted", Path: "restored.txt",
			Content: "original", ExpectedSHA256: strings.Repeat("a", 64),
		},
	}
	if err := validateFSRequest(req, root); err == nil {
		t.Fatal("read-only owner-session worker unexpectedly authorized restore_deleted")
	}
}

func TestAllWSLFileMutationsRequireNewOwnerWriteGrant(t *testing.T) {
	root := t.TempDir()
	for _, op := range []string{"create", "write_existing", "modify_existing", "delete_existing",
		"restore_deleted", "restore_modified", "restore_created"} {
		req := WSLFileRequest{Version: 1, Root: root, File: wslfs.Request{
			Version: 1, Operation: op, Path: "file.txt", Content: "test", ExpectedSHA256: strings.Repeat("a", 64),
		}}
		if err := validateFSRequest(req, root); err == nil {
			t.Fatalf("read-only worker unexpectedly accepted %s", op)
		}
	}
}

func TestWSLFSWritePipeIsSeparateFromReadOnlyGrant(t *testing.T) {
	root := t.TempDir()
	if WSLFileWritePipeName(root) == WSLFilePipeName(root) {
		t.Fatal("write pipe must have a separate identity")
	}
	if !strings.Contains(WSLFileWritePipeName(root), "HooshiXWSLFSWriteWorker-") {
		t.Fatal("write pipe prefix incorrect")
	}
	for _, op := range []string{"create", "write_existing", "modify_existing", "delete_existing",
		"restore_deleted", "restore_modified", "restore_created"} {
		req := WSLFileRequest{Version: 1, Root: root, File: wslfs.Request{
			Version: 1, Operation: op, Path: "src/file.txt",
		}}
		if err := validateFSRequest(req, root); err == nil {
			t.Fatalf("read-only capability accepted %s", op)
		}
		if err := validateWSLFileRequest(req, root, true); err != nil {
			t.Fatalf("explicit write pipe rejected %s: %v", op, err)
		}
	}
	for _, op := range []string{"read", "stat", "list", "search", "not-an-operation"} {
		req := WSLFileRequest{Version: 1, Root: root, File: wslfs.Request{Version: 1, Operation: op, Path: "."}}
		if err := validateWSLFileRequest(req, root, true); err == nil {
			t.Fatalf("write pipe inappropriately accepted %s", op)
		}
	}
	probe := WSLFileRequest{Version: 1, Root: root, File: wslfs.Request{Version: 1, Operation: "probe", Path: "."}}
	if err := validateWSLFileRequest(probe, root, true); err != nil {
		t.Fatalf("write pipe must attest enrollment: %v", err)
	}
}

func TestWSLFSWriteRootIsPinnedInsideOwnerWorker(t *testing.T) {
	request := WSLFileRequest{
		Version: 1, Root: "D:\\workspace\\hooshix-agent",
		ExpectedDistro: "Ubuntu", ExpectedLinuxRoot: "/home/coder/workspace/Hooshix",
		File: wslfs.Request{Version: 1, Operation: "write_existing", Path: "README.md"},
	}
	if err := validateWSLWriteRootBinding(request, "Ubuntu", "/home/coder/workspace/Hooshix", true); err != nil {
		t.Fatalf("exact root denied: %v", err)
	}
	for _, candidate := range []struct{ distro, root string }{
		{"Debian", "/home/coder/workspace/Hooshix"},
		{"Ubuntu", "/home/coder/workspace/Other"},
		{"ubuntu", "/home/coder/workspace/Hooshix"},
		{"Ubuntu", "/home/coder/workspace/Hooshix2"},
	} {
		if err := validateWSLWriteRootBinding(request, candidate.distro, candidate.root, true); err == nil {
			t.Fatalf("write worker accepted other distro/root: %+v", candidate)
		}
	}
	request.ExpectedDistro = ""
	if err := validateWSLWriteRootBinding(request, "Ubuntu", "/home/coder/workspace/Hooshix", true); err == nil {
		t.Fatal("unbound write was accepted")
	}
	request.File.Operation = "probe"
	if err := validateWSLWriteRootBinding(request, "Ubuntu", "/home/coder/workspace/Hooshix", true); err != nil {
		t.Fatalf("owner enrollment probe should not require write binding: %v", err)
	}
}

func TestWSLGitMutationPipeIsIndependentAndRootBound(t *testing.T) {
	root := t.TempDir()
	pipe := WSLGitWritePipeName(root)
	if pipe == WSLFilePipeName(root) || pipe == WSLFileWritePipeName(root) {
		t.Fatal("Git write enrollment shares an existing WSL permission")
	}
	if !strings.Contains(pipe, "HooshiXWSLGitWriteWorker-") {
		t.Fatalf("unexpected Git write pipe name: %q", pipe)
	}
	req := WSLFileRequest{Version: 1, Root: root, ExpectedDistro: "Ubuntu",
		ExpectedLinuxRoot: "/home/coder/workspace/Hooshix",
		File:              wslfs.Request{Version: 1, Operation: "git_branch", Path: ".", Query: "feature/new"}}
	if err := validateWSLFileRequestPolicy(req, root, false, true); err != nil {
		t.Fatalf("Git branch write denied: %v", err)
	}
	add := req
	add.File.Operation = "git_add"
	add.File.Query = ""
	add.File.Paths = []string{"README.md"}
	if err := validateWSLFileRequestPolicy(add, root, false, true); err != nil {
		t.Fatalf("scoped git_add unexpectedly denied: %v", err)
	}
	if err := validateWSLFileRequestPolicy(add, root, false, false); err == nil {
		t.Fatal("read-only worker accepted git_add")
	}
	if err := validateWSLFileRequestPolicy(add, root, true, false); err == nil {
		t.Fatal("file write worker accepted git_add")
	}
	add.File.Paths = []string{"../outside"}
	if err := validateWSLFileRequestPolicy(add, root, false, true); err == nil {
		t.Fatal("git add path traversal accepted")
	}
	commit := req
	commit.File.Operation = "git_commit"
	commit.File.Query = ""
	commit.File.Content = "Commit from WSL"
	if err := validateWSLFileRequestPolicy(commit, root, false, true); err != nil {
		t.Fatalf("Git commit owner capability denied: %v", err)
	}
	if err := validateWSLFileRequestPolicy(commit, root, false, false); err == nil {
		t.Fatal("read-only pipe accepted commit")
	}
	if err := validateWSLFileRequestPolicy(commit, root, true, false); err == nil {
		t.Fatal("file write pipe accepted commit")
	}
	constID := "1234567890abcdef1234567890abcdef"
	reconcile := req
	reconcile.File.Operation = "git_commit_reconcile"
	reconcile.File.Query = constID
	if err := validateWSLFileRequestPolicy(reconcile, root, false, false); err != nil {
		t.Fatalf("read-only reconciliation incorrectly denied: %v", err)
	}
	if err := validateWSLFileRequestPolicy(reconcile, root, false, true); err == nil {
		t.Fatal("Git-write-only pipe incorrectly gained reconciliation read")
	}
	if err := validateWSLFileRequestPolicy(reconcile, root, true, false); err == nil {
		t.Fatal("file-write pipe incorrectly gained reconciliation read")
	}
	reconcile.File.Query = "invalid"
	if err := validateWSLFileRequestPolicy(reconcile, root, false, false); err == nil {
		t.Fatal("invalid reconciliation token accepted")
	}
	commit.File.Query = constID
	if err := validateWSLFileRequestPolicy(commit, root, false, true); err != nil {
		t.Fatalf("valid Git commit request ID unexpectedly denied: %v", err)
	}
	commit.File.Query = "bad!"
	if err := validateWSLFileRequestPolicy(commit, root, false, true); err == nil {
		t.Fatal("invalid Git commit request ID accepted")
	}
	checkout := req
	checkout.File.Operation = "git_checkout"
	checkout.File.Query = "feature/same-tree"
	if err := validateWSLFileRequestPolicy(checkout, root, false, true); err != nil {
		t.Fatalf("scoped checkout rejected by Git write pipe: %v", err)
	}
	if err := validateWSLFileRequestPolicy(checkout, root, false, false); err == nil {
		t.Fatal("read-only pipe accepted checkout")
	}
	if err := validateWSLFileRequestPolicy(checkout, root, true, false); err == nil {
		t.Fatal("file-write pipe accepted checkout")
	}
	if err := validateWSLWriteRootBinding(req, "Ubuntu", "/home/coder/workspace/Hooshix", true); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []struct{ filesystemWrite, gitWrite bool }{{false, false}, {true, false}} {
		if err := validateWSLFileRequestPolicy(req, root, mode.filesystemWrite, mode.gitWrite); err == nil {
			t.Fatalf("Git branch escaped capability into file pipe: %+v", mode)
		}
	}
	for _, op := range []string{"read", "git_status", "git_diff", "git_log", "write_existing", "delete_existing", "restore_modified"} {
		candidate := req
		candidate.File.Operation = op
		if err := validateWSLFileRequestPolicy(candidate, root, false, true); err == nil {
			t.Fatalf("Git write pipe accepted %q", op)
		}
	}
	candidate := req
	candidate.ExpectedLinuxRoot = "/home/coder/workspace/Other"
	if err := validateWSLWriteRootBinding(candidate, "Ubuntu", "/home/coder/workspace/Hooshix", true); err == nil {
		t.Fatal("Git mutation to wrong enrolled Linux root accepted")
	}
}

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
	root := ownerOwnedTestRoot(t)
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
