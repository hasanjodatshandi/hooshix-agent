//go:build linux

package wslfs

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"

	"golang.org/x/sys/unix"
)

// secureRootReplaceExisting performs a descriptor-scoped, revision-checked
// replacement. A directory flock serializes cooperating broker processes.
// External programs that ignore advisory locks can still race; see
// tests and the release gate before enabling this through the owner worker.
func secureRootReplaceExisting(root *os.Root, rel string, content []byte, expected string) error {
	if rel == "." {
		return errors.New("invalid_replace_target")
	}
	if len(expected) != 64 {
		return errors.New("expected_sha256_required")
	}
	digest, err := hex.DecodeString(expected)
	if err != nil || len(digest) != sha256.Size {
		return errors.New("expected_sha256_invalid")
	}

	dir, err := secureRootOpen(root, path.Dir(rel))
	if err != nil {
		return err
	}
	defer dir.Close()
	parentInfo, err := dir.Stat()
	if err != nil || !parentInfo.IsDir() {
		return errors.New("replace_parent_not_directory")
	}
	dfd := int(dir.Fd())
	if err := unix.Flock(dfd, unix.LOCK_EX); err != nil {
		return err
	}
	defer unix.Flock(dfd, unix.LOCK_UN)

	current, err := secureRootOpen(root, rel)
	if err != nil {
		return err
	}
	defer current.Close()
	info, err := current.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > MaxFileBytes {
		return errors.New("replace_file_not_regular_or_too_large")
	}
	oldBytes, err := io.ReadAll(io.LimitReader(current, MaxFileBytes+1))
	if err != nil || int64(len(oldBytes)) > MaxFileBytes {
		return errors.New("replace_old_read_failed")
	}
	previousHash := sha256.Sum256(oldBytes)
	if hex.EncodeToString(previousHash[:]) != expected {
		return errors.New("stale_write_revision_conflict")
	}

	// Make sure the current pathname names the opened inode. A symlink swap
	// or hard-to-predict path replacement before the commit fails closed.
	var before unix.Stat_t
	if err := unix.Fstatat(dfd, path.Base(rel), &before, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	var pinned unix.Stat_t
	if err := unix.Fstat(int(current.Fd()), &pinned); err != nil {
		return err
	}
	if before.Ino != pinned.Ino || before.Dev != pinned.Dev || before.Mode&unix.S_IFMT != unix.S_IFREG {
		return errors.New("stale_write_inode_conflict")
	}

	fd, err := unix.Openat(dfd, ".", unix.O_TMPFILE|unix.O_WRONLY|unix.O_CLOEXEC, uint32(info.Mode().Perm()))
	if err != nil {
		return err
	}
	newFile := os.NewFile(uintptr(fd), "wslfs-replacement")
	defer newFile.Close()
	if err := unix.Fchmod(fd, uint32(info.Mode().Perm())); err != nil {
		return err
	}
	if n, err := newFile.Write(content); err != nil || n != len(content) {
		if err != nil {
			return err
		}
		return io.ErrShortWrite
	}
	if err := newFile.Sync(); err != nil {
		return err
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	staging := ".hooshix-wsl-stage-" + hex.EncodeToString(nonce)
	// Link the pinned inode through the documented unprivileged O_TMPFILE
	// mechanism into the already-confined directory.
	source := fmt.Sprintf("/proc/self/fd/%d", fd)
	if err := unix.Linkat(unix.AT_FDCWD, source, dfd, staging, unix.AT_SYMLINK_FOLLOW); err != nil {
		return err
	}
	staged := true
	defer func() {
		// If the exchange succeeded but cleanup failed, the staged name
		// retains the original inode for operator reconciliation.
		if staged {
			_ = unix.Unlinkat(dfd, staging, 0)
		}
	}()

	// A second comparison narrows the window for edits ignoring flock.
	check, err := secureRootOpen(root, rel)
	if err != nil {
		return err
	}
	checkInfo, err := check.Stat()
	if err != nil || !checkInfo.Mode().IsRegular() || checkInfo.Size() > MaxFileBytes {
		check.Close()
		return errors.New("stale_write_revision_conflict")
	}
	checkBytes, err := io.ReadAll(io.LimitReader(check, MaxFileBytes+1))
	check.Close()
	if err != nil || int64(len(checkBytes)) > MaxFileBytes {
		return errors.New("stale_write_read_failed")
	}
	checkHash := sha256.Sum256(checkBytes)
	if checkHash != previousHash {
		return errors.New("stale_write_revision_conflict")
	}
	if err := unix.Fstatat(dfd, path.Base(rel), &before, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	if before.Ino != pinned.Ino || before.Dev != pinned.Dev {
		return errors.New("stale_write_inode_conflict")
	}

	if err := unix.Renameat2(dfd, staging, dfd, path.Base(rel), unix.RENAME_EXCHANGE); err != nil {
		return err
	}
	// The old inode is now retained at staging. Verify that the exchange
	// displaced the exact pinned revision, rather than destroying it.
	// A non-cooperating external writer can still race the rename. If a
	// mismatch is observed, attempt a guarded exchange rollback, and never
	// discard the displaced inode on an uncertain outcome.
	var displaced unix.Stat_t
	if err := unix.Fstatat(dfd, staging, &displaced, unix.AT_SYMLINK_NOFOLLOW); err != nil ||
		displaced.Ino != pinned.Ino || displaced.Dev != pinned.Dev {
		var named, candidate unix.Stat_t
		if e := unix.Fstatat(dfd, path.Base(rel), &named, unix.AT_SYMLINK_NOFOLLOW); e == nil &&
			unix.Fstat(fd, &candidate) == nil && named.Ino == candidate.Ino && named.Dev == candidate.Dev {
			// Do not roll back and unlink an externally modified version of
			// our temporary inode. Verify both its identity and exact bytes.
			observedFile, e := secureRootOpen(root, rel)
			if e == nil {
				observedBytes, readErr := io.ReadAll(io.LimitReader(observedFile, MaxFileBytes+1))
				observedFile.Close()
				if readErr == nil && len(observedBytes) == len(content) {
					observedSHA := sha256.Sum256(observedBytes)
					if observedSHA == sha256.Sum256(content) {
						if e := unix.Renameat2(dfd, staging, dfd, path.Base(rel), unix.RENAME_EXCHANGE); e == nil {
							return errors.New("stale_write_race_conflict_rolled_back")
						}
					}
				}
			}
		}
		staged = false
		return errors.New("replace_commit_outcome_unknown")
	}
	// Staged name currently holds the old, separately persisted revision.
	// Never erase it before successful verification of the new target.
	newStat := unix.Stat_t{}
	if err := unix.Fstatat(dfd, path.Base(rel), &newStat, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		staged = false
		return errors.New("replace_commit_outcome_unknown")
	}
	if newStat.Ino == pinned.Ino || newStat.Dev != pinned.Dev {
		staged = false
		return errors.New("replace_commit_outcome_unknown")
	}
	if err := dir.Sync(); err != nil {
		staged = false // retain previous inode for reconciliation
		return errors.New("replace_commit_outcome_unknown")
	}
	if err := unix.Unlinkat(dfd, staging, 0); err != nil {
		staged = false
		return errors.New("replace_cleanup_outcome_unknown")
	}
	staged = false
	if err := dir.Sync(); err != nil {
		return errors.New("replace_cleanup_outcome_unknown")
	}
	return nil
}
