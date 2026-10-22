//go:build linux

package wslfs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// No shell, no arbitrary argv, no ref deletion or forced update. Creating a
// new local branch is a narrowly-scoped, non-worktree-mutating Git write.
// This entrypoint must only be reachable through a separately enrolled Git
// WRITE owner-session pipe; read and file-write pipes both reject it.
var safeGitBranch = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$`)

func validateNewGitBranch(name string) error {
	if !safeGitBranch.MatchString(name) || strings.Contains(name, "..") ||
		strings.Contains(name, "//") || strings.Contains(name, "@{") ||
		strings.HasSuffix(name, ".") || strings.HasSuffix(name, "/") ||
		strings.HasSuffix(name, ".lock") || strings.HasPrefix(name, "-") {
		return errors.New("wslgit_branch_name_invalid")
	}
	// Git ref format restrictions beyond ASCII safety are checked by git itself.
	return nil
}

func validatePinnedGitBranchMetadata(root *os.Root, branch string) error {
	// Worktrees and alternates redirect repository metadata outside the
	// attested root. This limited native mutation does not support them.
	for _, rel := range []string{".git/commondir", ".git/objects/info/alternates",
		".git/config.worktree"} {
		_, err := root.Lstat(rel)
		if err == nil {
			return errors.New("redirected Git metadata denied")
		}
		if !os.IsNotExist(err) {
			return err
		}
	}
	for _, rel := range []string{".git/HEAD", ".git/config"} {
		fd, err := secureRootOpen(root, rel)
		if err != nil {
			return err
		}
		info, e := fd.Stat()
		fd.Close()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() {
			return errors.New("Git metadata must be regular")
		}
	}
	prefixes := []string{".git/refs", ".git/refs/heads",
		".git/logs", ".git/logs/refs", ".git/logs/refs/heads"}
	components := strings.Split(branch, "/")
	if len(components) > 1 {
		parent := ""
		for _, part := range components[:len(components)-1] {
			parent = path.Join(parent, part)
			prefixes = append(prefixes, ".git/refs/heads/"+parent, ".git/logs/refs/heads/"+parent)
		}
	}
	for _, rel := range prefixes {
		st, err := root.Lstat(rel)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !st.IsDir() {
			return errors.New("Git refs/reflog directory redirected")
		}
		opened, err := secureRootOpen(root, rel)
		if err != nil {
			return err
		}
		check, e := opened.Stat()
		opened.Close()
		if e != nil {
			return e
		}
		if !check.IsDir() {
			return errors.New("Git refs directory not confined")
		}
	}
	return nil
}

func secureRootGitCreateBranch(root *os.Root, branch string) (Response, error) {
	if err := validateNewGitBranch(branch); err != nil {
		return Err("wslgit_branch_name_invalid"), err
	}
	cwd, err := secureRootOpen(root, ".")
	if err != nil {
		return Err("wslgit_root_unavailable"), err
	}
	defer cwd.Close()
	info, err := cwd.Stat()
	if err != nil || !info.IsDir() {
		return Err("wslgit_root_not_directory"), errors.New("root not directory")
	}
	git, err := secureRootOpen(root, ".git")
	if err != nil {
		return Err("wslgit_repository_unavailable"), err
	}
	info, err = git.Stat()
	git.Close()
	if err != nil || !info.IsDir() {
		return Err("wslgit_repository_invalid"), errors.New("gitdir not directory")
	}
	// Git writes refs and reflogs. Refuse redirected metadata and nested
	// symlink parents before allowing even a constrained branch operation.
	if e := validatePinnedGitBranchMetadata(root, branch); e != nil {
		return Err("wslgit_unsafe_repository_metadata"), e
	}
	pinned := fmt.Sprintf("/proc/%d/fd/%d", os.Getpid(), cwd.Fd())
	args := []string{
		"-c", "core.worktree=" + pinned,
		"-c", "core.bare=false",
		"-c", "core.hooksPath=/dev/null",
		"-c", "core.fsmonitor=false",
		"-c", "commit.gpgsign=false",
		"-c", "tag.gpgsign=false",
		"-c", "protocol.allow=never",
		"branch", "--", branch,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/git", args...)
	cmd.Dir = pinned
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "LANG=C.UTF-8",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "GIT_PAGER=cat",
		"GIT_EXTERNAL_DIFF=", "GIT_NO_REPLACE_OBJECTS=1",
	}
	var out, errout limitedGitCapture
	cmd.Stdout = &out
	cmd.Stderr = &errout
	err = cmd.Run()
	if ctx.Err() != nil {
		return Err("wslgit_branch_outcome_unknown_timeout"), errors.New("Git branch timeout")
	}
	if out.exceeded || errout.exceeded {
		return Err("wslgit_branch_outcome_unknown_response_limit"), errors.New("Git output limit")
	}
	if err != nil {
		return Err("wslgit_branch_failed_or_outcome_unknown"), err
	}
	if !utf8.Valid(out.buf) || !utf8.Valid(errout.buf) {
		return Err("wslgit_branch_invalid_output"), errors.New("non utf8")
	}
	return Response{OK: true, GitStdout: string(out.buf), GitStderr: string(errout.buf)}, nil
}
