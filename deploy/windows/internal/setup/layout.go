package setup

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
)

// AppName is the product name as an operator reads it in Programs, the tray and
// the installed directory.
const AppName = "HooshiX MCP"

// DirectoryName is the folder under Program Files. It is separate from AppName
// because the display name carries a space and the paths are typed by hand
// during support calls.
const DirectoryName = "HooshiX MCP"

// DataDirectoryName is the machine-wide state directory under %ProgramData%.
const DataDirectoryName = "HooshiXMCP"

// DefaultPublicBaseURL is the HTTPS origin this deployment publishes. The
// connector's own origin check compares requests against it, so an install with
// no value here cannot be reached by ChatGPT at all.
const DefaultPublicBaseURL = "https://mcp.hooshix-agent.ir"

// DefaultPort matches the loopback port the watchdog launcher used, so an
// existing Caddy or gateway configuration keeps working after the install.
const DefaultPort = "3001"

// Registry locations the installer owns. Only these keys are written, and the
// uninstall removes exactly them.
const (
	// UninstallKey is the Add/Remove Programs entry's parent.
	UninstallKey = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\HooshiXMCP`

	// RunKey is read under HKEY_LOCAL_MACHINE, so the tray starts for every
	// account that signs in, not only the one that ran setup.
	RunKey = `Software\Microsoft\Windows\CurrentVersion\Run`

	// RunValueName is what the user sees in Task Manager's startup list.
	RunValueName = "HooshiX MCP tray"
)

// Layout is where an install lives. Everything is absolute, because a service
// starts with no interactive profile and a working directory of System32.
type Layout struct {
	InstallDir string
	BinDir     string
	RuntimeDir string
	AppDir     string
	DataRoot   string
}

// NewLayout builds the install paths from the two machine-wide roots.
func NewLayout(programFiles, programData string) (Layout, error) {
	if programFiles == "" {
		return Layout{}, fmt.Errorf("the Program Files directory is unknown")
	}
	if programData == "" {
		return Layout{}, fmt.Errorf("the ProgramData directory is unknown")
	}
	// Uninstall removes the install tree and, on request, the data root. If one
	// root sits inside the other, an uninstall reaches into whichever half the
	// operator meant to keep, so the two locations must be genuinely separate.
	if contains(programFiles, programData) || contains(programData, programFiles) {
		return Layout{}, fmt.Errorf("the program directory %s and the state directory %s cannot contain one another", programFiles, programData)
	}
	install := filepath.Join(programFiles, DirectoryName)
	layout := Layout{
		InstallDir: install,
		BinDir:     filepath.Join(install, "bin"),
		RuntimeDir: filepath.Join(install, "runtime"),
		AppDir:     filepath.Join(install, "app"),
		DataRoot:   filepath.Join(programData, DataDirectoryName),
	}
	if err := layout.verify(); err != nil {
		return Layout{}, err
	}
	return layout, nil
}

// DefaultLayout resolves the layout from this machine's own directories, so the
// setup binary needs no configuration to know where it is going.
func DefaultLayout() (Layout, error) {
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" && runtime.GOOS == "windows" {
		// A 32-bit build on 64-bit Windows gets ProgramFiles pointing into
		// "Program Files (x86)"; the runtime is x64, so it must not live there.
		if alternative := os.Getenv("ProgramW6432"); alternative != "" {
			programFiles = alternative
		}
	}
	return NewLayout(programFiles, os.Getenv("ProgramData"))
}

func (layout Layout) verify() error {
	for _, pair := range []struct{ field, value string }{
		{"install directory", layout.InstallDir},
		{"bin directory", layout.BinDir},
		{"runtime directory", layout.RuntimeDir},
		{"app directory", layout.AppDir},
		{"data root", layout.DataRoot},
	} {
		if !IsAbsolute(pair.value) {
			return fmt.Errorf("%s %q is not an absolute path", pair.field, pair.value)
		}
	}
	return nil
}

// IsAbsolute accepts a Windows absolute path, including a drive letter and a UNC
// prefix. filepath.IsAbs cannot be used here: the installer is Windows-only but
// this package's logic is tested on any runner, and there filepath.IsAbs rejects
// the very paths it is meant to check.
func IsAbsolute(path string) bool {
	if filepath.IsAbs(path) {
		return true
	}
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 3 && normalized[1] == ':' && isDriveLetter(normalized[0]) && (normalized[2] == '/') {
		return true
	}
	return strings.HasPrefix(normalized, "//")
}

func isDriveLetter(value byte) bool {
	return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z'
}

// contains reports whether candidate sits at or under root, comparing the way
// Windows does: separators folded and case ignored.
func contains(root, candidate string) bool {
	normalizedRoot, normalizedCandidate := normalizePath(root), normalizePath(candidate)
	return normalizedCandidate == normalizedRoot ||
		strings.HasPrefix(normalizedCandidate, normalizedRoot+"/")
}

// normalizePath folds a Windows path for comparison. filepath.ToSlash and
// filepath.Clean are not enough: on a non-Windows runner the separator is
// already "/", so a backslash stays a literal character and two spellings of the
// same directory would compare unequal.
func normalizePath(path string) string {
	normalized := strings.ToLower(strings.ReplaceAll(path, "\\", "/"))
	for strings.Contains(normalized, "//") {
		normalized = strings.ReplaceAll(normalized, "//", "/")
	}
	return strings.Trim(normalized, "/")
}

// SettingsFile is the path of the settings document. It sits beside the
// installed program so the operator can open and edit it without digging into
// ProgramData; only runtime data stays in the data root.
func (layout Layout) SettingsFile() string {
	if layout.InstallDir != "" {
		return filepath.Join(layout.InstallDir, "settings.json")
	}
	return filepath.Join(layout.DataRoot, "settings.json")
}

// LegacySettingsFile is where older installs kept the document. It is read only
// to migrate an existing operator document into the install folder.
func (layout Layout) LegacySettingsFile() string {
	return filepath.Join(layout.DataRoot, "settings.json")
}

// ServiceBinary is the installed control-and-host executable.
func (layout Layout) ServiceBinary() string {
	return filepath.Join(layout.BinDir, "hooshix-mcp-service.exe")
}

// TrayBinary is the installed notification-area executable.
func (layout Layout) TrayBinary() string {
	return filepath.Join(layout.BinDir, "hooshix-mcp-tray.exe")
}

// WorkerBinary is the owner-session executable that may outlive a service stop.
// Windows cannot replace its running executable image.
func (layout Layout) WorkerBinary() string {
	return filepath.Join(layout.BinDir, "hooshix-git-worker.exe")
}

// UninstallerBinary is the payload-less copy of setup that the Add/Remove
// Programs entry runs. It is small because the runtime archive is not copied
// into it.
func (layout Layout) UninstallerBinary() string {
	return filepath.Join(layout.BinDir, "uninstall.exe")
}

// ValidatePublicBaseURL checks the one string an operator may hand to setup.
// The connector compares every request's Origin against this value, so a typo
// here is an install that runs perfectly, turns the icon green and answers
// nobody — the hardest of the three failures to notice.
func ValidatePublicBaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return DefaultPublicBaseURL, nil
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("the public origin %q is not a URL: %w", value, err)
	}
	if !strings.EqualFold(parsed.Scheme, "https") || parsed.Host == "" {
		return "", fmt.Errorf("the public origin %q has to be an https:// address with a host: ChatGPT connects to an HTTPS endpoint only", value)
	}
	return value, nil
}

// Settings builds the settings document for this install. The server's own
// defaults cover the rest: host.LoadSettings owns the three paths the server
// writes, so this document only names the runtime, the entry and the published
// origin.
//
// Permission knobs are deliberately absent. The permission ceiling, the
// unrestricted-shell opt-in and auto-approve are switches an operator adds here
// on purpose; shipping them switched on would hand every install a remote code
// execution endpoint. The shell opt-in is the only gate that tool has, so a
// default-ceiling install can be given a shell without raising every other
// tool's ceiling beside it.
func (layout Layout) Settings(publicBaseURL string) host.Settings {
	if strings.TrimSpace(publicBaseURL) == "" {
		publicBaseURL = DefaultPublicBaseURL
	}
	return host.Settings{
		Node:             filepath.Join(layout.RuntimeDir, "node.exe"),
		Entry:            filepath.Join(layout.AppDir, "dist", "index-http.js"),
		WorkingDirectory: layout.AppDir,
		DataRoot:         layout.DataRoot,
		Env: map[string]string{
			"HOOSHIX_HTTP_PORT":       DefaultPort,
			"HOOSHIX_PUBLIC_BASE_URL": publicBaseURL,
			"NODE_ENV":                "production",
		},
	}
}

// SettingsJSON renders the document the host reads. The trailing newline and
// the two-space indent are for the operator who has to open and read it.
func SettingsJSON(settings host.Settings) ([]byte, error) {
	raw, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode settings: %w", err)
	}
	return append(raw, '\n'), nil
}

// CheckExistingSettingsRuntime is a read-only upgrade guard. An existing
// settings file pointing into a development checkout must never silently make
// a newly installed package run mutable code outside Program Files.
// Refuse unsafe upgrades BEFORE stopping the service or extracting files.
// Preserve operator-owned origin, port, permissions and credentials untouched.
func (layout Layout) CheckExistingSettingsRuntime() error {
	path := layout.SettingsFile()
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		legacy := layout.LegacySettingsFile()
		if legacy != path {
			raw, err = os.ReadFile(legacy)
		}
	}
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read existing settings before upgrade: %w", err)
	}

	var existing host.Settings
	if err := json.Unmarshal(raw, &existing); err != nil {
		return fmt.Errorf("existing settings.json is invalid; upgrade refused before service shutdown: %w", err)
	}
	expected := layout.Settings("")
	for _, item := range []struct{ name, got, want string }{
		{"node", existing.Node, expected.Node},
		{"entry", existing.Entry, expected.Entry},
		{"workingDirectory", existing.WorkingDirectory, expected.WorkingDirectory},
		{"dataRoot", existing.DataRoot, expected.DataRoot},
	} {
		if item.got == "" || !strings.EqualFold(filepath.Clean(item.got), filepath.Clean(item.want)) {
			return fmt.Errorf("existing settings.json %s points outside the packaged runtime (got %q, expected %q); upgrade refused before service shutdown. Back up and review settings.json; no operator options were rewritten", item.name, item.got, item.want)
		}
	}
	return nil
}

// WriteSettings creates the settings document, refusing to overwrite an
// existing one. A re-run of setup.exe upgrades the program files and must not
// quietly reset the URL, port or permission level the operator edited. An
// existing document in the legacy ProgramData location is copied into the
// install folder before a fresh default can be written.
func (layout Layout) WriteSettings(settings host.Settings) (bool, error) {
	path := layout.SettingsFile()
	if _, err := os.Stat(path); err == nil {
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("check %s: %w", path, err)
	}
	if legacy := layout.LegacySettingsFile(); legacy != path {
		if raw, err := os.ReadFile(legacy); err == nil {
			if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
				return false, fmt.Errorf("create install folder for settings: %w", err)
			}
			if err := os.WriteFile(path, raw, 0o640); err != nil {
				return false, fmt.Errorf("migrate %s: %w", legacy, err)
			}
			return false, nil
		} else if !os.IsNotExist(err) {
			return false, fmt.Errorf("read legacy settings %s: %w", legacy, err)
		}
	}
	if err := os.MkdirAll(layout.DataRoot, 0o750); err != nil {
		return false, fmt.Errorf("create data root %s: %w", layout.DataRoot, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return false, fmt.Errorf("create install folder for settings: %w", err)
	}
	raw, err := SettingsJSON(settings)
	if err != nil {
		return false, err
	}
	if err := os.WriteFile(path, raw, 0o640); err != nil {
		return false, fmt.Errorf("write %s: %w", path, err)
	}
	return true, nil
}

// CheckListenerFree reports whether the loopback port the service is about to
// bind is actually free, and names the mechanism that is probably holding it.
//
// The service already refuses a bound port at boot, but by then the installer
// has written files and registered the service, and the operator is left with a
// stopped service and no explanation. On a machine migrating from the old
// launcher this check is the difference between a clean install and a mystery:
// nothing here stops or kills the foreign process, it only says it exists.
func CheckListenerFree(port string) error {
	err := probeListener(port)
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s is already in use: %w (a process the installer did not start is listening; stop it first)", listenerAddress(port), err)
}

// WaitListenerFree gives a service the installer just stopped time to release
// the port. An already-running install holds both the listener and the runtime
// binaries open, so a port that can be bound again is also the sign that the
// previous node process has really gone and its files can be overwritten.
func WaitListenerFree(port string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if err := probeListener(port); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return CheckListenerFree(port)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func listenerAddress(port string) string {
	return net.JoinHostPort("127.0.0.1", port)
}

func probeListener(port string) error {
	listener, err := net.Listen("tcp", listenerAddress(port))
	if err != nil {
		return err
	}
	return listener.Close()
}

// CheckWorkerIdle is a read-only upgrade preflight. Owner-session Git
// workers are detached from the Windows service and may outlive its stop.
// Refuse an upgrade BEFORE stopping the service or extracting any files when
// their image is locked. Never terminate workers or alter HKCU enrollment here.
func (layout Layout) CheckWorkerIdle() error {
	worker := layout.WorkerBinary()
	if _, err := os.Stat(worker); errors.Is(err, os.ErrNotExist) {
		return nil // no previous install
	}
	file, err := os.OpenFile(worker, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("%s is in use or unavailable: close enrolled HooshiX owner-session Windows Git workers from an independent Windows session, then retry setup; service and files were not changed (%w)", worker, err)
	}
	return file.Close()
}

// CheckTrayIdle opens the installed tray executable the way an overwrite would.
// Windows keeps an image locked while it runs, so a failure here means the
// notification-area icon is still up and its files cannot be replaced.
//
// Nothing in the installer closes that process. Stopping it from here would mean
// reaching for a process this run did not start, and the tray's own menu holds
// the item that does it cleanly.
func (layout Layout) CheckTrayIdle() error {
	if _, err := os.Stat(layout.TrayBinary()); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	file, err := os.OpenFile(layout.TrayBinary(), os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("%s is still running: open its icon menu and choose \"Close tray icon\", then run setup again (%w)", layout.TrayBinary(), err)
	}
	return file.Close()
}

// TrayCommand is the value the installer writes to the all-users startup key.
// The tray cannot run as a service: a notification area lives inside somebody's
// session. Persistence for the connector itself is the SCM registration, which is
// why this points at the tray and never at the service binary.
func (layout Layout) TrayCommand() string {
	return QuoteCommand(layout.TrayBinary())
}

// UninstallCommand is the Add/Remove Programs action. It runs the payload-less
// copy of setup that this install writes into the bin directory.
func (layout Layout) UninstallCommand() string {
	return QuoteCommand(layout.UninstallerBinary(), "--uninstall")
}

// QuoteCommand builds a command line for a path that may contain spaces. The
// quotes belong to the executable only; arguments stay outside them.
func QuoteCommand(program string, arguments ...string) string {
	command := `"` + filepath.Clean(program) + `"`
	for _, argument := range arguments {
		command += " " + argument
	}
	return command
}

// AddRemoveProgramEntries are the values that make the install appear in
// Programs. They are returned as data instead of being written here, so the
// shape of what the installer promises stays checkable without a registry.
func (layout Layout) AddRemoveProgramEntries(version string) map[string]string {
	entries := map[string]string{
		"DisplayName":     AppName,
		"InstallLocation": filepath.Clean(layout.InstallDir),
		"UninstallString": layout.UninstallCommand(),
		"DisplayIcon":     filepath.Clean(layout.TrayBinary()),
		"NoRepair":        "1",
	}
	if version = strings.TrimSpace(version); version != "" {
		entries["DisplayVersion"] = version
	}
	return entries
}

// ReadAppVersion reports the version of the application that was just extracted.
// The manifest inside the app directory is the only place that number exists, so
// the Programs entry reads it from the installed tree instead of carrying a
// second copy that could disagree with the first.
func (layout Layout) ReadAppVersion() string {
	file, err := os.Open(filepath.Join(layout.AppDir, "package.json"))
	if err != nil {
		return ""
	}
	defer file.Close()
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(file).Decode(&manifest); err != nil {
		return ""
	}
	return strings.TrimSpace(manifest.Version)
}
