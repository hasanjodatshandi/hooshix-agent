//go:build windows

package gitworker

import (
	"strings"
	"testing"
)

func TestOwnerStartupCommandAcceptsNormalWindowsPaths(t *testing.T) {
	cases := []struct{ exe, root string }{
		{`D:\workspace\hooshix-agent\deploy\windows\build\bin\hooshix-git-worker-ownercheck.exe`,
			`D:\workspace\hooshix-agent`},
		{`C:\Program Files\HooshiX MCP\bin\hooshix-git-worker.exe`,
			`C:\Users\Coder\Projects\example-2026`},
	}
	for _, tc := range cases {
		got, err := startupCommand(tc.exe, tc.root)
		if err != nil {
			t.Fatalf("valid Windows path rejected: %q: %v", tc.exe, err)
		}
		if !strings.Contains(got, `"`+tc.exe+`"`) || !strings.Contains(got, `-root "`+tc.root+`"`) {
			t.Errorf("unsafe or malformed startup command: %q", got)
		}
	}
}

func TestOwnerStartupCommandRejectsSpecialCharacters(t *testing.T) {
	cases := []struct{ exe, root string }{
		{`C:\Program Files\worker" --extra`, `D:\repo`},
		{`C:\worker.exe`, `D:\repo" --extra`},
		{"C:\\worker.exe\nextra", `D:\repo`},
		{`C:\worker.exe`, "D:\\repo\rjunk"},
		{"C:\\worker.exe\x00junk", `D:\repo`},
		{`C:\worker.exe`, "D:\\repo\x00junk"},
	}
	for _, tc := range cases {
		if got, err := startupCommand(tc.exe, tc.root); err == nil {
			t.Errorf("unsafe command accepted: %q", got)
		}
	}
}