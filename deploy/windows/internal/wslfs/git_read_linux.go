//go:build linux

package wslfs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"
	"unicode/utf8"
)

// Read-only Git operations are a *fixed argv allowlist*. No shell, Git
// hook, external diff driver, fsmonitor, pager, or arbitrary command string.
// The child is launched with cwd bound to a confined Linux directory fd,
// not a Windows UNC path or string-concatenated -C argument.
func secureRootGitRead(root *os.Root, operation, query string) (Response, error) {
	cwd, err := secureRootOpen(root, ".")
	if err != nil {
		return Err("wslgit_root_unavailable"), err
	}
	defer cwd.Close()
	info, err := cwd.Stat()
	if err != nil || !info.IsDir() {
		return Err("wslgit_root_not_directory"), errors.New("root unavailable")
	}
	git, err := secureRootOpen(root, ".git")
	if err != nil {
		return Err("wslgit_repository_unavailable"), err
	}
	meta, err := git.Stat()
	git.Close()
	if err != nil || !meta.IsDir() {
		return Err("wslgit_repository_not_directory"), errors.New("unsupported gitdir")
	}
	var args []string
	switch operation {
	case "git_status":
		if query != "" {
			return Err("wslgit_invalid_query"), errors.New("unexpected Git args")
		}
		args = []string{"status", "--porcelain=v1", "--branch", "--untracked-files=normal", "--ignore-submodules=all"}
	case "git_diff":
		if query != "" && query != "staged" {
			return Err("wslgit_invalid_query"), errors.New("unexpected diff args")
		}
		args = []string{"diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", "--no-renames"}
		if query == "staged" {
			args = append(args, "--cached")
		}
		args = append(args, "--")
	case "git_log":
		if query == "" {
			query = "20"
		}
		limit, e := strconv.Atoi(query)
		if e != nil || limit < 1 || limit > 100 || strconv.Itoa(limit) != query {
			return Err("wslgit_invalid_limit"), errors.New("invalid log limit")
		}
		args = []string{"log", "--oneline", "--decorate=short", "--no-show-signature", "--no-patch", "--max-count=" + query}
	default:
		return Err("wslgit_operation_denied"), errors.New("unsupported Git")
	}
	// Clear host-provided Git env and disable repo-controlled external programs.
	// Repository-local core.worktree is untrusted. Override it with the same
	// pinned directory-fd reference used for the child cwd.
	pinnedWorktree := fmt.Sprintf("/proc/%d/fd/%d", os.Getpid(), cwd.Fd())
	prefix := []string{"-c", "core.worktree=" + pinnedWorktree, "-c", "core.bare=false",
		"-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
		"-c", "diff.external=", "-c", "core.pager=cat", "-c", "diff.trustExitCode=false",
		"-c", "core.attributesFile=/dev/null", "-c", "protocol.allow=never"}
	args = append(prefix, args...)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/git", args...)
	// Chdir through the pinned *parent* descriptor. This Linux /proc path
	// remains bound to the open inode even if its original name is swapped.
	cmd.Dir = pinnedWorktree
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "LANG=C.UTF-8",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0", "GIT_PAGER=cat", "GIT_EXTERNAL_DIFF=", "GIT_NO_REPLACE_OBJECTS=1"}
	var stdout, stderr limitedGitCapture
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ctx.Err() != nil {
		return Err("wslgit_timeout"), errors.New("Git read timeout")
	}
	if stdout.exceeded || stderr.exceeded {
		return Err("wslgit_response_limit"), errors.New("Git output too large")
	}
	if err != nil {
		if _, ok := err.(*exec.ExitError); ok {
			return Err("wslgit_operation_failed"), err
		}
		return Err("wslgit_unavailable"), err
	}
	if !utf8.Valid(stdout.buf) || !utf8.Valid(stderr.buf) {
		return Err("wslgit_invalid_output"), errors.New("not utf8")
	}
	return Response{OK: true, GitStdout: string(stdout.buf), GitStderr: string(stderr.buf)}, nil
}

const maxGitOutput = 1024 * 1024

type limitedGitCapture struct {
	buf      []byte
	exceeded bool
}

func (c *limitedGitCapture) Write(p []byte) (int, error) {
	n := len(p)
	if len(c.buf)+n > maxGitOutput {
		room := maxGitOutput - len(c.buf)
		if room > 0 {
			c.buf = append(c.buf, p[:room]...)
		}
		c.exceeded = true
		return n, nil
	}
	c.buf = append(c.buf, p...)
	return n, nil
}
