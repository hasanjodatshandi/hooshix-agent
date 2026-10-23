package setup

import (
	"debug/pe"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Local opt-in regression using a real Authenticode-signed installer file.
// No signing key or signing operation is required in CI or in the test itself.
func TestExistingSignedInstallerPayloadReadable(t *testing.T) {
	fixture := os.Getenv("HOOSHIX_STAGING_SIGNED_INSTALLER")
	if fixture == "" {
		t.Skip("set HOOSHIX_STAGING_SIGNED_INSTALLER to a signed fixture")
	}
	signed, err := os.Open(fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer signed.Close()
	payload, err := Locate(signed)
	if err != nil {
		t.Fatalf("signed bundle payload unreadable: %v", err)
	}
	if payload.Size < 1024*1024 || payload.Offset <= 1024 {
		t.Fatalf("unexpected signed bundle payload location: %+v", payload)
	}
	t.Logf("signed-installer payload located: offset=%d bytes=%d, CRC=%08x", payload.Offset, payload.Size, payload.Checksum)
}

func TestSignedInstallerRejectsInvalidAlignmentAndPayload(t *testing.T) {
	fixture := os.Getenv("HOOSHIX_STAGING_SIGNED_INSTALLER")
	if fixture == "" {
		t.Skip("set HOOSHIX_STAGING_SIGNED_INSTALLER to an already-signed fixture")
	}
	file, err := os.Open(fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	payload, err := Locate(file)
	if err != nil {
		t.Fatal(err)
	}
	image, err := pe.NewFile(file)
	if err != nil {
		t.Fatal(err)
	}
	defer image.Close()
	var certStart int64
	switch header := image.OptionalHeader.(type) {
	case *pe.OptionalHeader32:
		certStart = int64(header.DataDirectory[4].VirtualAddress)
	case *pe.OptionalHeader64:
		certStart = int64(header.DataDirectory[4].VirtualAddress)
	default:
		t.Fatal("unsupported signed PE")
	}
	padding := certStart - (payload.Offset + payload.Size + TrailerSize)
	if padding < 1 || padding > 7 {
		t.Fatalf("expected real Authenticode padding 1..7, got %d", padding)
	}
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("nonzero alignment is denied", func(t *testing.T) {
		altered := append([]byte(nil), raw...)
		altered[certStart-1] = 0x7f
		path := filepath.Join(t.TempDir(), "bad-alignment.exe")
		if err := os.WriteFile(path, altered, 0o600); err != nil {
			t.Fatal(err)
		}
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if _, err := Locate(f); err == nil || !strings.Contains(err.Error(), "nonzero Authenticode alignment") {
			t.Fatalf("modified alignment was accepted: %v", err)
		}
	})
	t.Run("altered payload is denied", func(t *testing.T) {
		altered := append([]byte(nil), raw...)
		altered[payload.Offset] ^= 0x01
		path := filepath.Join(t.TempDir(), "corrupt-payload.exe")
		if err := os.WriteFile(path, altered, 0o600); err != nil {
			t.Fatal(err)
		}
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if _, err := Locate(f); err == nil {
			t.Fatal("corrupt payload was accepted")
		}
	})
}
