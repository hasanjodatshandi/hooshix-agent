package setup

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// UpgradeRecovery owns a single prior-install snapshot. It never includes
// ProgramData settings, databases, credentials, user workspaces or WSL data.
type UpgradeRecovery struct {
	InstallDir string
	Pending    string
	Previous   string
	exists     bool
}

func RecoveryFor(layout Layout) UpgradeRecovery {
	parent := filepath.Join(layout.DataRoot, "recovery")
	return UpgradeRecovery{
		InstallDir: layout.InstallDir,
		Pending:    filepath.Join(parent, "pending-program"),
		Previous:   filepath.Join(parent, "previous-program"),
	}
}

// CheckPrevious verifies the rollback source BEFORE a service is stopped.
func (r UpgradeRecovery) CheckPrevious() error {
	info, err := os.Lstat(r.Previous)
	if err != nil {
		return fmt.Errorf("no previous installed version available for rollback: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("unsafe recovery snapshot")
	}
	return nil
}

// Snapshot performs all copies while the previous version is still running.
// Windows allows opening loaded executable images for READ; if a file cannot
// be copied, no service has been stopped and the upgrade fails closed.
func (r *UpgradeRecovery) Snapshot() error {
	info, err := os.Lstat(r.InstallDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("unsafe install root")
	}
	if _, err = os.Lstat(r.Pending); err == nil {
		return errors.New("incomplete prior upgrade snapshot exists; manual recovery required")
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(r.Pending), 0700); err != nil {
		return err
	}
	if err = copyOwnedInstallTree(r.InstallDir, r.Pending); err != nil {
		// A partial pending tree is not a trusted recovery source.
		_ = os.RemoveAll(r.Pending)
		return fmt.Errorf("create upgrade recovery snapshot: %w", err)
	}
	r.exists = true
	return nil
}

func (r UpgradeRecovery) HasSnapshot() bool { return r.exists }
func (r UpgradeRecovery) Cancel() error {
	if !r.exists {
		return nil
	}
	return os.RemoveAll(r.Pending)
}

// Commit does not delete the previous restore point until the new snapshot
// is complete. A failed promotion leaves the pending tree available.
func (r UpgradeRecovery) Commit() error {
	if !r.exists {
		return nil
	}
	stale := r.Previous + "-stale"
	if _, err := os.Lstat(stale); err == nil {
		return errors.New("stale recovery directory needs manual inspection")
	}
	if _, err := os.Lstat(r.Previous); err == nil {
		if err = os.Rename(r.Previous, stale); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(r.Pending, r.Previous); err != nil {
		if _, oldErr := os.Lstat(stale); oldErr == nil {
			_ = os.Rename(stale, r.Previous)
		}
		return err
	}
	return os.RemoveAll(stale)
}

// RestorePending restores exact previous program-file bytes and does not
// touch settings/database/logs. Must be called only after stopping the service.
func (r UpgradeRecovery) RestorePending() error {
	if !r.exists {
		return errors.New("no in-progress snapshot")
	}
	return restoreInstallTree(r.Pending, r.InstallDir)
}
func (r UpgradeRecovery) RestorePrevious() error {
	if err := r.CheckPrevious(); err != nil {
		return err
	}
	return restoreInstallTree(r.Previous, r.InstallDir)
}
func (r UpgradeRecovery) ConsumePrevious() error { return os.RemoveAll(r.Previous) }

func restoreInstallTree(snapshot, installDir string) error {
	if err := os.RemoveAll(installDir); err != nil {
		return fmt.Errorf("remove failed upgrade files: %w", err)
	}
	if err := copyOwnedInstallTree(snapshot, installDir); err != nil {
		return fmt.Errorf("restore prior binaries (backup retained at %s): %w", snapshot, err)
	}
	return nil
}

// copyOwnedInstallTree refuses all non-regular file types. It neither follows
// symbolic links nor copies ACL-sensitive operator state outside InstallDir.
func copyOwnedInstallTree(source, destination string) error {
	if info, err := os.Lstat(source); err != nil {
		return err
	} else if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("source install tree is not a plain directory")
	}
	return filepath.WalkDir(source, func(p string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return fmt.Errorf("refuse reparse/link/special install entry %s", p)
		}
		relative, err := filepath.Rel(source, p)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if info.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		reader, err := os.Open(p)
		if err != nil {
			return err
		}
		writer, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			_ = reader.Close()
			return err
		}
		_, copyErr := io.Copy(writer, reader)
		readClose := reader.Close()
		writeClose := writer.Close()
		if copyErr != nil {
			return copyErr
		}
		if readClose != nil {
			return readClose
		}
		return writeClose
	})
}
