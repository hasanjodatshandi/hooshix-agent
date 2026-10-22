package setup

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This replays a REAL installer payload upgrade/rollback on two disposable
// directory trees. It does not touch SCM, HKLM, Program Files or ProgramData.
// SCM account preservation is independently guarded by svc.PrepareForUpgrade.
func TestStagedInstallerUpgradeAndRollbackContents(t *testing.T) {
	source := os.Getenv("HOOSHIX_STAGING_INSTALLER")
	if source == "" {
		t.Skip("set HOOSHIX_STAGING_INSTALLER to the real candidate")
	}
	installer, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer installer.Close()
	payload, err := Locate(installer)
	if err != nil {
		t.Fatalf("invalid installer archive: %v", err)
	}

	sandbox := t.TempDir()
	layout, err := NewLayout(filepath.Join(sandbox, "programs"), filepath.Join(sandbox, "state"))
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"bin/hooshix-mcp-service.exe", "app/dist/index-http.js", "runtime/node.exe", "legacy-only.txt"} {
		filename := filepath.Join(layout.InstallDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte("baseline:"+rel), 0600); err != nil {
			t.Fatal(err)
		}
	}
	original := layout.Settings("https://operator.example")
	original.Env["HOOSHIX_EXEC_ENABLED"] = "1"
	created, err := layout.WriteSettings(original)
	if err != nil || !created {
		t.Fatalf("seed settings: %v", err)
	}
	sentinel := filepath.Join(layout.DataRoot, "operator-sentinel.db")
	if err := os.WriteFile(sentinel, []byte("operator-data-preserved"), 0600); err != nil {
		t.Fatal(err)
	}
	beforeSettings, err := os.ReadFile(layout.SettingsFile())
	if err != nil {
		t.Fatal(err)
	}
	if err := layout.CheckExistingSettingsRuntime(); err != nil {
		t.Fatalf("valid upgrade blocked: %v", err)
	}
	// A retained development runtime must be refused before any extraction.
	invalid := original
	invalid.Entry = filepath.Join(sandbox, "foreign", "index-http.js")
	invalidBytes, err := SettingsJSON(invalid)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(layout.SettingsFile(), invalidBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err := layout.CheckExistingSettingsRuntime(); err == nil || !strings.Contains(err.Error(), "upgrade refused") {
		t.Fatalf("unpackaged entry was accepted: %v", err)
	}
	oldBinary, _ := os.ReadFile(layout.ServiceBinary())
	if string(oldBinary) != "baseline:bin/hooshix-mcp-service.exe" {
		t.Fatal("unsafe preflight touched old service")
	}
	if err := os.WriteFile(layout.SettingsFile(), beforeSettings, 0600); err != nil {
		t.Fatal(err)
	}

	backup := filepath.Join(sandbox, "verified-backup")
	if err := copyForTest(layout.InstallDir, filepath.Join(backup, "program")); err != nil {
		t.Fatal(err)
	}
	if err := copyForTest(layout.DataRoot, filepath.Join(backup, "data")); err != nil {
		t.Fatal(err)
	}
	oldSentinel, _ := os.ReadFile(sentinel)

	count, err := ExtractArchive(installer, payload, layout.InstallDir, nil)
	if err != nil {
		t.Fatalf("actual installer payload upgrade failed: %v", err)
	}
	if count < 100 {
		t.Fatalf("incomplete archive: extracted %d", count)
	}
	if _, err := os.Stat(filepath.Join(layout.InstallDir, "app", "dist", "index-http.js")); err != nil {
		t.Fatal(err)
	}
	newService, _ := os.ReadFile(layout.ServiceBinary())
	if bytes.Equal(newService, oldBinary) {
		t.Fatal("archive did not replace previous service binary")
	}
	if made, err := layout.WriteSettings(layout.Settings("https://wrong-origin.example")); err != nil || made {
		t.Fatalf("upgrade overwrote operator settings: made=%v error=%v", made, err)
	}
	afterSettings, _ := os.ReadFile(layout.SettingsFile())
	if !bytes.Equal(beforeSettings, afterSettings) {
		t.Fatal("operator settings changed")
	}
	dataAfter, _ := os.ReadFile(sentinel)
	if !bytes.Equal(oldSentinel, dataAfter) {
		t.Fatal("operator database changed")
	}
	newOnly := filepath.Join(layout.DataRoot, "post-upgrade-only.tmp")
	if err := os.WriteFile(newOnly, []byte("new-version-extra"), 0600); err != nil {
		t.Fatal(err)
	}

	// Mirrors the recovery script's offline /MIR restore to an isolated tree.
	if err := os.RemoveAll(layout.InstallDir); err != nil {
		t.Fatal(err)
	}
	if err := copyForTest(filepath.Join(backup, "program"), layout.InstallDir); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(layout.DataRoot); err != nil {
		t.Fatal(err)
	}
	if err := copyForTest(filepath.Join(backup, "data"), layout.DataRoot); err != nil {
		t.Fatal(err)
	}

	restoredService, _ := os.ReadFile(layout.ServiceBinary())
	restoredSettings, _ := os.ReadFile(layout.SettingsFile())
	restoredData, _ := os.ReadFile(sentinel)
	if !bytes.Equal(restoredService, oldBinary) ||
		!bytes.Equal(restoredSettings, beforeSettings) ||
		!bytes.Equal(restoredData, oldSentinel) {
		t.Fatal("rollback did not restore the original bytes")
	}
	if _, err := os.Stat(newOnly); !os.IsNotExist(err) {
		t.Fatalf("rollback retained upgrade-only data: %v", err)
	}
	t.Logf("ISOLATED_UPGRADE_ROLLBACK_PASS; files=%d; old binary, settings, operator data restored", count)
}

func copyForTest(source, destination string) error {
	return filepath.Walk(source, func(p string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, p)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		if !info.Mode().IsRegular() {
			return os.ErrPermission
		}
		input, err := os.Open(p)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, err = io.Copy(output, input)
		closeErr := output.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
}
