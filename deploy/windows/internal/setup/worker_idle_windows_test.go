//go:build windows

package setup

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Spawn the actual test image from the exact worker installation path. Windows
// prevents an executable image from being overwritten while the child runs.
func TestWorkerIdleRejectsActualRunningWindowsExecutable(t *testing.T) {
	source, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	layout := Layout{BinDir: filepath.Join(t.TempDir(), "bin")}
	if err := os.MkdirAll(layout.BinDir, 0o750); err != nil {
		t.Fatal(err)
	}
	src, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	dst, err := os.Create(layout.WorkerBinary())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		t.Fatal(err)
	}
	if err := dst.Close(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, layout.WorkerBinary(), "-test.run=^TestWorkerImageLockChild$")
	cmd.Env = append(os.Environ(), "HOOSHIX_LOCK_CHILD=1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stdin.Close()
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()

	ready := make(chan error, 1)
	go func() {
		line, e := bufio.NewReader(stdout).ReadString('\n')
		if e != nil {
			ready <- e
		} else if !strings.Contains(line, "WORKER_IMAGE_LOCK_READY") {
			ready <- fmt.Errorf("unexpected child readiness: %q", line)
		} else {
			ready <- nil
		}
	}()
	select {
	case e := <-ready:
		if e != nil {
			t.Fatal(e)
		}
	case <-ctx.Done():
		t.Fatal("worker-image child never reached readiness")
	}

	if err := layout.CheckWorkerIdle(); err == nil {
		t.Fatal("installer accepted a Windows worker executable that is still running")
	} else if !strings.Contains(err.Error(), "service and files were not changed") {
		t.Fatalf("wrong busy-worker diagnostic: %v", err)
	}
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := layout.CheckWorkerIdle(); err != nil {
		t.Fatalf("after worker shutdown, installer should be unblocked: %v", err)
	}
}

func TestWorkerImageLockChild(t *testing.T) {
	if os.Getenv("HOOSHIX_LOCK_CHILD") != "1" {
		return
	}
	fmt.Println("WORKER_IMAGE_LOCK_READY")
	_, _ = io.Copy(io.Discard, os.Stdin)
}
