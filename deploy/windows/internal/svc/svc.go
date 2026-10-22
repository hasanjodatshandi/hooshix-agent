//go:build windows

package svc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	mgr "golang.org/x/sys/windows/svc/mgr"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
)

// Per-operation access rights. mgr.OpenService asks for SERVICE_ALL_ACCESS,
// which the install-time DACL deliberately withholds from interactive users;
// a non-elevated tray would then get ERROR_ACCESS_DENIED on every call and
// could only ever display "status unavailable".
const (
	serviceQueryAccess = windows.SERVICE_QUERY_STATUS
	serviceStartAccess = windows.SERVICE_START
	serviceStopAccess  = windows.SERVICE_STOP
)

// IsWindowsService reports whether this process was started by the SCM.
func IsWindowsService() bool {
	inService, err := svc.IsWindowsService()
	return err == nil && inService
}

// runner implements svc.Handler and bridges the SCM to the supervisor.
type runner struct {
	settingsPath string
}

func (r *runner) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const accepts = svc.AcceptStop | svc.AcceptShutdown
	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	settings, loadErr := host.LoadSettings(r.settingsPath)
	if loadErr != nil {
		// Initialization failed: exit nonzero so the restart-on-failure policy
		// acts instead of leaving a service that reports Running with no server.
		close(done)
		return false, 1
	}
	supervisor := host.New(settings)

	var exitCode uint32
	go func() {
		defer close(done)
		defer supervisor.Close()
		if runErr := supervisor.Run(ctx); runErr != nil {
			exitCode = 1
		}
	}()

	status <- svc.Status{State: svc.Running, Accepts: accepts}
	for {
		select {
		case request, ok := <-requests:
			if !ok {
				cancel()
				<-done
				// Operator-initiated stop or a closed request channel is
				// SUCCESS. A nonzero code here is handed to the failure policy,
				// which would restart the service seconds later and the tray's
				// "Stop" could never actually stop it.
				return false, 0
			}
			switch request.Cmd {
			case svc.Interrogate:
				status <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, exitCode
			}
		case <-done:
			// The supervisor terminated on its own: a genuine failure, so SCM
			// recovery acts rather than showing a hollow Running state.
			return false, 1
		}
	}
}

// RunService is the entry point for `service run-service`, and is also reused
// by `go run` during development to run the supervisor in a console.
func RunService(settingsPath string) error {
	if settingsPath == "" {
		defaultPath, err := host.DefaultSettingsPath()
		if err != nil {
			return err
		}
		settingsPath = defaultPath
	}
	if IsWindowsService() {
		return svc.Run(ServiceName, &runner{settingsPath: settingsPath})
	}
	settings, err := host.LoadSettings(settingsPath)
	if err != nil {
		return err
	}
	supervisor := host.New(settings)
	defer supervisor.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	go func() {
		<-signals
		cancel()
	}()
	return supervisor.Run(ctx)
}

// Install registers the service, configures auto-start, recovery and the
// limited interactive-user rights the tray needs. It is idempotent: an existing
// registration is stopped and recreated from the current binary.
func Install(execPath string) error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect service manager: %w", err)
	}
	defer manager.Disconnect()

	openRegistered := func() error {
		service, err := manager.OpenService(ServiceName)
		if err != nil {
			return err
		}
		service.Close()
		return nil
	}

	if existing, openErr := manager.OpenService(ServiceName); openErr == nil {
		if status, queryErr := existing.Query(); queryErr == nil && status.State != svc.Stopped {
			_, _ = existing.Control(svc.Stop)
			waitStopped(existing, 30*time.Second)
		}
		if deleteErr := existing.Delete(); deleteErr != nil {
			existing.Close()
			return fmt.Errorf("replace existing service: delete: %w", deleteErr)
		}
		existing.Close()
		// SCM drops the record only after the last handle closes, and the
		// process holding one is the service itself: an in-place upgrade races
		// its exit. Creating the replacement too early is refused with
		// ERROR_SERVICE_MARKED_FOR_DELETE.
		if err := awaitRemoved(openRegistered); err != nil {
			return fmt.Errorf("replace existing service: %w", err)
		}
	}

	service, err := manager.CreateService(ServiceName, execPath, mgr.Config{
		StartType:        mgr.StartAutomatic,
		DisplayName:      displayName,
		Description:      description,
		Dependencies:     []string{"Tcpip", "Dnscache"},
		DelayedAutoStart: false,
	}, "service", "run-service")
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer service.Close()

	if err := applyRecoveryPolicy(service.Handle); err != nil {
		return fmt.Errorf("configure recovery: %w", err)
	}
	if err := grantUserStartStop(service.Handle); err != nil {
		return fmt.Errorf("grant start/stop rights: %w", err)
	}
	return nil
}

