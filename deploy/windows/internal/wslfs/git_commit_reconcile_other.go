//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootGitCommitReconcile(_ *os.Root, _ string) (Response, error) {
	return Err("wslgit_commit_reconcile_linux_required"), errors.New("Linux owner broker required")
}
