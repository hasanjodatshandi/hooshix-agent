package host

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// launcherCall records one hand the host tried to make to the distribution
// launcher: the program it resolved and the exact argv it passed.
type launcherCall struct {
	program string
	args    []string
}

func wslSupervisor(t *testing.T, distros ...string) (*Supervisor, string) {
	t.Helper()
	root := t.TempDir()
	supervisor := New(&Settings{DataRoot: root, WslDistros: distros})
	t.Cleanup(func() { _ = supervisor.Close() })
	return supervisor, root
}

// stubLauncher replaces the two seams the warm-up uses, so a test can state what
// the host would run and how it reacts, without a distribution on the machine.
func stubLauncher(t *testing.T, respond func(distro string) (string, error)) *[]launcherCall {
	t.Helper()
	previousLaunch, previousResolve := launchWsl, resolveWslProgram
	var calls []launcherCall
	resolveWslProgram = func() (string, error) { return `C:\Windows\System32\wsl.exe`, nil }
	launchWsl = func(_ context.Context, program string, args ...string) (string, error) {
		calls = append(calls, launcherCall{program: program, args: args})
		distro := ""
		if len(args) >= 2 {
			distro = args[1]
		}
		return respond(distro)
	}
	t.Cleanup(func() {
		launchWsl, resolveWslProgram = previousLaunch, previousResolve
	})
	return &calls
}

func readServiceLog(t *testing.T, root string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, "service.log"))
	if err != nil {
		t.Fatalf("read service log: %v", err)
	}
	return string(raw)
}

func TestRegisteringWslViewsIsOffUnlessANameIsConfigured(t *testing.T) {
	calls := stubLauncher(t, func(string) (string, error) { return "", nil })
	supervisor, _ := wslSupervisor(t)

	supervisor.registerWslViews(context.Background())

	if len(*calls) != 0 {
		t.Fatalf("an install that names no distribution must not touch the launcher, got %+v", *calls)
	}
}

func TestRegisteringWslViewsAsksForEveryDistributionByName(t *testing.T) {
	calls := stubLauncher(t, func(string) (string, error) { return "/home/coder/workspace", nil })
	supervisor, _ := wslSupervisor(t, "Ubuntu", "Debian-12")

	supervisor.registerWslViews(context.Background())

	want := []launcherCall{
		{program: `C:\Windows\System32\wsl.exe`, args: []string{"-d", "Ubuntu", "-e", "pwd"}},
		{program: `C:\Windows\System32\wsl.exe`, args: []string{"-d", "Debian-12", "-e", "pwd"}},
	}
	if len(*calls) != len(want) {
		t.Fatalf("calls = %+v, want %+v", *calls, want)
	}
	for index, expected := range want {
		if (*calls)[index].program != expected.program {
			t.Errorf("call %d program = %q, want %q", index, (*calls)[index].program, expected.program)
		}
		if strings.Join((*calls)[index].args, " ") != strings.Join(expected.args, " ") {
			t.Errorf("call %d args = %v, want %v", index, (*calls)[index].args, expected.args)
		}
	}
}

func TestRegisteringWslViewsReportsWhatItDidToTheServiceLog(t *testing.T) {
	stubLauncher(t, func(string) (string, error) { return "  /home/coder/workspace  ", nil })
	supervisor, root := wslSupervisor(t, "Ubuntu")

	supervisor.registerWslViews(context.Background())

	logged := readServiceLog(t, root)
	for _, want := range []string{"wsl file view registered", "distro=Ubuntu", "launcher=/home/coder/workspace"} {
		if !strings.Contains(logged, want) {
			t.Errorf("service log is missing %q:\n%s", want, logged)
		}
	}
}

// The launcher's own message is the only thing that tells an operator why a
// registration failed, so it has to survive into the log — and it must not stop
// the other distributions or the server itself.
func TestFailedWslRegistrationIsLoggedAndDoesNotStopTheRest(t *testing.T) {
	calls := stubLauncher(t, func(distro string) (string, error) {
		if distro == "Ubuntu" {
			return "Windows System Error 0x80000001: Wsl/Service/WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED",
				os.ErrPermission
		}
		return "/home/coder/workspace", nil
	})
	supervisor, root := wslSupervisor(t, "Ubuntu", "Debian-12")

	supervisor.registerWslViews(context.Background())

	if len(*calls) != 2 {
		t.Fatalf("a failing distribution must not skip the next one, got %d calls", len(*calls))
	}
	logged := readServiceLog(t, root)
	for _, want := range []string{"wsl file view registration failed", "WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED", "wsl file view registered"} {
		if !strings.Contains(logged, want) {
			t.Errorf("service log is missing %q:\n%s", want, logged)
		}
	}
}

func TestMissingLauncherIsReportedAndNotFatal(t *testing.T) {
	previousResolve := resolveWslProgram
	resolveWslProgram = func() (string, error) { return "", os.ErrNotExist }
	t.Cleanup(func() { resolveWslProgram = previousResolve })

	supervisor, root := wslSupervisor(t, "Ubuntu")
	supervisor.registerWslViews(context.Background())

	logged := readServiceLog(t, root)
	if !strings.Contains(logged, "wsl file views not registered") {
		t.Errorf("expected the missing launcher to be logged:\n%s", logged)
	}
}