// PrepareForUpgrade preserves an existing SCM registration, including its
// configured logon account, service DACL, recovery actions and dependencies.
// It refuses registrations pointing outside the packaged path BEFORE stopping
// the service. Returning false means no service was registered (fresh install).
func PrepareForUpgrade(expectedBinary string) (bool, error) {
	manager, err := mgr.Connect()
	if err != nil {
		return false, fmt.Errorf("connect service manager: %w", err)
	}
	defer manager.Disconnect()
	service, err := manager.OpenService(ServiceName)
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("open existing service: %w", err)
	}
	defer service.Close()
	config, err := service.Config()
	if err != nil {
		return false, fmt.Errorf("read existing service configuration: %w", err)
	}
	// A development or foreign registration is never safe to overwrite.
	expected := `"` + expectedBinary + `" service run-service`
	if !matchesExpectedServiceImage(config.BinaryPathName, expectedBinary) {
		return false, fmt.Errorf("existing service executable does not match the packaged runtime; upgrade refused before stop (got %q, want %q)", config.BinaryPathName, expected)
	}
	status, err := service.Query()
	if err != nil {
		return false, fmt.Errorf("query existing service: %w", err)
	}
	if status.State != svc.Stopped {
		if _, err := service.Control(svc.Stop); err != nil &&
			!errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
			return true, fmt.Errorf("stop existing service for upgrade: %w", err)
		}
		waitStopped(service, 30*time.Second)
		status, err = service.Query()
		if err != nil || status.State != svc.Stopped {
			return true, fmt.Errorf("existing service did not stop safely: %v", err)
		}
	}
	return true, nil
}

// matchesExpectedServiceImage fails closed for foreign or development SCM paths.
// No unquoted spaces, altered arguments or executable outside Program Files.
func matchesExpectedServiceImage(actual, expectedBinary string) bool {
	expected := `"` + expectedBinary + `" service run-service`
	return strings.EqualFold(strings.TrimSpace(actual), expected)
}

// Uninstall stops and removes the service. An unregistered name is a valid
// uninstall state, so a second run of the packaged uninstaller reports success
// instead of "uninstall incomplete".
func Uninstall() error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect service manager: %w", err)
	}
	defer manager.Disconnect()
	service, err := manager.OpenService(ServiceName)
	if err != nil {
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		return fmt.Errorf("open service: %w", err)
	}
	defer service.Close()

	if status, queryErr := service.Query(); queryErr == nil && status.State != svc.Stopped {
		_, _ = service.Control(svc.Stop)
		waitStopped(service, 30*time.Second)
	}
	return service.Delete()
}

// Start starts the service. Already running is success: setup starts the
// service right after install, and SCM reports ERROR_SERVICE_ALREADY_RUNNING.
func Start() error {
	err := withServiceHandle(serviceStartAccess, func(handle windows.Handle) error {
		return windows.StartService(handle, 0, nil)
	})
	if errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return nil
	}
	return err
}

// Stop asks the service to stop.
func Stop() error {
	return withServiceHandle(serviceStopAccess, func(handle windows.Handle) error {
		var status windows.SERVICE_STATUS
		return windows.ControlService(handle, uint32(svc.Stop), &status)
	})
}

