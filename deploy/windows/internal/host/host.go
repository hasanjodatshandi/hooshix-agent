package host

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// restartDelays backs off between respawns. A crash loop costs one probe per
// step rather than a busy restart, and the last entry is the floor.
var restartDelays = []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 10 * time.Second, 30 * time.Second}

// stableRunIsLongEnough is how long a child must stay up before the backoff
// ramp resets: a daily crash and a crash loop are different failures and
// should not share a restart schedule.
const stableRunIsLongEnough = time.Minute

// stopWaitBudget bounds how long the service waits for its terminated child to
// be reaped. SCM's stop timeout is far longer, but a stopped service that
// never reports exit is worse than one that gives up on a wedged child.
const stopWaitBudget = 10 * time.Second

// Supervisor owns one server child process and the published status document.
type Supervisor struct {
	settings *Settings
	log      *RotatingLog
	logger   *slog.Logger
	job      *jobObject

	mu         sync.Mutex
	phase      string
	state      string
	pid        int
	restarts   int
	lastExit   int
	lastError  string
	httpClient *http.Client
}

// New prepares the service log and supervisor state. The data root holds
// status.json, service.log and the server's own logs, so an operator has one
// machine-wide location to open.
func New(settings *Settings) *Supervisor {
	writer := NewRotatingLog(filepath.Join(settings.DataRoot, "service.log"), 5*1024*1024, 2)
	logger := slog.New(slog.NewTextHandler(writer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	return &Supervisor{
		settings:   settings,
		log:        writer,
		logger:     logger,
		phase:      PhaseStarting,
		state:      StateDown,
		httpClient: &http.Client{Timeout: 2 * time.Second},
	}
}

// Close flushes the service log.
func (s *Supervisor) Close() error { return s.log.Close() }

// Run supervises the server until the context is cancelled. It returns nil for
// an operator-initiated stop and an error only when the host itself could not
// start, so the SCM failure policy acts on real faults.
func (s *Supervisor) Run(ctx context.Context) error {
	defer s.publish()
	go s.statusLoop(ctx)
	go s.healthLoop(ctx)

	// The job object is the kill-with-the-parent guarantee. It is closed when
	// Run returns, which also ends any child still running.
	job, jobErr := createKillOnCloseJob()
	s.job = job
	if jobErr != nil {
		// Losing the kernel-level guard is reported, not fatal: the context
		// cancel path still terminates the child. What it does mean is that a
		// killed service host can now leave a listener behind, and the next
		// start will refuse to bind over it.
		s.logger.Warn("kill-with-parent guard unavailable", "error", jobErr.Error())
	}
	defer job.close()

	if complaint := requiredChildEnvironment(os.Environ()); complaint != "" {
		s.logger.Error("server environment incomplete", "detail", complaint)
	}

	if err := s.reserveListener(); err != nil {
		s.recordFailure(err)
		return err
	}

	attempt := 0
	for ctx.Err() == nil {
		started := time.Now()
		s.setPhase(PhaseStarting)
		// Before each spawn, not once per service lifetime: the registration this
		// costs is owned by the logon session, and a respawn can follow a session
		// that lost the distribution view in the meantime.
		err := s.runChild(ctx)
		if ctx.Err() != nil {
			s.setPhase(PhaseStopped)
			return nil
		}
		if time.Since(started) >= stableRunIsLongEnough {
			attempt = 0
		} else {
			attempt++
		}
		s.recordFailure(err)
		s.setPhase(PhaseRecovering)
		delay := restartDelays[min(attempt, len(restartDelays)-1)]
		s.logger.Error("server stopped; respawning", "error", fmt.Sprint(err), "delay", delay.String(), "restarts", s.restarts)
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			s.setPhase(PhaseStopped)
			return nil
		}
	}
	return nil
}

// reserveListener proves the configured port is free before the first spawn.
// Without it a squatter turns into an endless restart loop, and an operator
// sees a service that reports Running but never becomes Ready. Any bind failure
// is a refusal — the underlying code is reported rather than interpreted,
// because Windows reports a taken port as WSAEADDRINUSE and POSIX as EADDRINUSE.
func (s *Supervisor) reserveListener() error {
	parsed, err := url.Parse(s.settings.ListenAddress())
	if err != nil || parsed.Port() == "" {
		return fmt.Errorf("listener address %s is malformed", s.settings.ListenAddress())
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", parsed.Port()))
	if err != nil {
		return fmt.Errorf("port %s cannot be bound (%v); the HooshiX MCP service refuses to start over it. "+
			"Stop the process holding the port — if it is an older hand-started server, that is the one to close",
			parsed.Port(), err)
	}
	_ = listener.Close()
	return nil
}

// runChild spawns the server and waits for it. The returned error describes an
// abnormal exit; a stop requested through ctx is reported as nil.
func (s *Supervisor) runChild(ctx context.Context) error {
	command := exec.Command(s.settings.Node, s.settings.Entry)
	command.Dir = s.settings.WorkingDirectory
	command.Env = s.settings.Environment()
	// Both streams go to service.log. os/exec drains the pipes it creates for
	// non-file writers, which is the deadlock a redirected-but-unread stderr
	// pipe causes.
	command.Stdout = s.log
	command.Stderr = s.log

	if err := command.Start(); err != nil {
		return fmt.Errorf("start %s: %w", s.settings.Node, err)
	}
	s.attach(command.Process)
	// The child joins the job before it can bind anything. Failing to join is
	// reported and not fatal: the ctx-stop path still terminates it, and an
	// abrupt host death is the case the job exists for.
	if err := s.job.assign(command.Process.Pid); err != nil {
		s.logger.Warn("server is not covered by the kill-with-parent guard", "error", err.Error())
	}
	s.logger.Info("server started", "pid", command.Process.Pid, "entry", s.settings.Entry, "listener", s.settings.ListenAddress())

	stopped := make(chan error, 1)
	go func() { stopped <- command.Wait() }()

	select {
	case err := <-stopped:
		s.detach()
		s.setHealth(false, false)
		if err == nil {
			return errors.New("the server process exited on its own with status 0")
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			s.recordExit(exitErr.ExitCode())
			return fmt.Errorf("server exited with code %d", exitErr.ExitCode())
		}
		return fmt.Errorf("server process failed: %w", err)
	case <-ctx.Done():
		s.setPhase(PhaseStopping)
		s.terminate(command.Process)
		select {
		case <-stopped:
		case <-time.After(stopWaitBudget):
			s.logger.Warn("server did not report exit after termination", "pid", command.Process.Pid)
		}
		s.detach()
		s.setHealth(false, false)
		return nil
	}
}

// terminate ends the child it spawned. This is the only place a HooshiX server
// process is killed, and it never discovers or targets a process it did not
// start — the rule that kept the PowerShell watchdog safe is kept here too.
//
// A detached service child has no console, so no signal can reach it and
// process.Kill is TerminateProcess: the server's SIGTERM drain does not run.
// That is survivable because the database is WAL-journaled and startup
// recovery requeues interrupted tasks, but it is why stopping the service costs
// any request in flight, and why the tray asks before stopping.
func (s *Supervisor) terminate(process *os.Process) {
	_ = process.Kill()
}

// Snapshot builds the status document from the current fields.
func (s *Supervisor) Snapshot() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{
		Phase:        s.phase,
		State:        s.state,
		Pid:          s.pid,
		Listener:     s.settings.ListenAddress(),
		PublicBase:   s.settings.PublicBaseURL(),
		Restarts:     s.restarts,
		LastExitCode: s.lastExit,
		LastError:    s.lastError,
	}
}

func (s *Supervisor) publish() {
	if err := Write(StatusPath(s.settings.DataRoot), s.Snapshot()); err != nil {
		s.logger.Error("status publish failed", "error", err.Error())
	}
}

func (s *Supervisor) statusLoop(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.publish()
		case <-ctx.Done():
			return
		}
	}
}

