//go:build linux

package wslfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

// secureRootStat differentiates absence from inaccessible or substituted
// targets. It never follows symlinks, even if a parent was swapped.
func secureRootStat(root *os.Root, rel string) (string, string, error) {
	parent, err := secureRootOpen(root, path.Dir(rel))
	if err != nil {
		return "", "", err
	}
	defer parent.Close()
	info, err := parent.Stat()
	if err != nil || !info.IsDir() {
		return "", "", errors.New("not_directory")
	}
	var stat unix.Stat_t
	err = unix.Fstatat(int(parent.Fd()), path.Base(rel), &stat, unix.AT_SYMLINK_NOFOLLOW)
	if errors.Is(err, unix.ENOENT) {
		return "absent", "", nil
	}
	if err != nil {
		return "", "", err
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Size > MaxFileBytes {
		return "", "", errors.New("stat_not_regular")
	}
	file, err := secureRootOpen(root, rel)
	if err != nil {
		return "", "", err
	}
	defer file.Close()
	fixed, err := file.Stat()
	if err != nil || !fixed.Mode().IsRegular() || fixed.Size() > MaxFileBytes {
		return "", "", errors.New("stat_not_regular")
	}
	b, err := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	if err != nil || int64(len(b)) > MaxFileBytes || !utf8.Valid(b) || bytes.IndexByte(b, 0) >= 0 {
		return "", "", errors.New("stat_not_utf8")
	}
	var pinned unix.Stat_t
	if err = unix.Fstat(int(file.Fd()), &pinned); err != nil {
		return "", "", err
	}
	if stat.Dev != pinned.Dev || stat.Ino != pinned.Ino {
		return "", "", errors.New("stat_identity_changed")
	}
	sum := sha256.Sum256(b)
	return "present", hex.EncodeToString(sum[:]), nil
}
