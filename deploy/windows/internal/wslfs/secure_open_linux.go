//go:build linux

package wslfs

import (
	"golang.org/x/sys/unix"
	"os"
)

// Linux-only file access is descriptor relative and kernel-enforced.
// Refuse all symlinks (including a benign name pointing to .env), mount
// crossings and magic links. No lexical or Lstat/Open race can bypass it.
func secureRootOpen(root *os.Root, rel string) (*os.File, error) {
	dir, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	flags := uint64(unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NONBLOCK)
	how := &unix.OpenHow{
		Flags:   flags,
		Resolve: uint64(unix.RESOLVE_BENEATH | unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS | unix.RESOLVE_NO_XDEV),
	}
	fd, err := unix.Openat2(int(dir.Fd()), rel, how)
	if err != nil {
		return nil, err
	} // fail closed on unsupported kernels
	return os.NewFile(uintptr(fd), "wslfs:"+rel), nil
}
