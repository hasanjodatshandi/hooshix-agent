//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootGitCommitWithPostCAS(_ *os.Root, _, _ string, _ func(string) error) (Response, error) {
	return Err("wslgit_commit_requires_linux"), errors.New("Linux-only Git commit")
}

func secureRootGitCommit(_ *os.Root, _ string) (Response, error) {
	return Err("wslgit_commit_requires_linux"), errors.New("Linux-only Git commit")
}
