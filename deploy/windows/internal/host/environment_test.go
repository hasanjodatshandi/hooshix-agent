package host

import (
	"strings"
	"testing"
)

// serviceEnvironment is the environment block the service control manager
// builds for a LocalSystem service: every name arrives spelled the way the
// registry stores it, so the search path is "Path" and the interpreter is
// "ComSpec". This is the shape that silently stripped PATH from the server
// process and turned every command a client asked for into `spawn cmd.exe
// ENOENT`.
var serviceEnvironment = []string{
	"SystemRoot=C:\\Windows",
	"SystemDrive=C:",
	"WINDIR=C:\\Windows",
	"Path=C:\\Windows\\system32;C:\\Program Files\\Git\\cmd",
	"PATHEXT=.COM;.EXE;.BAT;.CMD;.VBS;.JS;.MSC",
	"ComSpec=C:\\Windows\\system32\\cmd.exe",
	"TEMP=C:\\Windows\\TEMP",
	"TMP=C:\\Windows\\TEMP",
	"USERPROFILE=C:\\Windows\\system32\\config\\systemprofile",
	"ProgramData=C:\\ProgramData",
}

func environmentValues(entries []string) map[string]string {
	parsed := map[string]string{}
	for _, entry := range entries {
		name, value, _ := strings.Cut(entry, "=")
		parsed[name] = value
	}
	return parsed
}

func TestRegistrySpelledNamesStillReachTheServer(t *testing.T) {
	got := environmentValues((&Settings{}).childEnvironment(map[string]string{}, serviceEnvironment))

	for name, want := range map[string]string{
		"PATH":        "C:\\Windows\\system32;C:\\Program Files\\Git\\cmd",
		"SystemDrive": "C:",
		"COMSPEC":     "C:\\Windows\\system32\\cmd.exe",
		// The allowlist spells this one lowercase, and the distribution
		// launcher in wsl.go reads it by that exact name.
		"windir": "C:\\Windows",
	} {
		if got[name] != want {
			t.Errorf("%s = %q, want the block's %q", name, got[name], want)
		}
	}
}

// The server reads its own environment by exact name on both sides of the
// boundary: Node looks up process.env.PATH, and the command allowlist reads the
// same spelling. So the handoff has to normalize the name, not only the value.
func TestInheritedNamesAreRenamedToTheAllowlistSpelling(t *testing.T) {
	got := environmentValues((&Settings{}).childEnvironment(map[string]string{}, serviceEnvironment))

	if _, found := got["Path"]; found {
		t.Errorf("the child block still carries the registry spelling Path=%q instead of PATH", got["Path"])
	}
	if _, found := got["ComSpec"]; found {
		t.Errorf("the child block carries ComSpec instead of COMSPEC: %q", got["ComSpec"])
	}
}

func TestFirstSpellingOfANameIsTheOneWindowsReports(t *testing.T) {
	block := []string{"PATH=C:\\first", "Path=C:\\second"}

	got := environmentValues((&Settings{}).childEnvironment(map[string]string{}, block))

	if got["PATH"] != "C:\\first" {
		t.Errorf("PATH = %q, want the first entry of the block", got["PATH"])
	}
}

func TestSystemDriveIsDerivedWhenTheWindowsServiceBlockOmitsIt(t *testing.T) {
	block := []string{"SystemRoot=C:\\Windows", "Path=C:\\Windows\\system32"}
	got := environmentValues((&Settings{}).childEnvironment(map[string]string{}, block))
	if got["SystemDrive"] != "C:" {
		t.Errorf("SystemDrive = %q, want C: from SystemRoot", got["SystemDrive"])
	}
}

func TestEmptyInheritedNamesAreNotHandedDown(t *testing.T) {
	block := []string{"SystemRoot=C:\\Windows",
		"SystemDrive=C:", "Path=", "TEMP=C:\\Windows\\TEMP"}

	got := environmentValues((&Settings{}).childEnvironment(map[string]string{}, block))

	if _, found := got["PATH"]; found {
		t.Errorf("an empty Path was handed down as PATH=%q; the server should not receive a blank search path", got["PATH"])
	}
	if got["SystemRoot"] != "C:\\Windows" {
		t.Errorf("SystemRoot = %q, want it inherited beside the blank Path", got["SystemRoot"])
	}
}

// The settings document is the operator's override; the inherited block is only
// a floor.
func TestOperatorEnvironmentStillWinsOverTheInheritedOne(t *testing.T) {
	settings := map[string]string{"PATH": "C:\\operator\\bin", "HOOSHIX_PERMISSION_LEVEL": "ADMIN_MODE"}

	got := environmentValues((&Settings{}).childEnvironment(settings, serviceEnvironment))

	if got["PATH"] != "C:\\operator\\bin" {
		t.Errorf("PATH = %q, want the settings value to beat the block", got["PATH"])
	}
	if got["HOOSHIX_PERMISSION_LEVEL"] != "ADMIN_MODE" {
		t.Errorf("the settings document did not reach the child: %v", got)
	}
}

// requiredChildEnvironment is the loud half of the fix: without PATH the service
// starts and answers health checks while every command tool fails, so an
// operator has to be able to see the cause in the service log at boot.
func TestMissingSearchPathIsNamedAtBoot(t *testing.T) {
	if complaint := requiredChildEnvironment(serviceEnvironment); complaint != "" {
		t.Errorf("a service block carrying Path was complained about: %q", complaint)
	}

	block := []string{}
	for _, entry := range serviceEnvironment {
		name, _, _ := strings.Cut(entry, "=")
		if !strings.EqualFold(name, "Path") {
			block = append(block, entry)
		}
	}
	if complaint := requiredChildEnvironment(block); complaint == "" {
		t.Error("a block with no search path at all produced no complaint")
	} else if !strings.Contains(complaint, "PATH") {
		t.Errorf("complaint %q does not name PATH, which is what an operator has to fix", complaint)
	}

	if complaint := requiredChildEnvironment([]string{"SystemRoot=C:\\Windows",
		"SystemDrive=C:", "Path=   "}); complaint == "" {
		t.Error("a whitespace-only Path was accepted as a search path")
	}
}
