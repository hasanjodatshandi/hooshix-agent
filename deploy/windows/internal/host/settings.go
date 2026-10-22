// Package host runs and supervises the HooshiX MCP Node.js server as a
// Windows service: it resolves the install layout, keeps the child process
// alive, and publishes the state the tray renders.
package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Settings is the content of settings.json, the machine-wide description of
// where a HooshiX MCP install lives. Changing the runtime path, the port or
// the published origin is a file edit, not a rebuild — the same contract the
// Edge Agent uses for its config.json.
type Settings struct {
	// Node is the absolute path to the node executable that runs the server.
	Node string `json:"node"`
	// Entry is the absolute path to the server entry point (dist/index-http.js).
	Entry string `json:"entry"`
	// WorkingDirectory is where the server process starts. It is advisory only:
	// every path the server writes is supplied absolutely by Environment, so a
	// service working directory of C:\Windows\System32 cannot leak files there.
	WorkingDirectory string `json:"workingDirectory"`
	// DataRoot holds data/, logs/ and secrets/ for the install.
	DataRoot string `json:"dataRoot"`
	// WslDistros names the Windows Subsystem for Linux distributions whose files
	// the connector may be pointed at. Empty means the service never touches the
	// subsystem, which is the right default: a name here is a request to make
	// \\wsl.localhost visible in the service's own logon session.
	WslDistros []string `json:"wslDistros"`
	// Env carries the remaining HOOSHIX_* settings for the server process.
	Env map[string]string `json:"env"`

	logDirectory  string
	listenAddress string
	publicBaseURL string
	environment   []string
}

// ossEnvironmentKeys are inherited from the service process so the Node runtime
// gets the loader inputs a Windows process needs. Nothing else is inherited:
// an operator's shell environment once carried a stale permission level and
// silently downgraded the assistant, so the child sees this document only.
var ossEnvironmentKeys = []string{"SystemRoot", "SystemDrive", "windir", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData"}

// DefaultSettingsPath is where the service looks when no -settings flag is given.
func DefaultSettingsPath() (string, error) {
	base := os.Getenv("ProgramData")
	if base == "" {
		return "", fmt.Errorf("ProgramData is not defined; cannot locate the HooshiX MCP settings file")
	}
	return filepath.Join(base, "HooshiXMCP", "settings.json"), nil
}

// LoadSettings reads, validates and freezes one settings document.
func LoadSettings(path string) (*Settings, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read settings %s: %w", path, err)
	}
	settings := &Settings{}
	if err := json.Unmarshal(raw, settings); err != nil {
		return nil, fmt.Errorf("parse settings %s: %w", path, err)
	}
	if err := settings.freeze(); err != nil {
		return nil, fmt.Errorf("invalid settings %s: %w", path, err)
	}
	return settings, nil
}

func requireAbsolute(field, value string) error {
	if value == "" {
		return fmt.Errorf("%s is required", field)
	}
	if !filepath.IsAbs(value) {
		return fmt.Errorf("%s must be an absolute path, got %q", field, value)
	}
	return nil
}

func (settings *Settings) freeze() error {
	// Relative paths are refused outright. A boot-start service has no
	// interactive profile and its working directory is normally
	// C:\Windows\System32, which LocalSystem can write into.
	for _, check := range []struct{ field, value string }{
		{"node", settings.Node},
		{"entry", settings.Entry},
		{"workingDirectory", settings.WorkingDirectory},
		{"dataRoot", settings.DataRoot},
	} {
		if err := requireAbsolute(check.field, check.value); err != nil {
			return err
		}
	}
	// A mistyped distribution is a configuration mistake the operator can fix in
	// the document, so it is refused here rather than logged at every boot.
	for _, distro := range settings.WslDistros {
		if err := validateWslDistro(distro); err != nil {
			return err
		}
	}
	if err := settings.verifyLayout(); err != nil {
		return err
	}

	env := map[string]string{}
	for key, value := range settings.Env {
		env[key] = value
	}
	// The three paths the server writes at boot are owned by the service host.
	// An image that ignored HOOSHIX_LOG_DIR failed with EACCES on a relative
	// "logs", and a missing HOOSHIX_DB_PATH puts the memory database in
	// whatever the working directory happens to be.
	setDefault(env, "HOOSHIX_LOG_DIR", filepath.Join(settings.DataRoot, "logs"))
	setDefault(env, "HOOSHIX_DB_PATH", filepath.Join(settings.DataRoot, "data", "mcp.db"))
	setDefault(env, "HOOSHIX_BOOTSTRAP_TOKEN_FILE", filepath.Join(settings.DataRoot, "secrets", ".token"))
	setDefault(env, "HOOSHIX_HTTP_PORT", "3001")
	setDefault(env, "HOOSHIX_HTTP_HOST", "127.0.0.1")
	for _, key := range []string{"HOOSHIX_LOG_DIR", "HOOSHIX_DB_PATH", "HOOSHIX_BOOTSTRAP_TOKEN_FILE"} {
		if err := requireAbsolute(key, env[key]); err != nil {
			return err
		}
	}

	settings.logDirectory = env["HOOSHIX_LOG_DIR"]
	settings.publicBaseURL = env["HOOSHIX_PUBLIC_BASE_URL"]
	settings.listenAddress = "http://" + env["HOOSHIX_HTTP_HOST"] + ":" + env["HOOSHIX_HTTP_PORT"]
	settings.environment = settings.childEnvironment(env, os.Environ())
	settings.Env = env
	return nil
}

