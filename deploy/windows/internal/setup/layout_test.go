package setup

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
)

func TestLayoutSettingsPointAtTheInstalledRuntime(t *testing.T) {
	layout, err := NewLayout(`C:\Program Files`, `C:\ProgramData`)
	if err != nil {
		t.Fatalf("build the layout: %v", err)
	}
	settings := layout.Settings("")
	for _, value := range []string{settings.Node, settings.Entry, settings.WorkingDirectory, settings.DataRoot} {
		if !IsAbsolute(value) {
			t.Errorf("settings path %q is not absolute", value)
		}
	}
	if settings.Env["HOOSHIX_PUBLIC_BASE_URL"] != DefaultPublicBaseURL {
		t.Errorf("an empty base URL produced %q, want the deployment default", settings.Env["HOOSHIX_PUBLIC_BASE_URL"])
	}
	if got, want := layout.SettingsFile(), filepath.Join(layout.InstallDir, "settings.json"); got != want {
		t.Errorf("settings file = %q, want %q (beside the installed program)", got, want)
	}
	if got, want := layout.LegacySettingsFile(), filepath.Join(layout.DataRoot, "settings.json"); got != want {
		t.Errorf("legacy settings file = %q, want %q", got, want)
	}
	// The permission knobs are opt-ins. Shipping them switched on would hand
	// every fresh install a remote code execution endpoint.
	for _, key := range []string{"HOOSHIX_PERMISSION_LEVEL", "HOOSHIX_DIRECT_AUTO_APPROVE", "HOOSHIX_EXEC_ENABLED", "CTX_ISOLATION_MODE"} {
		if _, found := settings.Env[key]; found {
			t.Errorf("the installer sets %s; an operator has to choose that", key)
		}
	}

	raw, err := SettingsJSON(settings)
	if err != nil {
		t.Fatalf("render settings: %v", err)
	}
	if !strings.HasSuffix(string(raw), "}\n") {
		t.Errorf("the settings document does not end with a newline: %q", raw[len(raw)-8:])
	}
}

func TestWriteSettingsMigratesLegacyDocumentToInstallFolder(t *testing.T) {
	root := t.TempDir()
	layout, err := NewLayout(filepath.Join(root, "Program Files"), filepath.Join(root, "ProgramData"))
	if err != nil {
		t.Fatalf("build the layout: %v", err)
	}
	if err := os.MkdirAll(layout.DataRoot, 0o750); err != nil {
		t.Fatalf("create data root: %v", err)
	}
	legacy := layout.Settings("https://legacy.example")
	raw, err := SettingsJSON(legacy)
	if err != nil {
		t.Fatalf("render legacy settings: %v", err)
	}
	if err := os.WriteFile(layout.LegacySettingsFile(), raw, 0o600); err != nil {
		t.Fatalf("write legacy settings: %v", err)
	}

	created, err := layout.WriteSettings(layout.Settings("https://default.example"))
	if err != nil || created {
		t.Fatalf("migrate: created=%v err=%v", created, err)
	}
	migrated, err := os.ReadFile(layout.SettingsFile())
	if err != nil {
		t.Fatalf("read install-folder settings: %v", err)
	}
	if !strings.Contains(string(migrated), "https://legacy.example") {
		t.Fatalf("the install-folder document lost the operator setting: %s", migrated)
	}
	if _, err := os.Stat(layout.LegacySettingsFile()); err != nil {
		t.Fatalf("legacy settings should remain available as a fallback: %v", err)
	}
}

func TestWriteSettingsNeverOverwritesAnExistingDocument(t *testing.T) {	// Only DataRoot is filled in: the installer gets here after DefaultLayout has
	// checked the roots, and the settings write touches nothing else.
	layout := Layout{DataRoot: t.TempDir()}
	created, err := layout.WriteSettings(layout.Settings("https://mcp.example"))
	if err != nil || !created {
		t.Fatalf("first write: created=%v err=%v", created, err)
	}
	raw, err := os.ReadFile(layout.SettingsFile())
	if err != nil {
		t.Fatalf("read the settings document: %v", err)
	}
	if !strings.Contains(string(raw), "https://mcp.example") {
		t.Fatalf("the written document lost the base URL: %s", raw)
	}

	// A re-run with a different URL must leave the operator's file untouched.
	if created, err := layout.WriteSettings(layout.Settings("https://overwritten.example")); err != nil || created {
		t.Fatalf("second write should be refused: created=%v err=%v", created, err)
	}
	after, err := os.ReadFile(layout.SettingsFile())
	if err != nil {
		t.Fatalf("re-read the settings document: %v", err)
	}
	if string(after) != string(raw) {
		t.Error("re-running setup rewrote the settings document")
	}
}

