package setup

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// maxExtractBytes bounds what unpacking the archive may write. The real payload
// is around 150 MB, so the bound is far above any legitimate install and far
// below the size a corrupted length field could ask for.
const maxExtractBytes = 4 << 30

// PackStats summarises one packed archive.
type PackStats struct {
	Files       int
	Bytes       int64 // uncompressed content of the tree
	ArchiveSize int64
}

// PackArchive writes every regular file under treeRoot into a ZIP at outPath,
// with paths stored relative to treeRoot and separators normalised to slashes.
//
// Directory entries are not stored: extraction creates the parents it needs, so
// an empty directory in the build tree cannot become an empty directory on the
// target machine. That is intended — the data root's directories are created by
// the installer, not shipped inside the archive.
func PackArchive(treeRoot, outPath string) (PackStats, error) {
	stats := PackStats{}
	target, err := os.Create(outPath)
	if err != nil {
		return stats, fmt.Errorf("create archive %s: %w", outPath, err)
	}
	defer target.Close()

	writer := zip.NewWriter(target)
	err = filepath.WalkDir(treeRoot, func(where string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			// A symlink or socket in the build tree means the tree was assembled
			// by something other than the build script, and shipping it would
			// put a dangling reference on the target machine.
			return fmt.Errorf("%s is not a regular file", where)
		}
		relative, err := filepath.Rel(treeRoot, where)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		source, err := os.Open(where)
		if err != nil {
			return fmt.Errorf("open %s: %w", where, err)
		}
		defer source.Close()
		info, err := source.Stat()
		if err != nil {
			return fmt.Errorf("stat %s: %w", where, err)
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0o640)
		writerEntry, err := writer.CreateHeader(header)
		if err != nil {
			return fmt.Errorf("add %s to archive: %w", name, err)
		}
		written, err := io.Copy(writerEntry, source)
		if err != nil {
			return fmt.Errorf("write %s into archive: %w", name, err)
		}
		if written != info.Size() {
			return fmt.Errorf("%s changed while it was being archived", where)
		}
		stats.Files++
		stats.Bytes += written
		return nil
	})
	if err != nil {
		return stats, fmt.Errorf("pack %s: %w", treeRoot, err)
	}
	if stats.Files == 0 {
		return stats, fmt.Errorf("no files found under %s", treeRoot)
	}
	if err := writer.Close(); err != nil {
		return stats, fmt.Errorf("close archive %s: %w", outPath, err)
	}
	info, err := target.Stat()
	if err != nil {
		return stats, fmt.Errorf("measure archive %s: %w", outPath, err)
	}
	stats.ArchiveSize = info.Size()
	return stats, nil
}

// Progress reports unpacked bytes as an install runs, for the setup console.
type Progress func(done, total int64)

// ExtractArchive unpacks the given section of the file into targetDir and
// reports byte progress. It returns the number of files written.
//
// Every entry name is validated before it is written, and the total written
// bytes are bounded, because the archive is read from a file the operator may
// have edited or truncated: neither a traversal nor a length field may decide
// where files land.
func ExtractArchive(file *os.File, payload Payload, targetDir string, progress Progress) (int, error) {
	reader, err := zip.NewReader(io.NewSectionReader(file, payload.Offset, payload.Size), payload.Size)
	if err != nil {
		return 0, fmt.Errorf("open runtime archive: %w", err)
	}
	total := int64(0)
	for _, entry := range reader.File {
		total += int64(entry.UncompressedSize64)
	}
	if total > maxExtractBytes {
		return 0, fmt.Errorf("runtime archive claims %.1f GB of content, which is more than any install needs", float64(total)/(1<<30))
	}

	written := int64(0)
	files := 0
	for _, entry := range reader.File {
		destination, err := resolveEntry(targetDir, entry.Name)
		if err != nil {
			return files, err
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0o750); err != nil {
				return files, fmt.Errorf("create directory %s: %w", destination, err)
			}
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			return files, fmt.Errorf("archive entry %s is a symbolic link, which the installer will not create", entry.Name)
		}
		if err := extractOne(entry, destination); err != nil {
			return files, err
		}
		written += int64(entry.UncompressedSize64)
		files++
		if progress != nil {
			progress(written, total)
		}
	}
	return files, nil
}

// extractOne writes a single archive entry, replacing whatever is there: an
// upgrade overwrites the previous install, and a half-finished previous install
// must not be able to survive as extra files.
func extractOne(entry *zip.File, destination string) error {
	source, err := entry.Open()
	if err != nil {
		return fmt.Errorf("open archive entry %s: %w", entry.Name, err)
	}
	defer source.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o750); err != nil {
		return fmt.Errorf("create directory for %s: %w", destination, err)
	}
	target, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return fmt.Errorf("create %s: %w", destination, err)
	}
	defer target.Close()
	if _, err := io.Copy(target, source); err != nil {
		return fmt.Errorf("write %s: %w", destination, err)
	}
	if err := target.Close(); err != nil {
		return fmt.Errorf("close %s: %w", destination, err)
	}
	return nil
}

// resolveEntry maps an archive name to a path inside targetDir, refusing
// anything that would escape it.
//
// This is the zip-slip guard. Archive names are slash-separated and come from
// the payload, so "../", an absolute path, a drive letter and a UNC prefix all
// have to be rejected before any file is created — the installer runs elevated,
// and writing outside the install directory as Administrator is a system-wide
// damage, not a per-user mistake.
func resolveEntry(targetDir, name string) (string, error) {
	clean := path.Clean(strings.ReplaceAll(name, "\\", "/"))
	if clean == "." || clean == "/" {
		return "", fmt.Errorf("archive entry %q has no usable name", name)
	}
	if strings.HasPrefix(clean, "/") || filepath.IsAbs(name) || len(clean) >= 2 && clean[1] == ':' {
		return "", fmt.Errorf("archive entry %q is an absolute path", name)
	}
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("archive entry %q escapes the install directory", name)
	}
	destination := filepath.Join(targetDir, filepath.FromSlash(clean))
	relative, err := filepath.Rel(targetDir, destination)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("archive entry %q escapes the install directory", name)
	}
	return destination, nil
}
