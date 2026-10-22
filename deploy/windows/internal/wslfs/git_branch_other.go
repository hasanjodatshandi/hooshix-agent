//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootGitCreateBranch(_ *os.Root, _ string) (Response, error) {
	return Err("wslgit_branch_requires_linux"), errors.New("Linux-only Git mutation")
}
