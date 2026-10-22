//go:build linux

package wslfs

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"

	"golang.org/x/sys/unix"
)

// secureRootCreateAtomic creates only an ABSENT regular file. The parent
// descriptor was reached with openat2's BENEATH/NO_SYMLINKS/NO_XDEV policy.
// An unnamed, fsynced inode is linked into the directory in one atomic
// operation. Linkat never overwrites an existing target or follows its name.
// No temporary file is exposed to concurrent search/list/file tools.
func secureRootCreateAtomic(root *os.Root, rel string, data []byte) error {
	if rel == "." {
		return errors.New("invalid_create_target")
	}
	parent, err := secureRootOpen(root, path.Dir(rel))
	if err != nil {
		return err
	}
	defer parent.Close()
	stat, err := parent.Stat()
	if err != nil || !stat.IsDir() {
		return errors.New("create_parent_not_directory")
	}

	fd, err := unix.Openat(int(parent.Fd()), ".", unix.O_TMPFILE|unix.O_WRONLY|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	} // fail closed when filesystem lacks O_TMPFILE
	tmp := os.NewFile(uintptr(fd), "wslfs-unnamed-create")
	defer tmp.Close()
	if n, e := tmp.Write(data); e != nil || n != len(data) {
		if e != nil {
			return e
		}
		return io.ErrShortWrite
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	// AT_EMPTY_PATH requires CAP_DAC_READ_SEARCH on many Linux kernels.
	// The documented unprivileged O_TMPFILE path links this pinned fd via
	// /proc/self/fd; the destination directory is a confined openat2 fd.
	source := fmt.Sprintf("/proc/self/fd/%d", fd)
	if err := unix.Linkat(unix.AT_FDCWD, source, int(parent.Fd()), path.Base(rel), unix.AT_SYMLINK_FOLLOW); err != nil {
		return err
	}
	// A failed directory sync is NOT reported as successful: it needs
	// reconciliation rather than a blind retry of an unknown external effect.
	return parent.Sync()
}
