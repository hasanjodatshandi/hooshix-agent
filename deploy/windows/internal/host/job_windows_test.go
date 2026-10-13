//go:build windows

package host

import (
	"net"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"
)

// TestJobObjectKillsItsMemberWhenClosed proves the guarantee the supervisor
// relies on: a service host that dies without running its stop path — killed
// from Task Manager, or crashed — cannot leave a Node server holding the
// configured port, because the kernel closes the members with the job.
func TestJobObjectKillsItsMemberWhenClosed(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}
	port := freePort(t)
	command := exec.Command(executable)
	environment := os.Environ()
	for key, value := range servingEnvironment(port, nil) {
		environment = append(environment, key+"="+value)
	}
	command.Env = environment
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := command.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}

	job, err := createKillOnCloseJob()
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := job.assign(command.Process.Pid); err != nil {
		job.close()
		t.Fatalf("assign child: %v", err)
	}

	// Bound before the kill, so a test that passes because the child never
	// started could not look like the guard working.
	if !waitForPortHeld(port, 10*time.Second) {
		job.close()
		t.Fatalf("child never bound port %s", port)
	}

	job.close()
	stopped := make(chan error, 1)
	go func() { stopped <- command.Wait() }()
	select {
	case <-stopped:
	case <-time.After(10 * time.Second):
		t.Fatalf("closing the job did not terminate the child")
	}
	assertPortFree(t, port)
}

func waitForPortHeld(port string, budget time.Duration) bool {
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		listener, err := net.Listen("tcp", "127.0.0.1:"+port)
		if err != nil {
			return true
		}
		_ = listener.Close()
		time.Sleep(50 * time.Millisecond)
	}
	return false
}
