//go:build windows

package svc

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// An in-place upgrade deletes the registration and recreates it, and SCM only
// drops the record once the last handle closes — held by the service process
// that is still exiting. Treating any open failure as "gone" recreates the
// service while it is still marked for deletion, SCM refuses with the same code,
// and the upgrade rolls back onto a registration it already destroyed.
func TestPackagedServiceImageMustMatchBeforeOwnerUpgrade(t *testing.T) {
	expected := `C:\Program Files\HooshiX MCP\bin\hooshix-mcp-service.exe`
	cases := []struct {
		name, actual string
		want         bool
	}{
		{"normal owner registration", `"C:\Program Files\HooshiX MCP\bin\hooshix-mcp-service.exe" service run-service`, true},
		{"case variation", `"c:\program files\hooshix mcp\BIN\hooshix-mcp-service.exe" service run-service`, true},
		{"old development binary", `"D:\workspace\hooshix-agent\deploy\windows\build\hooshix-mcp-service.exe" service run-service`, false},
		{"foreign arguments", `"C:\Program Files\HooshiX MCP\bin\hooshix-mcp-service.exe" service run-service -settings D:\secrets`, false},
		{"unquoted path", `C:\Program Files\HooshiX MCP\bin\hooshix-mcp-service.exe service run-service`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchesExpectedServiceImage(tc.actual, expected); got != tc.want {
				t.Fatalf("expected guard %v for %q, got %v", tc.want, tc.actual, got)
			}
		})
	}
}

func TestServiceRemovedOnlyMeansTheNameIsFree(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"open succeeded", nil, false},
		{"marked for delete", windows.ERROR_SERVICE_MARKED_FOR_DELETE, false},
		{"access denied", windows.ERROR_ACCESS_DENIED, false},
		{"does not exist", windows.ERROR_SERVICE_DOES_NOT_EXIST, true},
		// The real callers wrap with %w, so the verdict has to survive wrapping.
		{"wrapped does not exist", fmt.Errorf("open service: %w", windows.ERROR_SERVICE_DOES_NOT_EXIST), true},
		{"wrapped marked for delete", fmt.Errorf("open service: %w", windows.ERROR_SERVICE_MARKED_FOR_DELETE), false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := serviceRemoved(test.err); got != test.expected {
				t.Fatalf("serviceRemoved(%v) = %v, want %v", test.err, got, test.expected)
			}
		})
	}
}

func TestAwaitRemovedKeepsPollingUntilTheNameFrees(t *testing.T) {
	restoreRemovalTimings(t, 5*time.Second, 10*time.Millisecond)

	attempts := 0
	err := awaitRemoved(func() error {
		attempts++
		if attempts < 3 {
			return windows.ERROR_SERVICE_MARKED_FOR_DELETE
		}
		return windows.ERROR_SERVICE_DOES_NOT_EXIST
	})
	if err != nil {
		t.Fatalf("a name that frees after polling must succeed: %v", err)
	}
	if attempts < 3 {
		t.Fatalf("expected the removal to be polled, not assumed after %d attempt(s)", attempts)
	}
}

func TestAwaitRemovedReportsTheLastStateItSaw(t *testing.T) {
	restoreRemovalTimings(t, 60*time.Millisecond, 10*time.Millisecond)

	marked := awaitRemoved(func() error { return windows.ERROR_SERVICE_MARKED_FOR_DELETE })
	if marked == nil || !strings.Contains(marked.Error(), "still being removed by SCM") {
		t.Fatalf("expected a removal-in-progress report, got %v", marked)
	}
	// Both messages tell the operator what to do, because the fix is the same:
	// the process holding the registration has to be closed.
	if !strings.Contains(marked.Error(), "run setup again") {
		t.Fatalf("expected recovery guidance, got %q", marked.Error())
	}

	stillThere := awaitRemoved(func() error { return nil })
	if stillThere == nil || !strings.Contains(stillThere.Error(), "still registered") {
		t.Fatalf("expected a still-registered report, got %v", stillThere)
	}
}

// restoreRemovalTimings shrinks the polling constants so a whole timeout budget
// elapses inside a test, and puts them back afterwards.
func restoreRemovalTimings(t *testing.T, budget, pause time.Duration) {
	t.Helper()
	previousBudget, previousPause := scmRemovalBudget, scmRemovalPause
	scmRemovalBudget, scmRemovalPause = budget, pause
	t.Cleanup(func() {
		scmRemovalBudget, scmRemovalPause = previousBudget, previousPause
	})
}
