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
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// A write grant is separate from and never upgrades a read-only WSLFS grant.
func wslfsWriteStartupValue(root string) string {
	digest := WSLFileWritePipeName(root)
	return "HooshiXWSLFSWriteWorker-" + digest[len(digest)-24:]
}

func EnrollWSLFileWrites(root, distro, linuxRoot, broker string) error {
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
	if _, probeErr := ProxyWSLFileWrites(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: "."}); probeErr == nil {
		return errors.New("wslfs_owner_worker_already_running_revoke_before_reenrollment")
	}
	probe := runWSLFileRequestWithMode(WSLFileRequest{
		Version: 1, Root: canonical,
		File: wslfs.Request{Version: 1, Operation: "probe", Path: "."},
	}, distro, linuxRoot, broker, canonical, true)
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
	if old, _, lookupErr := key.GetStringValue(wslfsWriteStartupValue(canonical)); lookupErr == nil && old != "" {
		return errors.New("wslfs_owner_startup_registration_exists_revoke_before_reenrollment")
	}
	command := fmt.Sprintf("\"%s\" -mode wslfs-write-worker -root \"%s\" -distro \"%s\" -linux-root \"%s\" -fs-broker \"%s\"", exe, canonical, distro, linuxRoot, broker)
	if err = key.SetStringValue(wslfsWriteStartupValue(canonical), command); err != nil {
		return err
	}
	p := exec.Command(exe, "-mode", "wslfs-write-worker", "-root", canonical, "-distro", distro,
		"-linux-root", linuxRoot, "-fs-broker", broker)
	p.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	if err = p.Start(); err != nil {
		_ = key.DeleteValue(wslfsWriteStartupValue(canonical))
		return fmt.Errorf("WSLFS worker start failed; enrollment rolled back: %w", err)
	}
	if err = p.Process.Release(); err != nil {
		_ = key.DeleteValue(wslfsWriteStartupValue(canonical))
		return fmt.Errorf("wslfs worker process detach failed: %w", err)
	}
	// Confirm the worker is serving the SAME pinned Linux root before
	// claiming enrollment success. Do not strand an HKCU entry after a
	// process that immediately exits (e.g. competing Named Pipe instance).
	for attempt := 0; attempt < 16; attempt++ {
		reply, probeErr := ProxyWSLFileWrites(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: "."})
		if probeErr == nil && reply.OK && reply.Distro == distro && reply.LinuxRoot == linuxRoot {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	_ = key.DeleteValue(wslfsWriteStartupValue(canonical))
	_, _ = ProxyWSLFileWrites(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: ".", Query: "__HOOSHIX_WSLFS_REVOKE__"})
	return errors.New("wslfs_worker_did_not_become_ready; startup registration rolled back")
}
func UnenrollWSLFileWrites(root string) error {
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
	err = key.DeleteValue(wslfsWriteStartupValue(canonical))
	if err != nil && !errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
		return err
	}
	_, _ = ProxyWSLFileWrites(canonical, wslfs.Request{Version: 1, Operation: "probe", Path: ".", Query: "__HOOSHIX_WSLFS_REVOKE__"})
	return nil
}
