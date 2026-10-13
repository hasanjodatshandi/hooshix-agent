//go:build windows

package tray

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/host"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/svc"
	"golang.org/x/sys/windows"
)

// App owns the tray lifecycle: what it knows, where it logs, and what its menu
// is allowed to do about it.
type App struct {
	logger   *slog.Logger
	logPath  string
	dataRoot string
	logsDir  string
	menu     *menuHost

	closer atomic.Value // io.Closer: the tray log writer, when one was opened

	mu      sync.Mutex
	current Snapshot

	// busy guards the service commands. Stop and Restart wait for SCM, so a
	// second click arriving while the first is still in flight would report a
	// failure the user did not cause.
	busy atomic.Bool
}

// ErrAlreadyRunning means another tray instance already owns this session's
// icon slot (a logon launch racing a manual one).
var ErrAlreadyRunning = errors.New("another HooshiX tray icon is already running")

// singletonName is per-session, so two accounts on one machine each get an
// icon while one account never gets two.
const singletonName = `Local\HooshiXMCPTray`

// Run starts the tray and blocks until the icon is closed or the session ends.
func Run(settingsPath string) error {
	// The hidden window, its message pump, and every TrackPopupMenu call must
	// live on ONE OS thread: Windows delivers a window's messages to the thread
	// that created it. Without pinning, the Go scheduler can resume this
	// goroutine elsewhere, so icon clicks arrive at a thread nobody pumps and
	// the menu opens only when the scheduler happens to cooperate.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	name, err := windows.UTF16PtrFromString(singletonName)
	if err != nil {
		return err
	}
	app := newApp(settingsPath)
	defer app.closeLog()

	mutex, err := windows.CreateMutex(nil, false, name)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(mutex)
		// The shipped tray has no console, so this line is the only trace a
		// blocked duplicate launch leaves.
		app.logger.Info("another tray icon already owns this session; exiting")
		return ErrAlreadyRunning
	}
	if err != nil {
		// A failed mutex creation is not a second instance. Keep going rather
		// than leave the operator with no icon at all.
		mutex = 0
	}
	if mutex != 0 {
		defer windows.CloseHandle(mutex)
	}

	// The first snapshot is read before the window exists so the icon appears
	// already telling the truth instead of flashing a placeholder colour.
	app.poll()
	menu, err := newMenuHost(app)
	if err != nil {
		app.logger.Error("create tray host failed", "error", err)
		return err
	}
	app.menu = menu
	defer menu.dispose()

	app.logger.Info("tray started", "dataRoot", app.dataRoot, "logs", app.logsDir, "logFile", app.logPath)
	go app.pollLoop()
	runErr := menu.run()
	app.logger.Info("tray exited")
	return runErr
}

// newApp resolves where the install lives and opens the tray's own log.
func newApp(settingsPath string) *App {
	dataRoot, logsDir, resolvedSettings, err := resolveState(settingsPath)
	app := &App{dataRoot: dataRoot, logsDir: logsDir}
	app.openLog()
	if err != nil {
		// Not fatal: a service that is running but has an unreadable settings
		// document is exactly the state the tray exists to be reported from.
		app.logger.Warn("settings could not be read; using the machine-wide state directory",
			"path", resolvedSettings, "error", err)
	}
	return app
}

// resolveState loads settings.json to learn the data root and the log
// directory. A document that cannot be parsed still leaves its own directory as
// the documented home of status.json, which is precisely the case an operator
// needs diagnostics for, so the fallback is a location rather than a failure.
func resolveState(settingsPath string) (dataRoot, logsDir, usedPath string, err error) {
	usedPath = settingsPath
	if usedPath == "" {
		usedPath, err = host.DefaultSettingsPath()
		if err != nil {
			return "", "", usedPath, err
		}
	}
	settings, loadErr := host.LoadSettings(usedPath)
	if loadErr != nil {
		state := filepath.Dir(usedPath)
		return state, filepath.Join(state, "logs"), usedPath, loadErr
	}
	return settings.DataRoot, settings.LogDirectory(), usedPath, nil
}

