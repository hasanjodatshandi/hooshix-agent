package host

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// helperEnv marks a re-executed copy of the test binary as the fake server
// child, so the supervisor is tested against a process it really spawns,
// kills and respawns rather than a mock that cannot exit with a code.
const helperEnv = "HOOSHIX_MCP_TEST_HELPER"

const (
	helperServes   = "serve"
	helperExits    = "exit-with-code"
	helperPortEnv  = "HOOSHIX_HTTP_PORT"
	helperCodeEnv  = "HOOSHIX_TEST_EXIT_CODE"
	helperNotReady = "HOOSHIX_TEST_NOT_READY"
)

func TestMain(m *testing.M) {
	switch os.Getenv(helperEnv) {
	case helperServes:
		serveAsChild()
		return
	case helperExits:
		code := 3
		if raw := os.Getenv(helperCodeEnv); raw != "" {
			_, _ = fmt.Sscanf(raw, "%d", &code)
		}
		os.Exit(code)
	}
	os.Exit(m.Run())
}

// serveAsChild answers the health routes the supervisor probes, on the port the
// supervisor told the child to listen on. Readiness is deliberately controllable
// so the degraded state is a tested state, not an incidental one.
func serveAsChild() {
	notReady := os.Getenv(helperNotReady) != ""
	port := os.Getenv(helperPortEnv)
	if port == "" {
		port = "3001"
	}
	server := &http.Server{
		Addr: "127.0.0.1:" + port,
		Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/health/live":
				_, _ = writer.Write([]byte(`{"status":"ok"}`))
			case "/health/ready":
				if notReady {
					writer.WriteHeader(http.StatusServiceUnavailable)
					_, _ = writer.Write([]byte(`{"status":"not_ready"}`))
					return
				}
				_, _ = writer.Write([]byte(`{"status":"ready"}`))
			default:
				writer.WriteHeader(http.StatusNotFound)
			}
		}),
	}
	_ = server.ListenAndServe()
}

func tempDataRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "entry.js"), []byte("// fake entry\n"), 0o600); err != nil {
		t.Fatalf("write entry: %v", err)
	}
	return root
}

// writeSettings lays down a settings document whose child is the re-executed
// test binary, then returns its path.
func writeSettings(t *testing.T, dataRoot string, env map[string]string) string {
	t.Helper()
	// The child is this very test binary, re-entered through TestMain when
	// HOOSHIX_MCP_TEST_HELPER is set. A spawned process is the only way to test
	// a real exit code, a real kill and a real respawn.
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}
	document := map[string]any{
		"node":             executable,
		"entry":            filepath.Join(dataRoot, "entry.js"),
		"workingDirectory": dataRoot,
		"dataRoot":         dataRoot,
		"env":              env,
	}
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("encode settings: %v", err)
	}
	path := filepath.Join(dataRoot, "settings.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	return path
}

func mutateSettings(t *testing.T, path string, mutate func(map[string]any)) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	document := map[string]any{}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	mutate(document)
	updated, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("re-encode settings: %v", err)
	}
	if err := os.WriteFile(path, updated, 0o600); err != nil {
		t.Fatalf("rewrite settings: %v", err)
	}
}

// freePort reserves a loopback port and releases it for the child to bind.
func freePort(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("split port: %v", err)
	}
	return port
}

func servingEnvironment(port string, extra map[string]string) map[string]string {
	env := map[string]string{helperEnv: helperServes, helperPortEnv: port}
	for key, value := range extra {
		env[key] = value
	}
	return env
}

func waitForStatus(t *testing.T, dataRoot string, budget time.Duration, accept func(Status) bool) Status {
	t.Helper()
	deadline := time.Now().Add(budget)
	var last Status
	for time.Now().Before(deadline) {
		if status, err := Read(dataRoot); err == nil {
			last = status
			if accept(status) {
				return status
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("status never satisfied the condition within %s (last: %+v)", budget, last)
	return last
}

// startSupervisor runs the supervisor in the background and registers teardown
// that waits for it and closes its log writer. Waiting is not optional on
// Windows: the child holds its working directory, and the log writer holds an
// open file inside t.TempDir(), so a cleanup that races the shutdown fails to
// empty the directory.
func startSupervisor(t *testing.T, supervisor *Supervisor) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan error, 1)
	go func() { stopped <- supervisor.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-stopped:
		case <-time.After(20 * time.Second):
			t.Errorf("the supervisor did not return after cancel")
		}
		if err := supervisor.Close(); err != nil {
			t.Errorf("close service log: %v", err)
		}
	})
}

func environmentMap(settings *Settings) map[string]string {
	env := map[string]string{}
	for _, entry := range settings.Environment() {
		key, value, _ := strings.Cut(entry, "=")
		env[key] = value
	}
	return env
}

