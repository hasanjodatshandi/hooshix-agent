// Package setup builds and consumes the one-file HooshiX MCP installer.
//
// The installer is a normal Windows executable with a ZIP payload appended to
// it, so the deliverable is a single file the operator double-clicks. The
// payload is not embedded with go:embed on purpose: a committed placeholder
// would make `go build ./...` succeed while shipping an installer that installs
// nothing, and a real 100 MB runtime would put the runtime in git. Here the
// absence of a payload is a fact the binary can state out loud.
package setup

import (
	"debug/pe"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
)

// ErrNoPayload means the trailer is not there. Two very different mistakes
// produce that, and from the file's own bytes they cannot be told apart: an
// installer built without a runtime, and a download that lost its tail. The
// message gives both answers because the right action differs.
var ErrNoPayload = errors.New("setup.exe carries no runtime payload: it was either built without one (run scripts/build-windows-installer.mjs) or it did not finish downloading (get setup.exe again)")

const (
	// trailerMagic identifies the appended bundle. Eight bytes make an
	// accidental match inside some unrelated executable's tail impossible.
	trailerMagic = "HXSETUP1"

	// TrailerSize is the fixed record that separates the setup executable from
	// the archive.
	TrailerSize = 32

	// payloadVersion is the format this package writes. A future change bumps
	// it, and an older reader refuses the newer number instead of mis-reading
	// offsets.
	payloadVersion = 1
)

// Payload locates and fingerprints the archive appended to a file.
type Payload struct {
	// Offset is where the ZIP starts, one past the setup executable's own last
	// byte. The trailer sits after the archive, not between the two.
	Offset int64
	// Size is the archive's byte length.
	Size int64
	// Version is the trailer format the file was written with.
	Version uint32
	// Checksum is the CRC32 of the archive bytes, as recorded when written.
	Checksum uint32
}

// WriteBundle copies the setup executable and the packed runtime archive into
// out as [exe][zip][trailer].
//
// The trailer is the last 32 bytes of the file, so a reader needs one seek to
// the end to find out whether this is an installer at all. The archive is
// reached through a section reader bounded to its own bytes, which is what lets
// the trailer sit after it: archive/zip finds the end-of-central-directory
// record by walking back from the end of the reader it is given, and inside that
// section the ZIP is the whole file.
func WriteBundle(setupPath, archivePath, outPath string) (Payload, error) {
	exe, err := os.Open(setupPath)
	if err != nil {
		return Payload{}, fmt.Errorf("open setup executable: %w", err)
	}
	defer exe.Close()
	archive, err := os.Open(archivePath)
	if err != nil {
		return Payload{}, fmt.Errorf("open runtime archive: %w", err)
	}
	defer archive.Close()

	exeSize, err := measure(exe)
	if err != nil {
		return Payload{}, fmt.Errorf("measure setup executable: %w", err)
	}
	archiveSize, err := measure(archive)
	if err != nil {
		return Payload{}, fmt.Errorf("measure runtime archive: %w", err)
	}
	if archiveSize == 0 {
		return Payload{}, fmt.Errorf("runtime archive %s is empty", archivePath)
	}

	// Assembling over one of its own inputs is not a mistake Windows reports: the
	// output is opened with O_TRUNC, which empties the file the source handle is
	// still reading, and the result is a valid-looking installer carrying no
	// executable. Case-insensitive and aliased paths both land here.
	if existing, statErr := os.Stat(outPath); statErr == nil {
		for _, input := range []struct {
			kind string
			file *os.File
		}{
			{"setup executable", exe},
			{"runtime archive", archive},
		} {
			info, err := input.file.Stat()
			if err != nil {
				return Payload{}, fmt.Errorf("stat %s: %w", input.kind, err)
			}
			if os.SameFile(info, existing) {
				return Payload{}, fmt.Errorf("refusing to write %s over the %s it reads", outPath, input.kind)
			}
		}
	}

	checksum, err := crc32Of(archive)
	if err != nil {
		return Payload{}, err
	}

	target, err := os.OpenFile(outPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return Payload{}, fmt.Errorf("create %s: %w", outPath, err)
	}
	defer target.Close()

	if _, err := io.Copy(target, exe); err != nil {
		return Payload{}, fmt.Errorf("write setup executable: %w", err)
	}
	// The checksum pass left the archive at its end, and a copy from there would
	// write an empty payload into an installer that looks assembled.
	if _, err := archive.Seek(0, io.SeekStart); err != nil {
		return Payload{}, fmt.Errorf("rewind runtime archive: %w", err)
	}
	if _, err := io.Copy(target, archive); err != nil {
		return Payload{}, fmt.Errorf("write runtime archive: %w", err)
	}
	payload := Payload{Offset: exeSize, Size: archiveSize, Version: payloadVersion, Checksum: checksum}
	if _, err := target.Write(payload.marshal()); err != nil {
		return Payload{}, fmt.Errorf("write payload trailer: %w", err)
	}
	if err := target.Close(); err != nil {
		return Payload{}, fmt.Errorf("close %s: %w", outPath, err)
	}
	return payload, nil
}

