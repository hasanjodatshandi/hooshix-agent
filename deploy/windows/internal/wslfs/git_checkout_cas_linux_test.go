//go:build linux

package wslfs

import (
	"os"
	"strings"
	"testing"
)

// A concurrent Git process switches HEAD after the broker observes the
// original symbolic ref. The CAS must reject the stale request and preserve
// the newer branch, rather than reverting the independent Git writer.
func TestLinuxGitCheckoutCASRejectsStaleHead(t *testing.T) {
	root, initial := checkoutFixture(t)
	if initial == "safe-target" {
		t.Fatal("fixture uses wrong initial branch")
	}
	testGit(t, root, "branch", "competing")
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	pinned, err := secureRootOpen(workspace, ".")
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()

	// Confirm the new transport works with a valid expected symref.
	if err := atomicWSLGitSwitchHead(pinned, "refs/heads/"+initial,
		"refs/heads/safe-target", strings.TrimSpace(gitResult(t, root, "rev-parse", "safe-target"))); err != nil {
		t.Fatalf("atomic symbolic ref switch failed (requires supported Git): %v", err)
	}
	if current := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "HEAD")); current != "refs/heads/safe-target" {
		t.Fatalf("CAS did not switch the symbolic HEAD: %q", current)
	}

	// Simulate an independent writer changing HEAD after our observation.
	testGit(t, root, "symbolic-ref", "HEAD", "refs/heads/competing")
	if err := atomicWSLGitSwitchHead(pinned, "refs/heads/safe-target",
		"refs/heads/"+initial, strings.TrimSpace(gitResult(t, root, "rev-parse", initial))); err == nil {
		t.Fatal("stale expected symbolic HEAD was overwritten")
	}
	if observed := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "HEAD")); observed != "refs/heads/competing" {
		t.Fatalf("CAS clobbered the competing checkout: %q", observed)
	}
	// A fresh expected target should work; no generic shell, checkout or
	// worktree rewrite is performed by this primitive.
	if err := atomicWSLGitSwitchHead(pinned, "refs/heads/competing",
		"refs/heads/"+initial, strings.TrimSpace(gitResult(t, root, "rev-parse", initial))); err != nil {
		t.Fatalf("atomic ref switch did not recover: %v", err)
	}
	if observed := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "HEAD")); observed != "refs/heads/"+initial {
		t.Fatalf("unexpected final HEAD: %q", observed)
	}
}

// A concurrent Git writer advances the target branch after the broker
// has validated its tree. The HEAD CAS and target OID verification must
// fail together so the symbolic HEAD remains on the original branch.
func TestLinuxGitCheckoutCASRejectsChangedTargetTip(t *testing.T) {
	root, initial := checkoutFixture(t)
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	cwd, err := secureRootOpen(workspace, ".")
	if err != nil {
		t.Fatal(err)
	}
	defer cwd.Close()
	beforeTarget := strings.TrimSpace(gitResult(t, root, "rev-parse", "safe-target"))
	// Change the target branch without changing HEAD, as an external Git
	// client can do via an independent ref update.
	testGit(t, root, "commit", "--allow-empty", "-qm", "advanced initial branch")
	testGit(t, root, "branch", "-f", "safe-target", initial)
	// branch -f with the same branch identifier resolves to the new tip.
	afterTarget := strings.TrimSpace(gitResult(t, root, "rev-parse", "safe-target"))
	if afterTarget == beforeTarget {
		t.Fatal("target ref did not advance in fixture")
	}
	if err := atomicWSLGitSwitchHead(cwd, "refs/heads/"+initial,
		"refs/heads/safe-target", beforeTarget); err == nil {
		t.Fatal("CAS allowed a changed target ref OID")
	}
	if observed := strings.TrimSpace(gitResult(t, root, "symbolic-ref", "HEAD")); observed != "refs/heads/"+initial {
		t.Fatalf("stale target CAS changed HEAD: %q", observed)
	}
}

func TestLinuxGitCheckoutCASRejectsInvalidRefInputs(t *testing.T) {
	root, _ := checkoutFixture(t)
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	cwd, err := secureRootOpen(workspace, ".")
	if err != nil {
		t.Fatal(err)
	}
	defer cwd.Close()
	for _, pair := range [][2]string{
		{"refs/heads/main", "refs/heads/main"},
		{"HEAD", "refs/heads/safe-target"},
		{"refs/heads/main", "refs/tags/unsafe"},
		{"refs/heads/main\noption no-deref", "refs/heads/safe-target"},
		{"refs/heads/main", "refs/heads/target\ncommit"},
	} {
		if err := atomicWSLGitSwitchHead(cwd, pair[0], pair[1], strings.Repeat("a", 40)); err == nil {
			t.Fatalf("malformed symbolic-ref CAS accepted %#v", pair)
		}
	}
}
