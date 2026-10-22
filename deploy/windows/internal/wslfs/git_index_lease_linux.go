//go:build linux

package wslfs

import (
	"errors"
	"os"
	"sync"

	"golang.org/x/sys/unix"
)

// gitIndexLease participates in Git's conventional index.lock protocol.
// It is acquired ONLY after git write-tree finishes, because write-tree may
// refresh index extensions under its own lock. It protects the final staged
// entry verification and ref CAS from ordinary git add/commit/checkout writers.
// This does not protect against out-of-band filesystem changes by an
// uncooperative writer or direct git symbolic-ref commands.
type gitIndexLease struct {
	dir  *os.File
	lock *os.File
	once sync.Once
}

func acquireGitIndexLease(root *os.Root) (*gitIndexLease, error) {
	dir, err := secureRootOpen(root, ".git")
	if err != nil {
		return nil, err
	}
	how := &unix.OpenHow{
		Flags: uint64(unix.O_WRONLY | unix.O_CREAT | unix.O_EXCL | unix.O_CLOEXEC | unix.O_NOFOLLOW),
		Mode:  0600,
		Resolve: uint64(unix.RESOLVE_BENEATH | unix.RESOLVE_NO_SYMLINKS |
			unix.RESOLVE_NO_MAGICLINKS | unix.RESOLVE_NO_XDEV),
	}
	fd, err := unix.Openat2(int(dir.Fd()), "index.lock", how)
	if err != nil {
		dir.Close()
		return nil, err
	}
	return &gitIndexLease{dir: dir, lock: os.NewFile(uintptr(fd), "git-index-lease")}, nil
}

func (l *gitIndexLease) Close() error {
	var result error
	l.once.Do(func() {
		var own, observed unix.Stat_t
		e1 := unix.Fstat(int(l.lock.Fd()), &own)
		e2 := unix.Fstatat(int(l.dir.Fd()), "index.lock", &observed, unix.AT_SYMLINK_NOFOLLOW)
		if e1 == nil && e2 == nil && own.Dev == observed.Dev && own.Ino == observed.Ino &&
			observed.Mode&unix.S_IFMT == unix.S_IFREG {
			result = unix.Unlinkat(int(l.dir.Fd()), "index.lock", 0)
		} else {
			result = errors.New("git_index_lock_ownership_unknown")
		}
		if err := l.lock.Close(); result == nil {
			result = err
		}
		if err := l.dir.Close(); result == nil {
			result = err
		}
	})
	return result
}