// openLog sends the tray's diagnostics to the signed-in user's own directory,
// never to the machine-wide tree: LocalSystem owns that one, and a tray running
// unelevated must not need write access there to record its own problems. If no
// log can be opened, stderr still gets the text, which is where a console
// launch will look.
func (app *App) openLog() {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		app.logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
		return
	}
	app.logPath = filepath.Join(base, "HooshiXMCP", "tray.log")
	writer := host.NewRotatingLog(app.logPath, 1<<20, 1)
	app.closer.Store(writer)
	app.logger = slog.New(slog.NewTextHandler(writer, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func (app *App) closeLog() {
	if stored, ok := app.closer.Load().(io.Closer); ok && stored != nil {
		_ = stored.Close()
	}
}

// pollLoop keeps the icon in step with the service. The interval matches the
// service's own publish cadence, so the tray is never more than one tick behind
// the state the service decided to report.
func (app *App) pollLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		app.refresh()
	}
}

// refresh polls and repaints. It runs on the poll goroutine and after a service
// command, when waiting for the next tick would show the user a stale colour.
func (app *App) refresh() {
	app.poll()
	if app.menu != nil {
		app.menu.refresh(app.snapshot())
	}
}

// poll reads the only two sources the tray is allowed to see: SCM answers for
// the service, and the published document answers for the server inside it.
// Neither read needs a credential or elevation.
func (app *App) poll() {
	serviceState, err := svc.QueryStatus()
	if err != nil {
		// Record the failure instead of keeping the last answer: a service that
		// vanished from SCM must not stay green.
		app.store(Merge("", host.Status{}, err))
		return
	}
	status, readErr := host.Read(app.dataRoot)
	app.store(Merge(serviceState, status, readErr))
}

func (app *App) store(snapshot Snapshot) {
	app.mu.Lock()
	app.current = snapshot
	app.mu.Unlock()
}

func (app *App) snapshot() Snapshot {
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.current
}

// openLogs shows the log directory rather than one file: the names roll over,
// and "the folder with the logs in it" is the thing a non-expert can act on.
func (app *App) openLogs() {
	if app.logsDir == "" {
		app.report("Open logs", errors.New("the log directory is unknown: settings.json could not be read"))
		return
	}
	if _, err := os.Stat(app.logsDir); err != nil {
		app.report("Open logs", fmt.Errorf("no logs in %s yet: the service has not written any", app.logsDir))
		return
	}
	command := exec.Command("explorer.exe", app.logsDir)
	if err := command.Start(); err != nil {
		app.report("Open logs", err)
		return
	}
	// explorer.exe returns a non-zero exit code even when it opened the folder,
	// so Wait's result is deliberately ignored; it is called only to reap.
	go func() { _ = command.Wait() }()
	app.logger.Info("opened log directory", "path", app.logsDir)
}

func (app *App) startService()   { app.command("Start", svc.Start) }
func (app *App) stopService()    { app.command("Stop", svc.Stop) }
func (app *App) restartService() { app.command("Restart", svc.Restart) }

// command runs one SCM action off the message-loop thread and reports the
// outcome. Stop and Restart block until SCM settles, which can take seconds;
// on the UI thread that freezes the pump, and a frozen pump stops answering
// clicks — the icon would look hung exactly while the operator watches it.
func (app *App) command(name string, action func() error) {
	if !app.busy.CompareAndSwap(false, true) {
		app.report(name, errors.New("the previous service command is still running"))
		return
	}
	go func() {
		defer app.busy.Store(false)
		if err := action(); err != nil {
			app.report(name, err)
		} else {
			app.logger.Info("service command accepted", "command", name)
		}
		app.refresh()
	}()
}

// report logs an action failure and says it out loud: a menu click that did
// nothing and stayed silent is indistinguishable from a broken tray.
func (app *App) report(action string, err error) {
	app.logger.Warn("tray action failed", "action", action, "error", err)
	menu := app.menu
	if menu == nil {
		return
	}
	message := truncate(fmt.Sprintf("%s failed: %v", action, err), 200)
	menu.runOnUi(func() { menu.showBalloon("HooshiX MCP", message, niifError) })
}

// exit closes the icon only. The service keeps running: it is a machine-wide
// service, and dismissing the tray must never take the connector down.
func (app *App) exit() {
	app.logger.Info("tray exit requested; the service keeps running")
	if app.menu != nil {
		app.menu.quit()
	}
}