// WriteUninstaller copies the first exeSize bytes of the setup executable into
// outPath and nothing else, which is how the Add/Remove Programs entry gets a
// small program to run. The archive and the trailer stay in setup.exe, so the
// uninstaller carries no runtime and Locate reports ErrNoPayload for it.
func WriteUninstaller(setupPath, outPath string, exeSize int64) error {
	source, err := os.Open(setupPath)
	if err != nil {
		return fmt.Errorf("open setup executable: %w", err)
	}
	defer source.Close()
	target, err := os.OpenFile(outPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return fmt.Errorf("create %s: %w", outPath, err)
	}
	defer target.Close()

	written, err := io.CopyN(target, source, exeSize)
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("write uninstaller from %s: %w", setupPath, err)
	}
	if written != exeSize {
		return fmt.Errorf("%s holds %d bytes but its trailer records an executable of %d", setupPath, written, exeSize)
	}
	if err := target.Close(); err != nil {
		return fmt.Errorf("close %s: %w", outPath, err)
	}
	return nil
}

// Locate reads and verifies the trailer of an assembled file. The checksum is
// recomputed over the recorded archive bytes, so an installer whose payload was
// edited or truncated fails here rather than halfway through an elevated
// install. A file with no trailer at all returns ErrNoPayload.
func Locate(file *os.File) (Payload, error) {
	size, err := measure(file)
	if err != nil {
		return Payload{}, fmt.Errorf("measure %s: %w", file.Name(), err)
	}
	if size < TrailerSize {
		return Payload{}, ErrNoPayload
	}
	// Signed PE images place WIN_CERTIFICATE after the runtime payload trailer.
	trailerEnd, err := trailerEndBeforeAuthenticode(file, size)
	if err != nil {
		return Payload{}, err
	}
	if trailerEnd < TrailerSize {
		return Payload{}, ErrNoPayload
	}
	raw := make([]byte, TrailerSize)
	if _, err := file.ReadAt(raw, trailerEnd-TrailerSize); err != nil {
		return Payload{}, fmt.Errorf("read payload trailer: %w", err)
	}
	payload, err := parseTrailer(raw, trailerEnd)
	if err != nil {
		return Payload{}, err
	}
	// The recorded length alone cannot prove the archive survived, and the
	// checksum needs every byte, so the tail is hashed once, while installing.
	hash, err := crc32OfSection(file, payload.Offset, payload.Size)
	if err != nil {
		return Payload{}, err
	}
	if hash != payload.Checksum {
		return Payload{}, fmt.Errorf(
			"runtime archive is corrupt: trailer recorded 0x%08x, file holds 0x%08x (re-download setup.exe)",
			payload.Checksum, hash)
	}
	return payload, nil
}

// trailerEndBeforeAuthenticode interprets PE IMAGE_DIRECTORY_ENTRY_SECURITY.
// Unlike other PE directories, VirtualAddress is a file offset, not an RVA.
// Only a certificate table that occupies the exact file tail is accepted.
// This prevents attacker-added trailing bytes from hiding a corrupt payload.
func trailerEndBeforeAuthenticode(file *os.File, size int64) (int64, error) {
	image, err := pe.NewFile(file)
	if err != nil {
		// The package tests use synthetic non-PE stand-ins and ordinary
		// unsigned files still carry a trailer at physical EOF.
		return size, nil
	}
	defer image.Close()
	const securityDirectory = 4
	var directory pe.DataDirectory
	switch header := image.OptionalHeader.(type) {
	case *pe.OptionalHeader32:
		directory = header.DataDirectory[securityDirectory]
	case *pe.OptionalHeader64:
		directory = header.DataDirectory[securityDirectory]
	default:
		return 0, fmt.Errorf("unrecognized PE optional header")
	}
	if directory.Size == 0 && directory.VirtualAddress == 0 {
		return size, nil
	}
	if directory.Size == 0 || directory.VirtualAddress == 0 {
		return 0, fmt.Errorf("malformed Authenticode security directory")
	}
	end := int64(directory.VirtualAddress)
	length := int64(directory.Size)
	if end < TrailerSize || end > size || length > size-end || end+length != size {
		return 0, fmt.Errorf("invalid Authenticode certificate offset/length")
	}
	return signedTrailerEnd(file, end)
}

