//go:build linux

package wslfs

import (
	"errors"
	"os"
	"strings"
)

// Checkout supports only switching to an EXISTING local branch with the same
// Git tree as HEAD and a clean index/worktree. It NEVER modifies worktree
// files or Git index. Different trees fail closed until the separate
// transactional checkout and backup protocol is implemented.
// atomicWSLGitSwitchHead is a compare-and-swap on the symbolic HEAD target.
// The transaction must use "option no-deref": without it update-ref would
// dereference HEAD and could update the original branch tip instead.
// This requires Git support for the symref-update stdin command; do not
// downgrade to an unconditional symbolic-ref write.
func atomicWSLGitSwitchHead(cwd *os.File, expected, target, targetOID string) error {
	if !strings.HasPrefix(expected, "refs/heads/") ||
		!strings.HasPrefix(target, "refs/heads/") ||
		validateNewGitBranch(strings.TrimPrefix(expected, "refs/heads/")) != nil ||
		validateNewGitBranch(strings.TrimPrefix(target, "refs/heads/")) != nil ||
		expected == target || !gitObjectID.MatchString(targetOID) {
		return errors.New("wslgit_checkout_invalid_cas_refs")
	}
	frame := "option no-deref\nsymref-update HEAD " + target + " ref " + expected + "\n" +
		"verify " + target + " " + targetOID + "\n"
	_, err := runPinnedGit(cwd, []string{"update-ref", "--stdin"}, []byte(frame))
	return err
}

func secureRootGitCheckout(root *os.Root, branch string) (Response, error) {
	if err := validateNewGitBranch(branch); err != nil {
		return Err("wslgit_checkout_branch_invalid"), err
	}
	if err := checkGitIndexAndObjects(root); err != nil {
		return Err("wslgit_checkout_unsafe_git_metadata"), err
	}
	if err := validatePinnedGitBranchMetadata(root, branch); err != nil {
		return Err("wslgit_checkout_unsafe_git_refs"), err
	}
	cwd, err := secureRootOpen(root, ".")
	if err != nil {
		return Err("wslgit_checkout_root_unavailable"), err
	}
	defer cwd.Close()
	ref := "refs/heads/" + branch
	for _, rel := range []string{".git/HEAD", ".git/logs/HEAD",
		".git/" + ref, ".git/logs/" + ref, ".git/packed-refs"} {
		info, e := root.Lstat(rel)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil || !info.Mode().IsRegular() {
			return Err("wslgit_checkout_metadata_redirected"), errors.New("Git ref metadata not regular")
		}
		file, e := secureRootOpen(root, rel)
		if e != nil {
			return Err("wslgit_checkout_metadata_redirected"), e
		}
		file.Close()
	}
	if _, e := root.Lstat(".git/HEAD.lock"); e == nil {
		return Err("wslgit_checkout_head_locked"), errors.New("HEAD.lock exists")
	} else if !os.IsNotExist(e) {
		return Err("wslgit_checkout_head_lock_unknown"), e
	}
	currentBytes, e := runPinnedGit(cwd, []string{"symbolic-ref", "--quiet", "HEAD"}, nil)
	if e != nil {
		return Err("wslgit_checkout_detached_head"), e
	}
	current := strings.TrimSpace(string(currentBytes))
	if !strings.HasPrefix(current, "refs/heads/") ||
		validateNewGitBranch(strings.TrimPrefix(current, "refs/heads/")) != nil {
		return Err("wslgit_checkout_current_ref_invalid"), errors.New("invalid current branch")
	}
	if current == ref {
		return Err("wslgit_checkout_already_on_branch"), errors.New("branch is current")
	}
	if e = validatePinnedGitBranchMetadata(root, strings.TrimPrefix(current, "refs/heads/")); e != nil {
		return Err("wslgit_checkout_current_refs_unsafe"), e
	}
	targetBytes, e := runPinnedGit(cwd, []string{"show-ref", "--verify", "--hash", ref}, nil)
	if e != nil {
		return Err("wslgit_checkout_target_not_found"), e
	}
	if !gitObjectID.MatchString(strings.TrimSpace(string(targetBytes))) {
		return Err("wslgit_checkout_invalid_target_oid"), errors.New("invalid target object")
	}
	currentTree, e := runPinnedGit(cwd, []string{"rev-parse", "--verify", "HEAD^{tree}"}, nil)
	if e != nil {
		return Err("wslgit_checkout_unborn_head"), e
	}
	targetTree, e := runPinnedGit(cwd, []string{"rev-parse", "--verify", ref + "^{tree}"}, nil)
	if e != nil {
		return Err("wslgit_checkout_target_tree_unknown"), e
	}
	currentOID := strings.TrimSpace(string(currentTree))
	targetOID := strings.TrimSpace(string(targetTree))
	if !gitObjectID.MatchString(currentOID) || !gitObjectID.MatchString(targetOID) {
		return Err("wslgit_checkout_invalid_tree"), errors.New("Git tree invalid")
	}
	if currentOID != targetOID {
		return Err("wslgit_checkout_worktree_change_requires_transactional_restore"),
			errors.New("checkout would alter working tree")
	}
	status, e := runPinnedGit(cwd, []string{"status", "--porcelain=v1",
		"--untracked-files=all", "--ignore-submodules=all"}, nil)
	if e != nil {
		return Err("wslgit_checkout_status_unknown"), e
	}
	if len(status) != 0 {
		return Err("wslgit_checkout_dirty_worktree"), errors.New("Git index or worktree is not clean")
	}
	// Revalidate immediately before symbolic HEAD update, which does not run
	// filters or checkout a tree. Non-cooperating external writers remain a
	// release-gating concurrency test.
	fresh, e := runPinnedGit(cwd, []string{"symbolic-ref", "--quiet", "HEAD"}, nil)
	if e != nil || strings.TrimSpace(string(fresh)) != current {
		return Err("wslgit_checkout_head_changed"), errors.New("HEAD was modified")
	}
	freshTree, e := runPinnedGit(cwd, []string{"rev-parse", "--verify", "HEAD^{tree}"}, nil)
	if e != nil || strings.TrimSpace(string(freshTree)) != currentOID {
		return Err("wslgit_checkout_head_changed"), errors.New("HEAD tree changed")
	}
	// Atomically replace the symbolic HEAD only if it still refers to the
	// originally observed branch. A plain "git symbolic-ref HEAD <target>"
	// could silently overwrite a simultaneous checkout between validation and
	// mutation. Older Git without symref-update fails closed.
	if e = atomicWSLGitSwitchHead(cwd, current, ref, strings.TrimSpace(string(targetBytes))); e != nil {
		return Err("wslgit_checkout_head_changed_or_outcome_unknown"), e
	}
	observed, e := runPinnedGit(cwd, []string{"symbolic-ref", "--quiet", "HEAD"}, nil)
	if e != nil || strings.TrimSpace(string(observed)) != ref {
		return Err("wslgit_checkout_postcondition_unknown"), errors.New("symbolic HEAD mismatch")
	}
	return Response{OK: true, GitStdout: branch}, nil
}
