//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootGitRead(_ *os.Root, _ string, _ string) (Response, error) {
	return Err("wslgit_requires_linux"), errors.New("Linux broker required")
}
