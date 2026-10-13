package setup

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeExe stands in for the setup binary: any bytes with an unmistakable end,
// so a test can prove the payload starts after them and the executable itself
// is not disturbed.
func writeExe(t *testing.T, directory string, size int) string {
	t.Helper()
	path := filepath.Join(directory, "setup.exe")
	if err := os.WriteFile(path, bytes.Repeat([]byte("M"), size), 0o640); err != nil {
		t.Fatalf("write stand-in executable: %v", err)
	}
	return path
}

func writeArchive(t *testing.T, directory string, body []byte) string {
	t.Helper()
	path := filepath.Join(directory, "runtime.zip")
	if err := os.WriteFile(path, body, 0o640); err != nil {
		t.Fatalf("write stand-in archive: %v", err)
	}
	return path
}

func TestBundleRoundTripsThroughTheTrailer(t *testing.T) {
	directory := t.TempDir()
	exe := writeExe(t, directory, 4096)
	archive := writeArchive(t, directory, []byte("PK\x03\x04 runtime bytes"))
	out := filepath.Join(directory, "HooshiX-MCP-Setup.exe")

	written, err := WriteBundle(exe, archive, out)
	if err != nil {
		t.Fatalf("assemble bundle: %v", err)
	}
	if written.Offset != 4096 {
		t.Errorf("payload offset = %d, want the payload to start one past the executable", written.Offset)
	}

	file, err := os.Open(out)
	if err != nil {
		t.Fatalf("open assembled file: %v", err)
	}
	defer file.Close()
	found, err := Locate(file)
	if err != nil {
		t.Fatalf("locate the payload: %v", err)
	}
	if found != written {
		t.Errorf("located payload = %+v, want %+v", found, written)
	}

	// The executable must survive byte-for-byte: a Windows image with its tail
	// rewritten is a machine that will not boot the installer at all.
	raw, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read assembled file: %v", err)
	}
	if head := raw[:4096]; !bytes.Equal(head, bytes.Repeat([]byte("M"), 4096)) {
		t.Error("the setup executable was modified while assembling")
	}
	if tail := raw[found.Offset : found.Offset+found.Size]; !bytes.Equal(tail, []byte("PK\x03\x04 runtime bytes")) {
		t.Errorf("payload bytes = %q, want the archive verbatim", tail)
	}
}

func TestLocateTellsAnUnassembledBinaryFromACorruptOne(t *testing.T) {
	directory := t.TempDir()

	// A setup.exe built straight from go build has no trailer. That is a build
	// mistake and the message has to name the build script.
	bare := filepath.Join(directory, "bare.exe")
	if err := os.WriteFile(bare, bytes.Repeat([]byte("MZ"), 500), 0o640); err != nil {
		t.Fatalf("write bare file: %v", err)
	}
	file, err := os.Open(bare)
	if err != nil {
		t.Fatalf("open bare file: %v", err)
	}
	defer file.Close()
	if _, err := Locate(file); !errors.Is(err, ErrNoPayload) {
		t.Errorf("Locate on a payload-less file = %v, want ErrNoPayload", err)
	}

	assembled := filepath.Join(directory, "Setup.exe")
	if _, err := WriteBundle(bare, writeArchive(t, directory, []byte("PK\x03\x04payload")), assembled); err != nil {
		t.Fatalf("assemble bundle: %v", err)
	}

	// Losing the tail also loses the trailer, so the only honest answer is that
	// there is no payload — and that message has to name the download as well as
	// the build, because a truncated fetch is what an operator actually hit.
	truncated := filepath.Join(directory, "truncated.exe")
	raw, err := os.ReadFile(assembled)
	if err != nil {
		t.Fatalf("read assembled file: %v", err)
	}
	if err := os.WriteFile(truncated, raw[:len(raw)-3], 0o640); err != nil {
		t.Fatalf("write truncated file: %v", err)
	}
	corrupt, err := os.Open(truncated)
	if err != nil {
		t.Fatalf("open truncated file: %v", err)
	}
	defer corrupt.Close()
	_, err = Locate(corrupt)
	if !errors.Is(err, ErrNoPayload) {
		t.Errorf("Locate on a truncated file = %v, want ErrNoPayload", err)
	}
	if err != nil && !strings.Contains(err.Error(), "downloading") {
		t.Errorf("the message does not mention an incomplete download: %v", err)
	}

	// Editing a trailer field must fail the checksum rather than be trusted.
	edited := filepath.Join(directory, "edited.exe")
	editedBytes := append([]byte(nil), raw...)
	editedBytes[len(editedBytes)-TrailerSize+12]++ // payload size, low byte
	if err := os.WriteFile(edited, editedBytes, 0o640); err != nil {
		t.Fatalf("write edited file: %v", err)
	}
	editedFile, err := os.Open(edited)
	if err != nil {
		t.Fatalf("open edited file: %v", err)
	}
	defer editedFile.Close()
	if _, err := Locate(editedFile); err == nil || errors.Is(err, ErrNoPayload) {
		t.Errorf("Locate on an edited trailer = %v, want a checksum error", err)
	}
}

