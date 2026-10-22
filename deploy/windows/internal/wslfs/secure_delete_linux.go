//go:build linux

package wslfs

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"

	"golang.org/x/sys/unix"
)

// secureRootDeleteExisting removes only a regular file at the expected
// revision and retains its inode under a private staging name until the
// deletion is verified. This is safe against cooperating broker callers
// (directory flock). Non-cooperating writers require reconciliation on an
// externally raced commit; no owner-worker write entitlement is enabled yet.
func secureRootDeleteExisting(root *os.Root, rel, expected string) error {
	if rel == "." {
		return errors.New("invalid_delete_target")
	}
	if len(expected) != 64 {
		return errors.New("expected_sha256_required")
	}
	digest, err := hex.DecodeString(expected)
	if err != nil || len(digest) != sha256.Size {
		return errors.New("expected_sha256_invalid")
	}
	parent, err := secureRootOpen(root, path.Dir(rel))
	if err != nil {
		return err
	}
	defer parent.Close()
	stat, err := parent.Stat()
	if err != nil || !stat.IsDir() {
		return errors.New("delete_parent_not_directory")
	}
	dfd := int(parent.Fd())
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
		return errors.New("delete_target_not_regular_or_too_large")
	}
	oldBytes, err := io.ReadAll(io.LimitReader(current, MaxFileBytes+1))
	if err != nil || int64(len(oldBytes)) > MaxFileBytes {
		return errors.New("delete_read_failed")
	}
	sha := sha256.Sum256(oldBytes)
	if hex.EncodeToString(sha[:]) != expected {
		return errors.New("stale_delete_revision_conflict")
	}
	var pinned, observed unix.Stat_t
	if err := unix.Fstat(int(current.Fd()), &pinned); err != nil {
		return err
	}
	if err := unix.Fstatat(dfd, path.Base(rel), &observed, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	if pinned.Dev != observed.Dev || pinned.Ino != observed.Ino || observed.Mode&unix.S_IFMT != unix.S_IFREG {
		return errors.New("stale_delete_inode_conflict")
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	staging := ".hooshix-wsl-deleted-" + hex.EncodeToString(nonce)
	// Renameat2 NOREPLACE cannot overwrite a pre-existing staging name.
	if err := unix.Renameat2(dfd, path.Base(rel), dfd, staging, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	// Post-rename, the original pathname is absent. If an unrelated inode
	// moved instead, restore it without overwriting any newer target.
	if err := unix.Fstatat(dfd, staging, &observed, unix.AT_SYMLINK_NOFOLLOW); err != nil ||
		observed.Ino != pinned.Ino || observed.Dev != pinned.Dev {
		if unix.Renameat2(dfd, staging, dfd, path.Base(rel), unix.RENAME_NOREPLACE) != nil {
			return errors.New("delete_commit_outcome_unknown_quarantined")
		}
		return errors.New("stale_delete_race_conflict")
	}
	if err := parent.Sync(); err != nil {
		return errors.New("delete_commit_outcome_unknown_quarantined")
	}
	// The original bytes have already been committed to SQLite by the future
	// governed mutation orchestrator. Unlink only the verified staged inode.
	if err := unix.Unlinkat(dfd, staging, 0); err != nil {
		return errors.New("delete_cleanup_outcome_unknown_quarantined")
	}
	if err := parent.Sync(); err != nil {
		return errors.New("delete_cleanup_outcome_unknown")
	}
	return nil
}
