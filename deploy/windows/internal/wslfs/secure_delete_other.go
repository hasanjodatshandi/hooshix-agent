//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootDeleteExisting(_ *os.Root, _ string, _ string) error {
	return errors.New("wslfs_mutations_require_linux")
}
