//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

// Windows exercises validation and read-only tests; it MUST NOT silently
// downgrade security from Linux openat2 to path-based mutation.
func secureRootCreateAtomic(_ *os.Root, _ string, _ []byte) error {
	return errors.New("wslfs_mutations_require_linux")
}
