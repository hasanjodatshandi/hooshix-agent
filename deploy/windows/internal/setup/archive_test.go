package setup

import (
	"archive/zip"
	"bytes"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackAndExtractRoundTripsATree(t *testing.T) {
	source := t.TempDir()
	files := map[string]string{
		"app/package.json":              `{"type":"module"}`,
		"app/dist/index-http.js":        "console.log('serving');\n",
		"app/node_modules/zod/index.js": "export const z = {};\n",
		"runtime/node.exe":              "MZ fake runtime",
		"bin/hooshix-mcp-service.exe":   "MZ fake service",
	}
	for name, content := range files {
		where := filepath.Join(source, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(where), 0o750); err != nil {
			t.Fatalf("create %s: %v", filepath.Dir(where), err)
		}
		if err := os.WriteFile(where, []byte(content), 0o640); err != nil {
			t.Fatalf("write %s: %v", where, err)
		}
	}
	archivePath := filepath.Join(t.TempDir(), "runtime.zip")

	stats, err := PackArchive(source, archivePath)
	if err != nil {
		t.Fatalf("pack the tree: %v", err)
	}
	if stats.Files != len(files) {
		t.Errorf("packed %d files, want %d", stats.Files, len(files))
	}
	if stats.ArchiveSize == 0 {
		t.Error("the archive measures zero bytes")
	}

	target := t.TempDir()
	file, err := os.Open(archivePath)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer file.Close()
	size, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		t.Fatalf("measure archive: %v", err)
	}
	var written, total int64
	extracted, err := ExtractArchive(file, Payload{Offset: 0, Size: size}, target, func(done, bytesTotal int64) {
		written, total = done, bytesTotal
	})
	if err != nil {
		t.Fatalf("extract the archive: %v", err)
	}
	if extracted != len(files) {
		t.Errorf("extracted %d files, want %d", extracted, len(files))
	}
	if written != total || total == 0 {
		t.Errorf("progress reported %d of %d bytes", written, total)
	}
	for name, content := range files {
		raw, err := os.ReadFile(filepath.Join(target, filepath.FromSlash(name)))
		if err != nil {
			t.Fatalf("read extracted %s: %v", name, err)
		}
		if string(raw) != content {
			t.Errorf("%s extracted as %q, want %q", name, raw, content)
		}
	}
}

func TestPackArchiveWalksEntriesInOrder(t *testing.T) {
	// filepath.WalkDir is lexical, and the build script's digest is only
	// reproducible if the archive is written in that order.
	source := t.TempDir()
	for _, name := range []string{"z.txt", "a.txt", "m/b.txt"} {
		where := filepath.Join(source, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(where), 0o750); err != nil {
			t.Fatalf("create directory: %v", err)
		}
		if err := os.WriteFile(where, []byte(name), 0o640); err != nil {
			t.Fatalf("write %s: %v", where, err)
		}
	}
	archivePath := filepath.Join(t.TempDir(), "runtime.zip")
	if _, err := PackArchive(source, archivePath); err != nil {
		t.Fatalf("pack the tree: %v", err)
	}
	raw, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatalf("read the archive: %v", err)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("open the archive: %v", err)
	}
	got := []string{}
	for _, file := range reader.File {
		got = append(got, file.Name)
	}
	want := []string{"a.txt", "m/b.txt", "z.txt"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("entries came out as %v, want lexical %v", got, want)
	}
}

func TestResolveEntryRefusesAnyPathOutsideTheInstall(t *testing.T) {
	target := string(filepath.Separator) + "install"
	for _, name := range []string{
		"../windows/system32/cmd.exe",
		"app/../../escape.txt",
		"/etc/passwd",
		"C:\\Windows\\Tasks\\evil.js",
		"\\\\server\\share\\evil.js",
		"..",
		"/",
		"",
	} {
		if _, err := resolveEntry(target, name); err == nil {
			t.Errorf("archive entry %q was accepted", name)
		}
	}
	// The ordinary shapes a real payload uses must pass.
	for _, name := range []string{"app/dist/index-http.js", "runtime/node.exe", "app/node_modules/@a/b/c.js"} {
		where, err := resolveEntry(target, name)
		if err != nil {
			t.Errorf("archive entry %q was refused: %v", name, err)
			continue
		}
		if !strings.HasPrefix(where, target+string(filepath.Separator)) {
			t.Errorf("archive entry %q resolved outside the install directory: %s", name, where)
		}
	}
}

func TestExtractRefusesASymbolicLinkEntry(t *testing.T) {
	// A symlink inside the install tree is a write primitive: the payload has no
	// use for one, and following it while elevated can touch any file on disk.
	directory := t.TempDir()
	archivePath := filepath.Join(directory, "evil.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	writer := zip.NewWriter(file)
	header := &zip.FileHeader{Name: "app/escape", Method: zip.Store}
	header.SetMode(fs.ModeSymlink | 0o777)
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatalf("add symlink entry: %v", err)
	}
	if _, err := entry.Write([]byte(`..\..\somewhere`)); err != nil {
		t.Fatalf("write symlink target: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close archive file: %v", err)
	}

	opened, err := os.Open(archivePath)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer opened.Close()
	size, err := opened.Seek(0, io.SeekEnd)
	if err != nil {
		t.Fatalf("measure archive: %v", err)
	}
	if _, err := ExtractArchive(opened, Payload{Offset: 0, Size: size}, filepath.Join(directory, "out"), nil); err == nil {
		t.Fatal("a symbolic link entry was extracted without complaint")
	} else if !strings.Contains(err.Error(), "symbolic link") {
		t.Errorf("refused for the wrong reason: %v", err)
	}
}

func TestPackArchiveFailsLoudlyOnAnEmptyTree(t *testing.T) {
	// An empty payload would assemble into a Setup.exe that "installs" nothing,
	// which is exactly the silent failure the appended-payload design exists to
	// avoid, so it has to be caught at build time.
	archivePath := filepath.Join(t.TempDir(), "runtime.zip")
	if _, err := PackArchive(t.TempDir(), archivePath); err == nil {
		t.Fatal("an empty tree was packed without error")
	}
}