// verifyLayout fails fast on the mistakes that would otherwise surface as an
// unexplained stopped service: a missing runtime, a moved install, a data root
// that cannot be created.
func (settings *Settings) verifyLayout() error {
	info, err := os.Stat(settings.Node)
	if err != nil {
		return fmt.Errorf("node runtime %s is unavailable: %w", settings.Node, err)
	}
	if info.IsDir() {
		return fmt.Errorf("node runtime %s is a directory, not an executable", settings.Node)
	}
	switch extension := strings.ToLower(filepath.Ext(settings.Entry)); extension {
	case ".js", ".mjs", ".cjs":
	default:
		return fmt.Errorf("entry %s is not a JavaScript file", settings.Entry)
	}
	if _, err := os.Stat(settings.Entry); err != nil {
		return fmt.Errorf("server entry %s is unavailable: %w", settings.Entry, err)
	}
	if info, err := os.Stat(settings.WorkingDirectory); err != nil {
		return fmt.Errorf("working directory %s is unavailable: %w", settings.WorkingDirectory, err)
	} else if !info.IsDir() {
		return fmt.Errorf("working directory %s is not a directory", settings.WorkingDirectory)
	}
	for _, subdirectory := range []string{"data", "logs", "secrets"} {
		directory := filepath.Join(settings.DataRoot, subdirectory)
		if err := os.MkdirAll(directory, 0o750); err != nil {
			return fmt.Errorf("data root %s is not usable: %w", directory, err)
		}
	}
	return nil
}

func setDefault(env map[string]string, key, value string) {
	if existing, ok := env[key]; !ok || strings.TrimSpace(existing) == "" {
		env[key] = value
	}
}

// inheritedOsEnvironment picks the allowlisted variables out of a raw
// environment block. Names are matched the way Windows resolves them — without
// regard to case — and are returned spelled as the allowlist spells them,
// because the block a service starts with carries them as the registry does:
// "Path", "ComSpec", "WINDIR". Matching them exactly dropped PATH from the
// server process, and every command a client then asked for died with
// `spawn cmd.exe ENOENT` — a missing search path wearing the costume of a
// permission failure. Where one name appears twice, the first entry wins, which
// is what the system reports for that name.
func inheritedOsEnvironment(block []string) map[string]string {
	byFoldedName := map[string]string{}
	for _, entry := range block {
		name, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		folded := strings.ToUpper(name)
		if _, seen := byFoldedName[folded]; !seen {
			byFoldedName[folded] = value
		}
	}
	inherited := map[string]string{}
	for _, key := range ossEnvironmentKeys {
		if value, ok := byFoldedName[strings.ToUpper(key)]; ok && value != "" {
			inherited[key] = value
		}
	}
	return inherited
}

// requiredChildEnvironment names the one inherited variable without which the
// server cannot run a command at all. It is not the loader's requirement — Node
// starts fine without it — so the absence has to be said out loud instead of
// surfacing as an unexplained failure in a client conversation days later.
func requiredChildEnvironment(block []string) string {
	if value, ok := inheritedOsEnvironment(block)["PATH"]; !ok || strings.TrimSpace(value) == "" {
		return "PATH is not in the service environment; every tool that runs a command (git, execute_command, exec, package installs) will fail to find its interpreter"
	}
	return ""
}

func (settings *Settings) childEnvironment(env map[string]string, block []string) []string {
	combined := inheritedOsEnvironment(block)
	// Windows API/registry paths may contain %SystemDrive%. Without it,
	// known-folder expansion can create a literal %SystemDrive% directory in
	// the process cwd. Derive it from the trusted system root if SCM omitted it.
	if _, ok := combined["SystemDrive"]; !ok {
		root := combined["SystemRoot"]
		if len(root) >= 3 && root[1] == ':' && (root[2] == '\\' || root[2] == '/') {
			combined["SystemDrive"] = root[:2]
		}
	}
	for key, value := range env {
		combined[key] = value
	}
	environment := make([]string, 0, len(combined))
	for key, value := range combined {
		environment = append(environment, key+"="+value)
	}
	return environment
}

// Environment returns the frozen KEY=VALUE list for the server process.
func (settings *Settings) Environment() []string { return settings.environment }

// LogDirectory is where the server's own diagnostic logs are written.
func (settings *Settings) LogDirectory() string { return settings.logDirectory }

// ListenAddress is the loopback origin the supervisor probes for health.
func (settings *Settings) ListenAddress() string { return settings.listenAddress }

// PublicBaseURL is the trusted origin the connector advertises, if any.
func (settings *Settings) PublicBaseURL() string { return settings.publicBaseURL }
