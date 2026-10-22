//go:build linux

package wslfs

import (
	"bytes"
	"errors"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Create a commit with plumbing only, and advance precisely the expected
// local HEAD ref using update-ref CAS. Hooks, editors, shell commands,
// signing helpers, and arbitrary revision arguments never run.
// Unborn HEAD, detached HEAD, redirected Git metadata and force updates
// are intentionally unsupported.
// verifyPinnedGitStagingUnchanged must be called while the caller owns
// Git's index.lock. It compares all staged names, modes, stages and object IDs;
// cache-tree extension rewrites by write-tree are intentionally ignored.
func verifyPinnedGitStagingUnchanged(cwd *os.File, previous []byte) error {
	current, err := runPinnedGit(cwd, []string{"ls-files", "--stage", "-z"}, nil)
	if err != nil {
		return err
	}
	if !bytes.Equal(previous, current) {
		return errors.New("Git staged entries changed during commit")
	}
	return nil
}

var gitCommitRequestID = regexp.MustCompile(`^[0-9a-f]{32}$`)

// A killed Git reference transaction may leave an exclusive ref lock.
// A future commit must not treat this as authorization to clear a lock,
// overwrite a competing writer, or blindly replay an unknown outcome.
// This early check is only advisory against races; Git's own lock and CAS
// remain the final authority during update-ref.
func checkGitCommitReferenceLocks(root *os.Root, ref string) error {
	if !strings.HasPrefix(ref, "refs/heads/") ||
		validateNewGitBranch(strings.TrimPrefix(ref, "refs/heads/")) != nil {
		return errors.New("invalid Git ref for lock inspection")
	}
	for _, rel := range []string{
		".git/HEAD.lock",
		".git/packed-refs.lock",
		".git/" + ref + ".lock",
	} {
		if _, err := root.Lstat(rel); err == nil {
			return errors.New("Git reference transaction lock exists")
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// A request ID marks the durable Git object so an ambiguous IPC result can
// later be reconciled over a READ-ONLY owner pipe. An unrecognized token is
// rejected before doing anything that writes to the repository.
func secureRootGitCommit(root *os.Root, message string) (Response, error) {
	return secureRootGitCommitWithPostCAS(root, message, "", nil)
}
func secureRootGitCommitWithPostCAS(root *os.Root, message, requestID string, afterCAS func(string) error) (Response, error) {
	if requestID != "" && !gitCommitRequestID.MatchString(requestID) {
		return Err("wslgit_commit_invalid_request_id"), errors.New("invalid Git commit request ID")
	}

	if len(message) < 1 || len(message) > 500 || !utf8.ValidString(message) ||
		strings.ContainsRune(message, 0) || strings.TrimSpace(message) == "" {
		return Err("wslgit_invalid_commit_message"), errors.New("invalid commit message")
	}
	if err := checkGitIndexAndObjects(root); err != nil {
		return Err("wslgit_unsafe_git_metadata"), err
	}
	cwd, err := secureRootOpen(root, ".")
	if err != nil {
		return Err("wslgit_workspace_unavailable"), err
	}
	defer cwd.Close()
	refBytes, err := runPinnedGit(cwd, []string{"symbolic-ref", "--quiet", "HEAD"}, nil)
	if err != nil {
		return Err("wslgit_detached_or_unborn_head"), err
	}
	ref := strings.TrimSpace(string(refBytes))
	if !strings.HasPrefix(ref, "refs/heads/") ||
		validateNewGitBranch(strings.TrimPrefix(ref, "refs/heads/")) != nil {
		return Err("wslgit_head_ref_invalid"), errors.New("invalid branch ref")
	}
	name := strings.TrimPrefix(ref, "refs/heads/")
	if err := validatePinnedGitBranchMetadata(root, name); err != nil {
		return Err("wslgit_unsafe_git_refs"), err
	}
	if err := checkGitCommitReferenceLocks(root, ref); err != nil {
		return Err("wslgit_ref_lock_busy_or_unsafe"), err
	}
	for _, rel := range []string{".git/" + ref, ".git/logs/" + ref, ".git/packed-refs"} {
		st, err := root.Lstat(rel)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !st.Mode().IsRegular() {
			return Err("wslgit_ref_redirected"), errors.New("reference path not regular")
		}
		f, e := secureRootOpen(root, rel)
		if e != nil {
			return Err("wslgit_ref_unavailable"), e
		}
		f.Close()
	}
	headBytes, err := runPinnedGit(cwd, []string{"rev-parse", "--verify", "HEAD"}, nil)
	if err != nil {
		return Err("wslgit_unborn_head_not_supported"), err
	}
	old := strings.TrimSpace(string(headBytes))
	if !gitObjectID.MatchString(old) {
		return Err("wslgit_invalid_head_object"), errors.New("invalid head OID")
	}
	oldTreeBytes, err := runPinnedGit(cwd, []string{"rev-parse", "--verify", "HEAD^{tree}"}, nil)
	if err != nil {
		return Err("wslgit_head_tree_unavailable"), err
	}
	oldTree := strings.TrimSpace(string(oldTreeBytes))
	// Capture only staged entries (including modes and stages); write-tree is
	// permitted to refresh cache-tree extensions. The index.lock lease begins
	// immediately after write-tree because Git may need its own lock to do so.
	stagedBefore, err := runPinnedGit(cwd, []string{"ls-files", "--stage", "-z"}, nil)
	if err != nil {
		return Err("wslgit_index_snapshot_unavailable"), err
	}
	newTreeBytes, err := runPinnedGit(cwd, []string{"write-tree"}, nil)
	if err != nil {
		return Err("wslgit_write_tree_outcome_unknown"), err
	}
	newTree := strings.TrimSpace(string(newTreeBytes))
	if !gitObjectID.MatchString(newTree) || !gitObjectID.MatchString(oldTree) {
		return Err("wslgit_invalid_tree_object"), errors.New("invalid tree OID")
	}
	if newTree == oldTree {
		return Err("wslgit_nothing_to_commit"), errors.New("no staged changes")
	}
	// git add, git checkout and git commit respect index.lock. Refuse an
	// existing lock rather than guessing whether an unrelated Git operation
	// has completed. The lease protects index verification through ref CAS.
	lease, err := acquireGitIndexLease(root)
	if err != nil {
		return Err("wslgit_index_busy_or_unsafe"), err
	}
	defer lease.Close()
	if err := verifyPinnedGitStagingUnchanged(cwd, stagedBefore); err != nil {
		return Err("wslgit_concurrent_index_change"), err
	}
	// A normal branch switch needs index.lock. Verify the symbolic ref again
	// while holding that lease; update-ref below also CAS-checks the old OID.
	currentBranch, err := runPinnedGit(cwd, []string{"symbolic-ref", "--quiet", "HEAD"}, nil)
	if err != nil || strings.TrimSpace(string(currentBranch)) != ref {
		return Err("wslgit_concurrent_checkout"), errors.New("HEAD changed during Git commit")
	}
	currentHead, err := runPinnedGit(cwd, []string{"rev-parse", "--verify", ref}, nil)
	if err != nil || strings.TrimSpace(string(currentHead)) != old {
		return Err("wslgit_concurrent_ref_change"), errors.New("branch advanced during Git commit")
	}
	commitMessage := message + "\n"
	if requestID != "" {
		commitMessage = strings.TrimRight(message, "\n") +
			"\n\nHooshiX-Request-ID: " + requestID + "\n"
	}
	commitBytes, err := runPinnedGit(cwd, []string{"-c", "commit.gpgsign=false",
		"commit-tree", newTree, "-p", old, "-F", "-"}, []byte(commitMessage))
	if err != nil {
		return Err("wslgit_commit_object_outcome_unknown"), err
	}
	commit := strings.TrimSpace(string(commitBytes))
	if !gitObjectID.MatchString(commit) {
		return Err("wslgit_invalid_commit_object"), errors.New("invalid commit OID")
	}
	if _, err := runPinnedGit(cwd, []string{"update-ref", "--no-deref", ref, commit, old}, nil); err != nil {
		return Err("wslgit_commit_ref_conflict_or_unknown"), err
	}
	// The ref CAS is now durable. Release our advisory index.lock BEFORE the
	// response boundary so a crash/connection loss immediately afterward
	// cannot strand an owned Git index lock. The deferred Close remains as an
	// idempotent cleanup for all earlier failures.
	if err := lease.Close(); err != nil {
		return Err("wslgit_commit_lock_release_outcome_unknown"), err
	}
	// Fault-injection hook only supplied by in-package tests. Production
	// always passes nil; there is no environment variable, IPC flag or
	// public operation capable of injecting a failure.
	if afterCAS != nil {
		if err := afterCAS(commit); err != nil {
			return Err("wslgit_commit_ack_lost_after_cas"), err
		}
	}
	verifiedBranch, verifyErr := runPinnedGit(cwd, []string{"symbolic-ref", "--quiet", "HEAD"}, nil)
	if verifyErr != nil || strings.TrimSpace(string(verifiedBranch)) != ref {
		return Err("wslgit_commit_postcondition_unknown"), errors.New("HEAD changed during or after CAS")
	}
	// Git commit is accepted only after the expected CAS update succeeds;
	// an IPC timeout is NEVER automatically retried by the owner worker.
	return Response{OK: true, GitStdout: commit}, nil
}