func TestSettingsRejectsLayoutsThatCannotRunAsAService(t *testing.T) {
	root := tempDataRoot(t)
	tests := []struct {
		name    string
		mutate  func(map[string]any)
		matches string
	}{
		{
			name:    "relative node path",
			mutate:  func(document map[string]any) { document["node"] = filepath.Join("runtime", "node.exe") },
			matches: "node must be an absolute path",
		},
		{
			name:    "missing node runtime",
			mutate:  func(document map[string]any) { document["node"] = filepath.Join(root, "no-such-node.exe") },
			matches: "node runtime",
		},
		{
			name:    "entry that is not JavaScript",
			mutate:  func(document map[string]any) { document["entry"] = filepath.Join(root, "index.exe") },
			matches: "not a JavaScript file",
		},
		{
			name:    "relative log directory",
			mutate:  func(document map[string]any) { document["env"] = map[string]string{"HOOSHIX_LOG_DIR": "logs"} },
			matches: "HOOSHIX_LOG_DIR must be an absolute path",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := writeSettings(t, root, map[string]string{})
			mutateSettings(t, path, test.mutate)
			_, err := LoadSettings(path)
			if err == nil {
				t.Fatalf("expected an error containing %q", test.matches)
			}
			if !strings.Contains(err.Error(), test.matches) {
				t.Fatalf("expected error containing %q, got %q", test.matches, err.Error())
			}
		})
	}
}

func TestSettingsOwnsThePathsTheServerWrites(t *testing.T) {
	root := tempDataRoot(t)
	settings, err := LoadSettings(writeSettings(t, root, map[string]string{"HOOSHIX_HTTP_PORT": "3999"}))
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	if settings.LogDirectory() != filepath.Join(root, "logs") {
		t.Fatalf("expected the log directory under the data root, got %q", settings.LogDirectory())
	}
	if settings.ListenAddress() != "http://127.0.0.1:3999" {
		t.Fatalf("expected the configured listener, got %q", settings.ListenAddress())
	}

	env := environmentMap(settings)
	for _, key := range []string{"HOOSHIX_LOG_DIR", "HOOSHIX_DB_PATH", "HOOSHIX_BOOTSTRAP_TOKEN_FILE"} {
		if !filepath.IsAbs(env[key]) {
			t.Fatalf("%s must be absolute for a service child, got %q", key, env[key])
		}
	}
	// The child sees this document and not the operator's shell. An ambient
	// permission level was inherited once and silently downgraded the
	// assistant, so an unset value stays unset rather than being copied in.
	if _, inherited := env["HOOSHIX_PERMISSION_LEVEL"]; inherited {
		t.Fatalf("an ambient permission level leaked into the child environment")
	}
}

func TestSupervisorPublishesHealthBackedStatusAndStopsItsChild(t *testing.T) {
	root := tempDataRoot(t)
	port := freePort(t)
	settings, err := LoadSettings(writeSettings(t, root, servingEnvironment(port, nil)))
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	supervisor := New(settings)
	defer supervisor.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	stopped := make(chan error, 1)
	go func() { stopped <- supervisor.Run(ctx) }()

	status := waitForStatus(t, root, 20*time.Second, func(candidate Status) bool {
		return candidate.Phase == PhaseRunning && candidate.State == StateReady
	})
	if status.Pid <= 0 {
		t.Fatalf("expected the child pid in the published status, got %+v", status)
	}
	if status.Listener != "http://127.0.0.1:"+port {
		t.Fatalf("expected the configured listener, got %q", status.Listener)
	}

	cancel()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatalf("an operator stop must not report a failure: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatalf("the supervisor did not return after cancel")
	}
	final := waitForStatus(t, root, 10*time.Second, func(candidate Status) bool {
		return candidate.Phase == PhaseStopped
	})
	if final.Pid != 0 {
		t.Fatalf("expected the pid cleared after stop, got %+v", final)
	}
	// A stopped service that left its child running would make the next start
	// refuse to bind forever, so the port has to be free again.
	assertPortFree(t, port)
}

func TestSupervisorReportsDegradedWhenReadinessFails(t *testing.T) {
	root := tempDataRoot(t)
	port := freePort(t)
	settings, err := LoadSettings(writeSettings(t, root, servingEnvironment(port, map[string]string{helperNotReady: "1"})))
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	supervisor := New(settings)
	startSupervisor(t, supervisor)

	waitForStatus(t, root, 20*time.Second, func(candidate Status) bool {
		return candidate.State == StateDegraded && candidate.Pid > 0
	})
}

func TestSupervisorRespawnsACrashingChild(t *testing.T) {
	root := tempDataRoot(t)
	port := freePort(t)
	settings, err := LoadSettings(writeSettings(t, root, map[string]string{
		helperEnv:     helperExits,
		helperCodeEnv: "7",
		helperPortEnv: port,
	}))
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	supervisor := New(settings)
	startSupervisor(t, supervisor)

	status := waitForStatus(t, root, 25*time.Second, func(candidate Status) bool {
		return candidate.Restarts >= 2 && candidate.LastExitCode == 7
	})
	if status.Phase != PhaseRecovering {
		t.Fatalf("expected a crash loop to report recovery, got %+v", status)
	}
	if status.LastError == "" {
		t.Fatalf("expected the crash reason to be published")
	}
}

func TestSupervisorRefusesASquattedPort(t *testing.T) {
	root := tempDataRoot(t)
	port := freePort(t)
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		t.Fatalf("squatter listen: %v", err)
	}
	defer listener.Close()

	settings, err := LoadSettings(writeSettings(t, root, servingEnvironment(port, nil)))
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	supervisor := New(settings)
	defer supervisor.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = supervisor.Run(ctx)
	if err == nil {
		t.Fatalf("expected the supervisor to refuse a port it does not own")
	}
	if !strings.Contains(err.Error(), "refuses to start over it") {
		t.Fatalf("expected a refusal message, got %q", err.Error())
	}
}

func assertPortFree(t *testing.T, port string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		listener, err := net.Listen("tcp", "127.0.0.1:"+port)
		if err == nil {
			_ = listener.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("port %s is still held after the service stopped", port)
}
