package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// These are the precise HooshiX-owned legacy WSL payload names shipped by
// earlier installers. Never recurse or delete user data/WSL distributions.
// Run only AFTER successful extraction while SCM is already stopped.
var retiredLinuxPayload = [...]string{
	"bin/hooshix-wsl-fs-broker-linux-amd64",
	"tools/enroll-wsl-files.ps1",
	"tools/enroll-wsl-file-writes.ps1",
	"tools/enroll-wsl-git-writes.ps1",
	"tools/preflight-wsl-enrollment.ps1",
	"app/dist/security/wsl-file-backup.js",
	"app/dist/security/wsl-mutation-service.js",
	"app/dist/security/wsl-workspace-binding.js",
	"app/dist/security/wsl-workspace-client.js",
	"app/dist/security/wsl-workspace-uri.js",
	"app/dist/services/shell/wsl-worker-client.js",
}

// removeRetiredLinuxPayload removes only known former installer payload files.
// No directory traversal, no external paths and no user-owned Linux directories.
func removeRetiredLinuxPayload(installDir string) error {
	for _, rel := range retiredLinuxPayload {
		filename := filepath.Join(installDir, filepath.FromSlash(rel))
		if err := os.Remove(filename); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove retired HooshiX WSL payload %s: %w", rel, err)
		}
	}
	// Remove the now-empty legacy tools directory; preserve any other files.
	toolsDir := filepath.Join(installDir, "tools")
	if err := os.Remove(toolsDir); err != nil &&
		!errors.Is(err, os.ErrNotExist) &&
		!errors.Is(err, os.ErrPermission) {
		// Nonempty directory is intentionally preserved.
		entries, readErr := os.ReadDir(toolsDir)
		if readErr == nil && len(entries) > 0 {
			return nil
		}
		return fmt.Errorf("remove empty legacy tools directory: %w", err)
	}
	return nil
}