// Restart stops the service, waits for it to really leave the running states,
// and starts it again. Waiting matters: a stop followed immediately by a start
// races SCM and can leave the service stopped with the tray showing green.
func Restart() error {
	if err := Stop(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
		return err
	}
	if err := waitForStopped(30 * time.Second); err != nil {
		return err
	}
	return Start()
}

// QueryStatus returns the SCM state name.
func QueryStatus() (string, error) {
	var process windows.SERVICE_STATUS_PROCESS
	err := withServiceHandle(serviceQueryAccess, func(handle windows.Handle) error {
		var needed uint32
		return windows.QueryServiceStatusEx(handle, windows.SC_STATUS_PROCESS_INFO,
			(*byte)(unsafe.Pointer(&process)), uint32(unsafe.Sizeof(process)), &needed)
	})
	if err != nil {
		return "", fmt.Errorf("query service: %w", err)
	}
	switch svc.State(process.CurrentState) {
	case svc.Stopped:
		return "stopped", nil
	case svc.StartPending:
		return "start-pending", nil
	case svc.StopPending:
		return "stop-pending", nil
	case svc.Running:
		return "running", nil
	case svc.ContinuePending:
		return "continue-pending", nil
	case svc.PausePending:
		return "pause-pending", nil
	case svc.Paused:
		return "paused", nil
	default:
		return "unknown", nil
	}
}

// ServicePid reports the child process id the SCM knows about, which the tray
// uses to confirm the listener it probes belongs to the service it controls.
func ServicePid() (int, error) {
	var process windows.SERVICE_STATUS_PROCESS
	err := withServiceHandle(serviceQueryAccess, func(handle windows.Handle) error {
		var needed uint32
		return windows.QueryServiceStatusEx(handle, windows.SC_STATUS_PROCESS_INFO,
			(*byte)(unsafe.Pointer(&process)), uint32(unsafe.Sizeof(process)), &needed)
	})
	return int(process.ProcessId), err
}

// withServiceHandle opens the service with exactly the access requested, so no
// caller needs SERVICE_ALL_ACCESS.
func withServiceHandle(access uint32, fn func(windows.Handle) error) error {
	manager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return fmt.Errorf("connect service manager: %w", err)
	}
	defer windows.CloseServiceHandle(manager)
	name, err := windows.UTF16PtrFromString(ServiceName)
	if err != nil {
		return err
	}
	service, err := windows.OpenService(manager, name, access)
	if err != nil {
		return fmt.Errorf("open service: %w", err)
	}
	defer windows.CloseServiceHandle(service)
	return fn(service)
}

// waitStopped polls an already-open handle until the service is stopped or the
// budget runs out.
func waitStopped(service *mgr.Service, budget time.Duration) {
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		status, err := service.Query()
		if err != nil || status.State == svc.Stopped {
			return
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// waitForStopped polls the SCM with a query-only handle. Polling instead of
// WaitForSingleObject is deliberate: a non-elevated caller is not granted
// SYNCHRONIZE on the service object, and the tray restarts without elevation.
func waitForStopped(budget time.Duration) error {
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		state, err := QueryStatus()
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		if err != nil {
			return err
		}
		if state == "stopped" {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("%s did not stop within %s", ServiceName, budget)
}

var (
	scmRemovalBudget = 10 * time.Second
	scmRemovalPause  = 200 * time.Millisecond
)

func serviceRemoved(err error) bool {
	return err != nil && errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST)
}

// awaitRemoved polls until SCM has really dropped the registration, reporting
// the last state it saw when the budget runs out.
func awaitRemoved(open func() error) error {
	deadline := time.Now().Add(scmRemovalBudget)
	for {
		err := open()
		if serviceRemoved(err) {
			return nil
		}
		if !time.Now().Add(scmRemovalPause).Before(deadline) {
			if err == nil {
				return fmt.Errorf("%s is still registered while being replaced — close the process holding it and run setup again", ServiceName)
			}
			return fmt.Errorf("%s is still being removed by SCM: %w — close the process holding it and run setup again", ServiceName, err)
		}
		time.Sleep(scmRemovalPause)
	}
}
