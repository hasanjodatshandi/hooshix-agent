//go:build windows

package gitworker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
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
	if strings.ContainsAny(executable, "\"\r\n") || strings.ContainsRune(executable, '\x00') ||
		strings.ContainsAny(root, "\"\r\n") || strings.ContainsRune(root, '\x00') {
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

func wslStartupValue(root string) string {
	digest := WSLPipeName(root)
	return "HooshiXWSLWorker-" + digest[len(digest)-24:]
}
func EnrollWSL(root, distro, linuxRoot string) error {
	if err := ValidateWSLConfig(distro, linuxRoot); err != nil {
		return err
	}
	if strings.ContainsAny(linuxRoot, `"`) {
		return errors.New("quote is not allowed in WSL startup root")
	}
	canonical, err := CheckOwner(root)
	if err != nil {
		return err
	}
	// Fail at enrollment, not on the next restart: the owner's current
	// Windows token must be able to run this exact distro and Linux cwd.
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	probe := exec.CommandContext(ctx, "wsl.exe", "--distribution", distro,
		"--cd", linuxRoot, "--exec", "/bin/sh", "-c", "pwd")
	probe.Dir = canonical
	probe.Env = wslChildEnv()
	if err = probe.Run(); err != nil {
		return errors.New("WSL distro or Linux directory is not accessible to the signed-in Windows user")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.Abs(exe)
	if err != nil {
		return err
	}
	if strings.ContainsAny(exe, `"`) {
		return errors.New("unsafe executable path")
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, loginRunKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	args := []string{"-mode", "wsl-worker", "-root", canonical, "-distro", distro, "-linux-root", linuxRoot}
	text := fmt.Sprintf(`"%s" -mode wsl-worker -root "%s" -distro "%s" -linux-root "%s"`, exe, canonical, distro, linuxRoot)
	if err = key.SetStringValue(wslStartupValue(canonical), text); err != nil {
		return err
	}
	proc := exec.Command(exe, args...)
	proc.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	if err = proc.Start(); err != nil {
		_ = key.DeleteValue(wslStartupValue(canonical))
		return fmt.Errorf("WSL worker startup failed; enrollment rolled back: %w", err)
	}
	return proc.Process.Release()
}

func wslfsStartupValue(root string) string {
	digest := WSLFilePipeName(root)
	return "HooshiXWSLFSWorker-" + digest[len(digest)-24:]
}

// Native Linux file access is a second explicit user-session consent.
func EnrollWSLFiles(root, distro, linuxRoot, broker string) error {
	if err := ValidateWSLConfig(distro, linuxRoot); err != nil {
		return err
	}
	if err := validateLinuxBroker(broker); err != nil {
		return err
	}
	for _, s := range []string{distro, linuxRoot, broker} {
		if strings.ContainsAny(s, "\"\r\n") || strings.ContainsRune(s, '\x00') {
			return errors.New("unsafe WSLFS startup argument")
		}
	}
	canonical, err := CheckOwner(root)
	if err != nil {
		return err
	}
	if _, probeErr := ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: "."}); probeErr == nil {
		return errors.New("wslfs_owner_worker_already_running_revoke_before_reenrollment")
	}
	probe := runWSLFileRequest(WSLFileRequest{
		Version: 1, Root: canonical,
		File: wslfs.Request{Version: 1, Operation: "probe", Path: "."},
	}, distro, linuxRoot, broker, canonical)
	if !probe.OK {
		return errors.New("WSL filesystem broker cannot open the selected Linux root")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.Abs(exe)
	if err != nil {
		return err
	}
	if strings.ContainsAny(exe, "\"\r\n") || strings.ContainsRune(exe, '\x00') {
		return errors.New("unsafe executable path")
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, loginRunKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if old, _, lookupErr := key.GetStringValue(wslfsStartupValue(canonical)); lookupErr == nil && old != "" {
		return errors.New("wslfs_owner_startup_registration_exists_revoke_before_reenrollment")
	}
	command := fmt.Sprintf("\"%s\" -mode wslfs-worker -root \"%s\" -distro \"%s\" -linux-root \"%s\" -fs-broker \"%s\"", exe, canonical, distro, linuxRoot, broker)
	if err = key.SetStringValue(wslfsStartupValue(canonical), command); err != nil {
		return err
	}
	p := exec.Command(exe, "-mode", "wslfs-worker", "-root", canonical, "-distro", distro,
		"-linux-root", linuxRoot, "-fs-broker", broker)
	p.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	if err = p.Start(); err != nil {
		_ = key.DeleteValue(wslfsStartupValue(canonical))
		return fmt.Errorf("WSLFS worker start failed; enrollment rolled back: %w", err)
	}
	if err = p.Process.Release(); err != nil {
		_ = key.DeleteValue(wslfsStartupValue(canonical))
		return fmt.Errorf("wslfs worker process detach failed: %w", err)
	}
	// Confirm the worker is serving the SAME pinned Linux root before
	// claiming enrollment success. Do not strand an HKCU entry after a
	// process that immediately exits (e.g. competing Named Pipe instance).
	for attempt := 0; attempt < 16; attempt++ {
		reply, probeErr := ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: "."})
		if probeErr == nil && reply.OK && reply.Distro == distro && reply.LinuxRoot == linuxRoot {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	_ = key.DeleteValue(wslfsStartupValue(canonical))
	_, _ = ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: ".", Query: "__HOOSHIX_WSLFS_REVOKE__"})
	return errors.New("wslfs_worker_did_not_become_ready; startup registration rolled back")
}
func UnenrollWSLFiles(root string) error {
	if !filepath.IsAbs(root) {
		return errors.New("absolute owner root required")
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
	err = key.DeleteValue(wslfsStartupValue(canonical))
	if err != nil && !errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
		return err
	}
	_, _ = ProxyWSLFiles(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: ".", Query: "__HOOSHIX_WSLFS_REVOKE__"})
	return nil
}

func UnenrollWSL(root string) error {
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
	err = key.DeleteValue(wslStartupValue(canonical))
	if err != nil && !errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
		return err
	}
	_, _ = ProxyWSL(canonical, "__HOOSHIX_WSL_STOP__")
	return nil
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