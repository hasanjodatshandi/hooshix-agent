//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootStat(_ *os.Root, _ string) (string, string, error) {
	return "", "", errors.New("wslfs_stat_requires_linux")
}