// healthLoop polls the server's own unauthenticated health routes. /health/live
// proves the event loop answers; /health/ready proves the database opened and
// answers 503 when it did not.
func (s *Supervisor) healthLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			live, ready := s.probe(ctx)
			s.setHealth(live, ready)
		case <-ctx.Done():
			return
		}
	}
}

func (s *Supervisor) probe(ctx context.Context) (bool, bool) {
	base := s.settings.ListenAddress()
	live, _ := s.probeOne(ctx, base+"/health/live")
	if !live {
		return false, false
	}
	ready, _ := s.probeOne(ctx, base+"/health/ready")
	return true, ready
}

func (s *Supervisor) probeOne(ctx context.Context, address string) (bool, int) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return false, 0
	}
	response, err := s.httpClient.Do(request)
	if err != nil {
		return false, 0
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode == http.StatusOK, response.StatusCode
}

func (s *Supervisor) setPhase(phase string) {
	s.mu.Lock()
	s.phase = phase
	if phase == PhaseStopped {
		s.state = StateDown
		s.pid = 0
	}
	s.mu.Unlock()
	s.publish()
}

func (s *Supervisor) setHealth(live, ready bool) {
	s.mu.Lock()
	switch {
	case !live:
		s.state = StateDown
	case ready:
		s.state = StateReady
	default:
		s.state = StateDegraded
	}
	// A started child is only reported Running once it actually answers: the
	// server boots in seconds under load, and "Running" before that would let
	// the tray show green for a process that cannot serve a request.
	if live && s.phase == PhaseStarting {
		s.phase = PhaseRunning
	}
	s.mu.Unlock()
	s.publish()
}

func (s *Supervisor) recordFailure(err error) {
	s.mu.Lock()
	s.lastError = fmt.Sprint(err)
	s.mu.Unlock()
}

func (s *Supervisor) recordExit(code int) {
	s.mu.Lock()
	s.lastExit = code
	s.mu.Unlock()
}

func (s *Supervisor) attach(process *os.Process) {
	s.mu.Lock()
	s.restarts++
	s.pid = process.Pid
	s.mu.Unlock()
}

func (s *Supervisor) detach() {
	s.mu.Lock()
	s.pid = 0
	s.mu.Unlock()
}
