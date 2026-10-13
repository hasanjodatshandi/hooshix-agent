//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"sort"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
)

// ensureElevated re-runs this installer with administrator rights when the
// current process does not have them. A service registration, Program Files and
// HKLM all need elevation, and one UAC prompt for one product is what an
// operator should have to answer.
//
// Returning false means an elevated copy has taken the work over, so this
// process has to stop without writing anything.
func ensureElevated(arguments []string) (bool, error) {
	if windows.GetCurrentProcessToken().IsElevated() {
		return true, nil
	}
	self, err := os.Executable()
	if err != nil {
		return false, fmt.Errorf("find the running installer: %w", err)
	}
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return false, fmt.Errorf("name the elevation action: %w", err)
	}
	program, err := windows.UTF16PtrFromString(self)
	if err != nil {
		return false, fmt.Errorf("name the installer to elevate: %w", err)
	}
	var parameters *uint16
	if joined := quoteArguments(arguments); joined != "" {
		if parameters, err = windows.UTF16PtrFromString(joined); err != nil {
			return false, fmt.Errorf("quote the installer arguments: %w", err)
		}
	}
	// ShellExecute is the only supported way to raise a prompt from inside a
	// program: a hand-written token dance either fails on a managed account or
	// quietly installs under the wrong user.
	if err := windows.ShellExecute(0, verb, program, parameters, nil, windows.SW_SHOWNORMAL); err != nil {
		if errors.Is(err, windows.ERROR_CANCELLED) {
			return false, errors.New("the elevation prompt was declined")
		}
		return false, fmt.Errorf("request administrator rights: %w", err)
	}
	fmt.Println("continuing with administrator rights in a new window")
	return false, nil
}

// notify shows the one dialog the operator reads. The console belongs to a
// window that closes when the install does, and a person who clicked an icon
// deserves an answer that says what happened.
func notify(title, message string, isError bool) {
	flags := uint32(windows.MB_OK | windows.MB_ICONINFORMATION)
	if isError {
		flags = uint32(windows.MB_OK | windows.MB_ICONERROR)
	}
	text, err := windows.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	caption, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	_, _ = windows.MessageBox(0, text, caption, flags)
}

// registerInstall writes the two entries that make an install visible: the
// machine-wide startup value for the tray and the record that removes it.
//
// The startup value is HKLM and not HKCU because this process is elevated: a
// standard user's elevated token still belongs to that user, but an admin
// installing on somebody's machine would write the value into the admin's own
// profile and the icon would never appear for anyone else.
func registerInstall(layout setup.Layout, version string) error {
	key, _, err := registry.CreateKey(registry.LOCAL_MACHINE, setup.RunKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open the startup entry: %w", err)
	}
	defer key.Close()
	if err := key.SetStringValue(setup.RunValueName, layout.TrayCommand()); err != nil {
		return fmt.Errorf("record the tray startup: %w", err)
	}

	programs, _, err := registry.CreateKey(registry.LOCAL_MACHINE, setup.UninstallKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open the entry in Programs: %w", err)
	}
	defer programs.Close()
	entries := layout.AddRemoveProgramEntries(version)
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	// Sorted, so two runs of the same install write the values in the same order
	// and a support reading of the key is comparable between machines.
	sort.Strings(names)
	for _, name := range names {
		if err := programs.SetStringValue(name, entries[name]); err != nil {
			return fmt.Errorf("write the entry in Programs: %s: %w", name, err)
		}
	}
	return nil
}

// removeRegistration deletes the two entries registerInstall wrote. Keys and
// values that are already gone are the desired state: an uninstall has to be
// able to finish a run that was interrupted.
func removeRegistration() error {
	if key, err := registry.OpenKey(registry.LOCAL_MACHINE, setup.RunKey, registry.SET_VALUE); err == nil {
		err := key.DeleteValue(setup.RunValueName)
		key.Close()
		if err != nil && !errors.Is(err, registry.ErrNotExist) {
			return fmt.Errorf("remove the tray startup: %w", err)
		}
	} else if !errors.Is(err, registry.ErrNotExist) {
		return fmt.Errorf("open the startup entry: %w", err)
	}
	if err := registry.DeleteKey(registry.LOCAL_MACHINE, setup.UninstallKey); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return fmt.Errorf("remove the entry in Programs: %w", err)
	}
	return nil
}
