package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsUpgradeRecoveryRoundTrip(t *testing.T) {
	base := t.TempDir()
	layout, err := NewLayout(filepath.Join(base, "Program Files"), filepath.Join(base, "ProgramData"))
	if err != nil {
		t.Fatal(err)
	}
	oldBinary := filepath.Join(layout.InstallDir, "bin", "hooshix-mcp-service.exe")
	if err = os.MkdirAll(filepath.Dir(oldBinary), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(oldBinary, []byte("old-windows-service"), 0600); err != nil {
		t.Fatal(err)
	}
	originalSettings := layout.Settings("https://customer.example")
	if _, err = layout.WriteSettings(originalSettings); err != nil {
		t.Fatal(err)
	}
	customerData := filepath.Join(layout.DataRoot, "client.sqlite")
	if err = os.WriteFile(customerData, []byte("customer-data-must-survive"), 0600); err != nil {
		t.Fatal(err)
	}

	first := RecoveryFor(layout)
	if err = first.Snapshot(); err != nil {
		t.Fatal(err)
	}
	if err = first.Snapshot(); err == nil {
		t.Fatal("stale pending snapshot must fail closed")
	}
	if err = os.WriteFile(oldBinary, []byte("new-service"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = first.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = first.CheckPrevious(); err != nil {
		t.Fatal(err)
	}
	if err = first.RestorePrevious(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(oldBinary)
	if err != nil || string(got) != "old-windows-service" {
		t.Fatalf("rollback bytes %q %v", got, err)
	}
	settings, err := os.ReadFile(layout.SettingsFile())
	if err != nil || !strings.Contains(string(settings), "customer.example") {
		t.Fatal("settings altered")
	}
	data, err := os.ReadFile(customerData)
	if err != nil || string(data) != "customer-data-must-survive" {
		t.Fatal("client data altered")
	}
	if err = first.ConsumePrevious(); err != nil {
		t.Fatal(err)
	}
	if err = first.CheckPrevious(); err == nil {
		t.Fatal("consumed rollback must not repeat")
	}
}

func TestWindowsUpgradeRecoveryRejectsSymlinkWithoutChangingSource(t *testing.T) {
	root := t.TempDir()
	layout, err := NewLayout(filepath.Join(root, "apps"), filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(layout.InstallDir, 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "outside.txt")
	if err = os.WriteFile(outside, []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(layout.InstallDir, "unsafe-alias")
	if err = os.Symlink(outside, link); err != nil {
		t.Skipf("symlink creation not permitted: %v", err)
	}
	snapshot := RecoveryFor(layout)
	if err = snapshot.Snapshot(); err == nil {
		t.Fatal("linked installer payload accepted")
	}
	got, err := os.ReadFile(outside)
	if err != nil || string(got) != "protected" {
		t.Fatal("followed link outside installer")
	}
}
func TestWindowsRecoveryCancelDoesNotDeleteSettings(t *testing.T) {
	root := t.TempDir()
	layout, err := NewLayout(filepath.Join(root, "apps"), filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(layout.InstallDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(layout.InstallDir, "bin.txt"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = layout.WriteSettings(layout.Settings("https://customer.example")); err != nil {
		t.Fatal(err)
	}
	snapshot := RecoveryFor(layout)
	if err = snapshot.Snapshot(); err != nil {
		t.Fatal(err)
	}
	if err = snapshot.Cancel(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(layout.SettingsFile()); err != nil {
		t.Fatal("customer settings were deleted")
	}
	got, _ := os.ReadFile(filepath.Join(layout.InstallDir, "bin.txt"))
	if string(got) != "old" {
		t.Fatal("cancel altered program files")
	}
}
