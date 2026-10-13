package host

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// RotatingLog is a size-bounded append writer, mirrored from the Edge Agent's
// agent.log so a service that crash-loops cannot fill the system volume.
// Rotation is a size bound, not a retention policy.
type RotatingLog struct {
	mu       sync.Mutex
	path     string
	maxBytes int64
	maxFiles int
	file     *os.File
	written  int64
}

// NewRotatingLog opens the active file. A failure to open is not fatal: the
// writer keeps the path and retries on the next write, so a directory that is
// locked by a scanner or mid-rename during an upgrade resumes logging rather
// than swallowing every diagnostic for the life of the service.
func NewRotatingLog(path string, maxBytes int64, maxFiles int) *RotatingLog {
	writer := &RotatingLog{path: path, maxBytes: maxBytes, maxFiles: maxFiles}
	_ = writer.open()
	return writer
}

func (r *RotatingLog) open() error {
	if r.file != nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o750); err != nil {
		return err
	}
	file, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
	if err != nil {
		return err
	}
	r.file = file
	info, err := file.Stat()
	if err != nil {
		r.written = 0
		return nil
	}
	r.written = info.Size()
	return nil
}

func (r *RotatingLog) rotate() error {
	if r.file != nil {
		_ = r.file.Close()
		r.file = nil
	}
	// Shift the retained history one slot backwards before renaming the active
	// file in, and drop only the oldest slot: .1 is the newest history.
	for index := r.maxFiles - 1; index >= 1; index-- {
		source := fmt.Sprintf("%s.%d", r.path, index)
		if _, err := os.Stat(source); err != nil {
			continue
		}
		target := fmt.Sprintf("%s.%d", r.path, index+1)
		if index == r.maxFiles-1 {
			_ = os.Remove(target)
		}
		_ = os.Rename(source, target)
	}
	if err := os.Rename(r.path, r.path+".1"); err != nil {
		// Keep the diagnostics flowing into whatever file can be opened.
		_ = r.open()
		return err
	}
	return r.open()
}

func (r *RotatingLog) Write(payload []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.open(); err != nil {
		return 0, fmt.Errorf("service log unavailable: %w", err)
	}
	if r.written+int64(len(payload)) > r.maxBytes {
		if err := r.rotate(); err != nil {
			if r.file == nil {
				return 0, fmt.Errorf("service log unavailable: %w", err)
			}
		}
	}
	written, err := r.file.Write(payload)
	r.written += int64(written)
	return written, err
}

func (r *RotatingLog) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file == nil {
		return nil
	}
	file := r.file
	r.file = nil
	return file.Close()
}
