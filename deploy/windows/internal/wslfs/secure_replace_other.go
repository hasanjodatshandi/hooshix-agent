//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

// Never fall back to unconfined Windows path replacement.
func secureRootReplaceExisting(_ *os.Root, _ string, _ []byte, _ string) error {
	return errors.New("wslfs_mutations_require_linux")
}
