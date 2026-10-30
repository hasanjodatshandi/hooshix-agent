package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsPathBesideExecutablePrefersInstallFolder(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0o750); err != nil {
		t.Fatalf("create bin: %v", err)
	}
	executable := filepath.Join(bin, "hooshix-mcp-service.exe")

	candidate, ok := settingsPathBesideExecutable(executable)
	if ok {
		t.Fatalf("a missing install-folder document was accepted: %q", candidate)
	}
	if want := filepath.Join(root, "settings.json"); candidate != want {
		t.Fatalf("candidate = %q, want %q", candidate, want)
	}

	settings := filepath.Join(root, "settings.json")
	if err := os.WriteFile(settings, []byte("{}\n"), 0o640); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	candidate, ok = settingsPathBesideExecutable(executable)
	if !ok || candidate != settings {
		t.Fatalf("install-folder settings = %q, ok=%v; want %q", candidate, ok, settings)
	}
}

func TestSettingsPathBesideExecutableRejectsEmptyPath(t *testing.T) {
	if candidate, ok := settingsPathBesideExecutable(" "); ok || candidate != "" {
		t.Fatalf("empty executable produced %q, ok=%v", candidate, ok)
	}
}
