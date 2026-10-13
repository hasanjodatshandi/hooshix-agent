//go:build windows

package host

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// jobObject is the Windows construct that makes the child's lifetime the
// supervisor's. Killing the service host from Task Manager, or an abrupt
// process exit, would otherwise leave a Node server holding the configured
// port unsupervised — and the next service start then refuses to bind over it.
type jobObject struct {
	handle windows.Handle
}

// createKillOnCloseJob opens an unnamed job that terminates every member when
// its last handle closes. Closing that handle is therefore the kill switch, and
// the supervisor keeps it open for exactly as long as it means to own children.
func createKillOnCloseJob() (*jobObject, error) {
	handle, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("create job object: %w", err)
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(handle, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(handle)
		return nil, fmt.Errorf("configure job object: %w", err)
	}
	return &jobObject{handle: handle}, nil
}

// assign puts a spawned child under the job. Assignment is attempted right
// after Start and before the child can bind anything, so a crash in between
// still leaves no orphan behind.
//
// The handle is opened by pid instead of reusing the one exec.Command already
// holds: os.Process keeps it unexported, and AssignProcessToJobObject needs
// exactly PROCESS_SET_QUOTA|PROCESS_TERMINATE — rights that a handle opened for
// waiting does not necessarily carry. It is closed immediately, because the job
// — not this handle — is what keeps the child alive.
func (job *jobObject) assign(pid int) error {
	if job == nil {
		return nil
	}
	handle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return fmt.Errorf("open server process %d: %w", pid, err)
	}
	defer windows.CloseHandle(handle)
	if err := windows.AssignProcessToJobObject(job.handle, handle); err != nil {
		return fmt.Errorf("assign server process %d to job object: %w", pid, err)
	}
	return nil
}

func (job *jobObject) close() {
	if job != nil {
		_ = windows.CloseHandle(job.handle)
	}
}
