//go:build !linux

package wslfs

import (
	"os"
	"strings"
)

// Non-Linux builds use this solely for unit tests; the deployable Linux
// broker requires openat2 with RESOLVE_NO_SYMLINKS and NO_XDEV.
func secureRootOpen(root *os.Root, rel string) (*os.File, error) {
	part := ""
	for _, component := range strings.Split(rel, "/") {
		if part == "" {
			part = component
		} else {
			part += "/" + component
		}
		info, err := root.Lstat(part)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, os.ErrPermission
		}
	}
	return root.Open(rel)
}