func TestWslDistroNamesThatCouldBecomeLauncherOptionsAreRefused(t *testing.T) {
	for _, name := range []string{"", " Ubuntu", "Ubuntu ", "-l", "Ubuntu;rm", "Ubuntu\\..", `"Ubuntu"`, "Ubuntu\tab"} {
		if err := validateWslDistro(name); err == nil {
			t.Errorf("validateWslDistro(%q) accepted a name that must be refused", name)
		}
	}
	// A dash inside a real distribution name and a space inside "Ubuntu 22.04" are
	// both legitimate: the launcher gets one argv element and no shell is involved.
	for _, name := range []string{"Ubuntu", "Ubuntu-24.04", "Debian", "SUSE Linux Enterprise 15 SP4"} {
		if err := validateWslDistro(name); err != nil {
			t.Errorf("validateWslDistro(%q) refused a real distribution name: %v", name, err)
		}
	}
}

func TestSettingsRefuseABadDistributionNameAtLoad(t *testing.T) {
	root := tempDataRoot(t)
	path := writeSettings(t, root, map[string]string{})
	mutateSettings(t, path, func(document map[string]any) {
		document["wslDistros"] = []any{"-l"}
	})

	if _, err := LoadSettings(path); err == nil {
		t.Fatal("settings with a distribution name that starts with a dash must not load")
	} else if !strings.Contains(err.Error(), "starts with a dash") {
		t.Fatalf("load error should name the field problem, got %v", err)
	}
}

// The seams above prove what the host asks for; this one proves the real call
// path captures a real process and keeps its output, using the test binary as
// the launcher.
func TestWslWarmupRunsTheLauncherAndKeepsItsOutput(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}
	previousResolve := resolveWslProgram
	resolveWslProgram = func() (string, error) { return executable, nil }
	t.Cleanup(func() { resolveWslProgram = previousResolve })

	t.Setenv(helperEnv, helperLauncher)
	supervisor, root := wslSupervisor(t, "Ubuntu")
	supervisor.registerWslViews(context.Background())

	if logged := readServiceLog(t, root); !strings.Contains(logged, launcherOutputLine) {
		t.Errorf("the launcher's own line should reach the service log:\n%s", logged)
	}

	t.Setenv(launcherExitEnv, "1")
	failing, failingRoot := wslSupervisor(t, "Ubuntu")
	failing.registerWslViews(context.Background())

	logged := readServiceLog(t, failingRoot)
	if !strings.Contains(logged, "wsl file view registration failed") {
		t.Errorf("a launcher that exits non-zero must be reported:\n%s", logged)
	}
}

// A launcher prints progress lines, warnings and blank space before the answer,
// and a chatty one must not be able to fill service.log.
func TestLauncherOutputReachesTheLogAsOneBoundedLine(t *testing.T) {
	cases := []struct {
		name   string
		output string
		want   string
	}{
		{"the first printed line is kept", "starting\r\n/home/coder/workspace\r\nbye\r\n", "starting"},
		{"blank lines are skipped", "\n\n   \tpadding   \nnext\n", "padding"},
		{"nothing printed stays empty", "  \r\n \n", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := describeLauncherOutput(testCase.output); got != testCase.want {
				t.Errorf("describeLauncherOutput(%q) = %q, want %q", testCase.output, got, testCase.want)
			}
		})
	}

	long := strings.Repeat("x", wslLogOutputLimit+500)
	if bounded := describeLauncherOutput(long); len([]rune(bounded)) != wslLogOutputLimit+1 {
		t.Errorf("output past the bound should be cut to the limit plus the ellipsis, got %d runes", len([]rune(bounded)))
	}
}

// The registration only helps if it happens before the server can be asked for a
// workspace path, so this drives the real supervisor loop rather than the method.
func TestSupervisorRegistersConfiguredViewsBeforeTheServerStarts(t *testing.T) {
	root := tempDataRoot(t)
	port := freePort(t)
	settings, err := LoadSettings(writeSettings(t, root, servingEnvironment(port, nil)))
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	settings.WslDistros = []string{"Ubuntu"}

	calls := stubLauncher(t, func(string) (string, error) { return "/home/coder/workspace", nil })
	supervisor := New(settings)
	startSupervisor(t, supervisor)

	if status := waitForStatus(t, root, 25*time.Second, func(candidate Status) bool {
		return candidate.Phase == PhaseRunning && candidate.State == StateReady
	}); status.Pid == 0 {
		t.Fatalf("expected a running child, got %+v", status)
	}

	if len(*calls) != 1 {
		t.Fatalf("a healthy run should ask the launcher once, before the first spawn, got %+v", *calls)
	}
	if logged := readServiceLog(t, root); !strings.Contains(logged, "wsl file view registered") {
		t.Errorf("the registration should be recorded before the server starts:\n%s", logged)
	}
}

// The service host inherits almost nothing from the machine environment, so the
// launcher has to be found through the Windows root and not through PATH.
func TestWslLauncherIsLocatedThroughTheWindowsRootNotPath(t *testing.T) {
	root := t.TempDir()
	system32 := filepath.Join(root, "System32")
	if err := os.MkdirAll(system32, 0o700); err != nil {
		t.Fatalf("create System32: %v", err)
	}
	candidate := filepath.Join(system32, "wsl.exe")
	if err := os.WriteFile(candidate, []byte("stub"), 0o700); err != nil {
		t.Fatalf("write stub launcher: %v", err)
	}

	for _, key := range []string{"SystemRoot", "windir"} {
		other := "windir"
		if key == "windir" {
			other = "SystemRoot"
		}
		t.Setenv(key, root)
		t.Setenv(other, "")
		program, err := resolveWslProgram()
		if err != nil {
			t.Fatalf("%s must be enough to find the launcher: %v", key, err)
		}
		if program != candidate {
			t.Errorf("resolveWslProgram via %s = %q, want %q", key, program, candidate)
		}
	}

	t.Setenv("SystemRoot", filepath.Join(t.TempDir(), "absent"))
	t.Setenv("windir", "")
	if _, err := resolveWslProgram(); err == nil {
		t.Fatal("a machine without the launcher must report why, not pretend to register the views")
	}
}