// signedTrailerEnd is independently testable without a signing key. The
// WIN_CERTIFICATE begins at certStart; all bytes between the HooshiX trailer
// and the certificate must be zero alignment padding, never arbitrary data.
func signedTrailerEnd(file io.ReaderAt, end int64) (int64, error) {
	// Authenticode aligns WIN_CERTIFICATE on an eight-byte file boundary.
	// A signed installer can have up to seven zero padding bytes after the
	// HooshiX trailer. Reject anything other than bounded zero alignment.
	for pad := int64(0); pad <= 7 && end-pad >= TrailerSize; pad++ {
		if pad > 0 {
			var zero [1]byte
			if _, err := file.ReadAt(zero[:], end-pad); err != nil {
				return 0, fmt.Errorf("read Authenticode padding: %w", err)
			}
			if zero[0] != 0 {
				return 0, fmt.Errorf("nonzero Authenticode alignment padding")
			}
		}
		var marker [8]byte
		if _, err := file.ReadAt(marker[:], end-pad-TrailerSize); err != nil {
			return 0, fmt.Errorf("read installer trailer marker: %w", err)
		}
		if string(marker[:]) == trailerMagic {
			return end - pad, nil
		}
	}
	return 0, fmt.Errorf("signed installer trailer missing immediately before Authenticode certificate")
}

// parseTrailer validates the fixed record against the file length.
func parseTrailer(raw []byte, fileSize int64) (Payload, error) {
	if string(raw[0:8]) != trailerMagic {
		return Payload{}, ErrNoPayload
	}
	payload := Payload{
		Version:  binary.LittleEndian.Uint32(raw[8:12]),
		Size:     int64(binary.LittleEndian.Uint64(raw[12:20])),
		Checksum: binary.LittleEndian.Uint32(raw[20:24]),
	}
	if payload.Version != payloadVersion {
		return Payload{}, fmt.Errorf("unsupported payload format version %d (this setup.exe needs a newer installer)", payload.Version)
	}
	if binary.LittleEndian.Uint64(raw[24:32]) != 0 {
		return Payload{}, fmt.Errorf("payload trailer has unexpected reserved bits")
	}
	if payload.Size <= 0 {
		return Payload{}, fmt.Errorf("payload trailer records an empty archive")
	}
	payload.Offset = fileSize - TrailerSize - payload.Size
	if payload.Offset <= 0 {
		return Payload{}, fmt.Errorf("payload trailer does not fit this file")
	}
	return payload, nil
}

// marshal renders the 32-byte trailer.
func (payload Payload) marshal() []byte {
	raw := make([]byte, TrailerSize)
	copy(raw, trailerMagic)
	binary.LittleEndian.PutUint32(raw[8:12], payload.Version)
	binary.LittleEndian.PutUint64(raw[12:20], uint64(payload.Size))
	binary.LittleEndian.PutUint32(raw[20:24], payload.Checksum)
	binary.LittleEndian.PutUint64(raw[24:32], 0)
	return raw
}

// measure reports a file's length and leaves it positioned at the start, so the
// caller can copy it without a second seek.
func measure(file *os.File) (int64, error) {
	size, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return 0, err
	}
	return size, nil
}

// HumanBytes renders a size the way an install console says it. The number an
// operator reads is whether the payload is tens of megabytes or a truncated
// few, not an exact byte count.
func HumanBytes(size int64) string {
	value, unit := float64(size), "B"
	if value >= 1<<10 {
		value, unit = value/(1<<10), "KB"
	}
	if value >= 1<<10 {
		value, unit = value/(1<<10), "MB"
	}
	if value >= 1<<10 {
		value, unit = value/(1<<10), "GB"
	}
	return fmt.Sprintf("%.1f %s", value, unit)
}

func crc32Of(reader io.Reader) (uint32, error) {
	hash := crc32.NewIEEE()
	if _, err := io.Copy(hash, reader); err != nil {
		return 0, fmt.Errorf("checksum runtime archive: %w", err)
	}
	return hash.Sum32(), nil
}

func crc32OfSection(file *os.File, offset, size int64) (uint32, error) {
	hash := crc32.NewIEEE()
	if _, err := io.Copy(hash, io.NewSectionReader(file, offset, size)); err != nil {
		return 0, fmt.Errorf("read runtime archive from %s: %w", file.Name(), err)
	}
	return hash.Sum32(), nil
}
