//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootGitAdd(_ *os.Root, _ []string) (Response, error) {
	return Err("wslgit_add_requires_linux"), errors.New("Linux-only Git staging")
}