func TestWriteBundleRefusesToOverwriteItsOwnInputs(t *testing.T) {
	directory := t.TempDir()
	exe := writeExe(t, directory, 4096)
	archive := writeArchive(t, directory, []byte("PK\x03\x04 runtime bytes"))

	// Windows resolves "setup.exe" and "SETUP.EXE" to one file, so a build that
	// names its input as its output would truncate the very executable it is
	// about to copy and still leave a file with a trailer on it.
	if _, err := WriteBundle(exe, archive, filepath.Join(directory, "SETUP.EXE")); err == nil {
		t.Fatal("assembling over the setup executable was accepted")
	}
	raw, err := os.ReadFile(exe)
	if err != nil {
		t.Fatalf("re-read the setup executable: %v", err)
	}
	if len(raw) != 4096 {
		t.Errorf("the refused assemble left the source at %d bytes, want it untouched", len(raw))
	}
	if _, err := WriteBundle(exe, archive, archive); err == nil {
		t.Error("assembling over the runtime archive was accepted")
	}
}

func TestWriteUninstallerCopiesTheImageAndNoRuntime(t *testing.T) {
	directory := t.TempDir()
	exe := writeExe(t, directory, 4096)
	archive := writeArchive(t, directory, []byte("PK\x03\x04 runtime bytes"))
	assembled := filepath.Join(directory, "HooshiX-MCP-Setup.exe")
	payload, err := WriteBundle(exe, archive, assembled)
	if err != nil {
		t.Fatalf("assemble bundle: %v", err)
	}

	head := filepath.Join(directory, "uninstall.exe")
	if err := WriteUninstaller(assembled, head, payload.Offset); err != nil {
		t.Fatalf("write the uninstaller: %v", err)
	}
	raw, err := os.ReadFile(head)
	if err != nil {
		t.Fatalf("read the uninstaller: %v", err)
	}
	if !bytes.Equal(raw, bytes.Repeat([]byte("M"), 4096)) {
		t.Errorf("the uninstaller holds %d bytes, want the setup image alone", len(raw))
	}

	// The entry in Programs runs a program that cannot install. Nothing of the
	// runtime travels in it, so a stray double-click on uninstall.exe says there
	// is no payload instead of unpacking a second copy of node.
	file, err := os.Open(head)
	if err != nil {
		t.Fatalf("open the uninstaller: %v", err)
	}
	defer file.Close()
	if _, err := Locate(file); !errors.Is(err, ErrNoPayload) {
		t.Errorf("the payload-less uninstaller located as an installer: %v", err)
	}

	// A source shorter than its own trailer claims must not yield a truncated
	// image, which Windows reports as a corrupt executable rather than a mistake.
	if err := WriteUninstaller(exe, filepath.Join(directory, "short.exe"), payload.Offset+1024); err == nil {
		t.Error("an executable shorter than the recorded size was accepted")
	}
}

func TestParseTrailerRefusesAFutureFormat(t *testing.T) {
	raw := Payload{Offset: 100, Size: 50, Version: payloadVersion + 1}.marshal()
	if _, err := parseTrailer(raw, 200); err == nil {
		t.Fatal("a newer payload format was accepted by an older reader")
	}

	// A reserved field that is not zero means the file was written by something
	// that knows something this reader does not.
	raw = Payload{Offset: 100, Size: 50, Version: payloadVersion}.marshal()
	raw[24] = 1
	if _, err := parseTrailer(raw, 200); err == nil {
		t.Fatal("unexpected reserved bits were ignored")
	}

	// The archive cannot start inside the executable or before the file begins.
	if _, err := parseTrailer(Payload{Size: 10_000, Version: payloadVersion}.marshal(), 512); err == nil {
		t.Fatal("a payload larger than the file was accepted")
	}
}
