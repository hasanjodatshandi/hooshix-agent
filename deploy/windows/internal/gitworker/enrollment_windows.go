//go:build windows

package gitworker

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const loginRunKey = `Software\Microsoft\Windows\CurrentVersion\Run`

func CheckOwner(root string) (string, error) {
	canonical, err := CanonicalRoot(root)
	if err != nil {
		return "", err
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		return "", err
	}
	current, err := currentSID()
	if err != nil {
		return "", err
	}
	if sameSID(current, systemSID) || !sameSID(current, owner) {
		return "", errors.New("repository enrollment requires its signed-in Windows owner")
	}
	return canonical, nil
}
func startupValue(root string) string {
	digest := PipeName(root)
	return "HooshiXGitWorker-" + digest[len(digest)-24:]
}
func startupCommand(executable, root string) (string, error) {
	if strings.ContainsAny(executable, `"\x00`) || strings.ContainsAny(root, `"\x00`) {
		return "", errors.New("unsafe path for user startup")
	}
	return fmt.Sprintf(`"%s" -mode worker -root "%s"`, executable, root), nil
}

// Enroll changes only the signed-in owner's HKCU startup settings. No SYSTEM
// service, protected application config or other user's registry is touched.
func Enroll(root string) error {
	canonical, err := CheckOwner(root)
	if err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.Abs(exe)
	if err != nil {
		return err
	}
	command, err := startupCommand(exe, canonical)
	if err != nil {
		return err
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, loginRunKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if err = key.SetStringValue(startupValue(canonical), command); err != nil {
		return err
	}
	process := exec.Command(exe, "-mode", "worker", "-root", canonical)
	process.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	process.Stdin = nil
	process.Stdout = nil
	process.Stderr = nil
	if err = process.Start(); err != nil {
		_ = key.DeleteValue(startupValue(canonical))
		return fmt.Errorf("worker could not start; user startup registration rolled back: %w", err)
	}
	return process.Process.Release()
}

// Unenroll removes only the exact HKCU entry and asks the owner worker to
// stop now. A missing worker is already a revoked capability.
func Unenroll(root string) error {
	// Revocation belongs to the current user's HKCU entry even after a
	// repository was moved, deleted or its owner changed.
	if !filepath.IsAbs(root) {
		return errors.New("absolute enrolled root required")
	}
	canonical, err := CanonicalRoot(root)
	if err != nil {
		canonical = filepath.Clean(root)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, loginRunKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	err = key.DeleteValue(startupValue(canonical))
	if err != nil && !errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
		return err
	}
	// Stop existing process even if it was started manually.
	_, _ = Proxy(canonical, "worker_stop", nil)
	return nil
}