func TestCheckExistingSettingsRuntimeFailsClosedBeforeInstallerMutatesService(t *testing.T) {
	layout := Layout{
		DataRoot:   t.TempDir(),
		AppDir:     filepath.Join(t.TempDir(), "installed-app"),
		RuntimeDir: filepath.Join(t.TempDir(), "installed-runtime"),
	}
	// No previous installation is safe. An existing packaged-runtime settings
	// document is safe, regardless of operator-owned URL or environment values.
	if err := layout.CheckExistingSettingsRuntime(); err != nil {
		t.Fatalf("fresh install was blocked: %v", err)
	}
	settings := layout.Settings("https://operator.example")
	settings.Env["HOOSHIX_EXEC_ENABLED"] = "1"
	raw, err := SettingsJSON(settings)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(layout.SettingsFile(), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := layout.CheckExistingSettingsRuntime(); err != nil {
		t.Fatalf("valid preserved settings were refused: %v", err)
	}

	scenarios := []struct {
		name   string
		change func(*host.Settings)
	}{
		{"old development entry", func(s *host.Settings) { s.Entry = filepath.Join(t.TempDir(), "dist", "index-http.js") }},
		{"old development cwd", func(s *host.Settings) { s.WorkingDirectory = t.TempDir() }},
		{"unexpected node", func(s *host.Settings) { s.Node = filepath.Join(t.TempDir(), "node.exe") }},
		{"unexpected state root", func(s *host.Settings) { s.DataRoot = t.TempDir() }},
	}
	for _, tc := range scenarios {
		t.Run(tc.name, func(t *testing.T) {
			altered := settings
			altered.Env = map[string]string{"HOOSHIX_EXEC_ENABLED": "1", "HOOSHIX_PUBLIC_BASE_URL": "https://operator.example"}
			tc.change(&altered)
			prior, err := SettingsJSON(altered)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(layout.SettingsFile(), prior, 0o600); err != nil {
				t.Fatal(err)
			}
			if err = layout.CheckExistingSettingsRuntime(); err == nil || !strings.Contains(err.Error(), "upgrade refused before service shutdown") {
				t.Fatalf("unsafe runtime was allowed or warning missing: %v", err)
			}
			after, err := os.ReadFile(layout.SettingsFile())
			if err != nil {
				t.Fatal(err)
			}
			if string(after) != string(prior) {
				t.Fatal("guard rewrote operator settings")
			}
		})
	}
	if err := os.WriteFile(layout.SettingsFile(), []byte("{ invalid JSON"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := layout.CheckExistingSettingsRuntime(); err == nil || !strings.Contains(err.Error(), "upgrade refused before service shutdown") {
		t.Fatalf("corrupted settings were accepted: %v", err)
	}
}

func TestNewLayoutRefusesUnusableRoots(t *testing.T) {
	if _, err := NewLayout("", `C:\ProgramData`); err == nil {
		t.Error("a missing Program Files was accepted")
	}
	if _, err := NewLayout(`C:\Program Files`, ""); err == nil {
		t.Error("a missing ProgramData was accepted")
	}
	if _, err := NewLayout(`relative/where`, `C:\ProgramData`); err == nil {
		t.Error("a relative install directory was accepted")
	}
	if _, err := NewLayout(`C:\ProgramData`, `C:\ProgramData`); err == nil {
		t.Error("one directory was accepted as both the program location and the state location")
	}
	if _, err := NewLayout(`C:\ProgramData`, `C:\ProgramData\HooshiXMCP`); err == nil {
		t.Error("a state root nested inside the program root was accepted")
	}
}

func TestCheckListenerFreeNamesThePortItProbed(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind a test listener: %v", err)
	}
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("read the test port: %v", err)
	}

	// The answer is only useful if the operator can read the address out loud,
	// and it must say the installer will not touch the foreign process.
	err = CheckListenerFree(port)
	if err == nil {
		t.Fatalf("port %s was reported free while this test holds it", port)
	}
	if !strings.Contains(err.Error(), "127.0.0.1:"+port) {
		t.Errorf("the error does not name the address: %v", err)
	}
	if !strings.Contains(err.Error(), "did not start") {
		t.Errorf("the error does not say the listener belongs to somebody else: %v", err)
	}
}

func TestInstallCommandsPointAtTheInstalledBinaries(t *testing.T) {
	layout, err := NewLayout(`C:\Program Files`, `C:\ProgramData`)
	if err != nil {
		t.Fatalf("build the layout: %v", err)
	}

	// Program Files carries a space, so a command line that is not quoted
	// reaches a path that does not exist.
	quoted := QuoteCommand(`C:\Program Files\HooshiX MCP\bin\uninstall.exe`, "--uninstall")
	if want := `"C:\Program Files\HooshiX MCP\bin\uninstall.exe" --uninstall`; quoted != want {
		t.Errorf("quoting produced %q, want %q", quoted, want)
	}
	// The startup key is how the icon appears after a sign-in. It must name the
	// tray and nothing else, and never the service, whose persistence is the SCM
	// registration.
	want := `"` + filepath.Clean(layout.TrayBinary()) + `"`
	if tray := layout.TrayCommand(); tray != want {
		t.Errorf("the startup command is %q, want exactly the quoted tray %q", tray, want)
	}
	for _, other := range []string{"hooshix-mcp-service", "uninstall", "node"} {
		if strings.Contains(layout.TrayCommand(), other) {
			t.Errorf("the startup command mentions %s: %q", other, layout.TrayCommand())
		}
	}

	uninstall := layout.UninstallCommand()
	quotedUninstaller := `"` + filepath.Clean(layout.UninstallerBinary()) + `"`
	if !strings.HasPrefix(uninstall, quotedUninstaller) {
		t.Errorf("the uninstall command does not run the payload-less copy: %q", uninstall)
	}
	if !strings.HasSuffix(uninstall, " --uninstall") {
		t.Errorf("the uninstall command does not select uninstall mode: %q", uninstall)
	}

	entries := layout.AddRemoveProgramEntries("0.9.4")
	if entries["DisplayName"] != AppName {
		t.Errorf("Programs would show %q, want %q", entries["DisplayName"], AppName)
	}
	if entries["UninstallString"] != uninstall {
		t.Errorf("the uninstall entry %q disagrees with UninstallCommand %q", entries["UninstallString"], uninstall)
	}
	if entries["InstallLocation"] != filepath.Clean(layout.InstallDir) {
		t.Errorf("the install location entry is %q", entries["InstallLocation"])
	}
	if entries["DisplayVersion"] != "0.9.4" {
		t.Errorf("the version entry is %q", entries["DisplayVersion"])
	}
	// An empty version is a blank cell, not a "0.0.0" that an operator reads as
	// an old install.
	unknown := layout.AddRemoveProgramEntries("")
	if _, found := unknown["DisplayVersion"]; found {
		t.Error("a version was invented for an unknown build")
	}
}

func TestReadAppVersionUsesTheInstalledManifest(t *testing.T) {
	layout := Layout{AppDir: t.TempDir()}
	if got := layout.ReadAppVersion(); got != "" {
		t.Errorf("a manifest that is not there produced %q", got)
	}
	manifest := filepath.Join(layout.AppDir, "package.json")
	if err := os.WriteFile(manifest, []byte(`{"name":"hooshix-agent","version":"0.9.4"}`), 0o640); err != nil {
		t.Fatalf("write the manifest: %v", err)
	}
	if got := layout.ReadAppVersion(); got != "0.9.4" {
		t.Errorf("read %q from the installed manifest", got)
	}

	// A truncated manifest is a cosmetic problem, not a reason to abandon an
	// install that has already written its files and registered its service.
	if err := os.WriteFile(manifest, []byte(`{"version":`), 0o640); err != nil {
		t.Fatalf("truncate the manifest: %v", err)
	}
	if got := layout.ReadAppVersion(); got != "" {
		t.Errorf("an unreadable manifest produced %q", got)
	}
}

func TestCheckTrayIdleOnlyObjectsWhenTheImageIsLocked(t *testing.T) {
	layout := Layout{BinDir: filepath.Join(t.TempDir(), "bin")}
	if err := layout.CheckTrayIdle(); err != nil {
		t.Errorf("a fresh install was reported as busy: %v", err)
	}
	if err := os.MkdirAll(layout.BinDir, 0o750); err != nil {
		t.Fatalf("create the bin directory: %v", err)
	}
	if err := os.WriteFile(layout.TrayBinary(), []byte("executable"), 0o640); err != nil {
		t.Fatalf("write the tray executable: %v", err)
	}
	if err := layout.CheckTrayIdle(); err != nil {
		t.Errorf("an installed tray that is not running was reported as busy: %v", err)
	}

	// A directory sitting on the executable's name is the portable stand-in for a
	// locked image: the stat says it is there and the write refuses it, which is
	// the pair the installer has to stop on instead of copying over a running tray.
	lockable := filepath.Join(t.TempDir(), "bin")
	if err := os.MkdirAll(filepath.Join(lockable, filepath.Base(layout.TrayBinary())), 0o750); err != nil {
		t.Fatalf("create the stand-in: %v", err)
	}
	err := Layout{BinDir: lockable}.CheckTrayIdle()
	if err == nil {
		t.Fatal("a tray executable that could not be opened was accepted")
	}
	if !strings.Contains(err.Error(), "Close tray icon") {
		t.Errorf("the error does not name the menu item the operator has to use: %v", err)
	}
}

func TestWaitListenerFreeHoldsItsDeadlineAndItsAnswer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind a test listener: %v", err)
	}
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("read the test port: %v", err)
	}

	started := time.Now()
	if err := WaitListenerFree(port, 300*time.Millisecond); err == nil {
		listener.Close()
		t.Fatalf("port %s was reported free while this test holds it", port)
	} else if elapsed := time.Since(started); elapsed < 250*time.Millisecond {
		listener.Close()
		t.Errorf("the wait gave up after %v of a 300ms deadline", elapsed)
	}
	listener.Close()

	// Once the previous listener is gone the answer has to come immediately,
	// because every second here is a second the operator watches a console.
	started = time.Now()
	if err := WaitListenerFree(port, 5*time.Second); err != nil {
		t.Fatalf("the released port was still reported busy: %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("a free port took %v to confirm", elapsed)
	}
}
