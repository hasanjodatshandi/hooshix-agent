//go:build linux

package wslfs

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

// An isolated Go test executable is used as the Linux broker in the
// Windows -> signed-in owner worker -> wsl.exe integration test. Production
// broker binaries NEVER contain this executable/test entry point.
//
// The owner worker starts a NEW Linux process per request. On successful
// git_commit ref-CAS this test process actually SIGKILLs ITSELF, rather than
// simulating a Go callback error or dropping a Windows Named Pipe response.
func TestLinuxBrokerKillAfterCommitCASChild(t *testing.T) {
	if os.Getenv("HOOSHIX_WSLFS_LINUX_CRASH_TEST_CHILD") != "1" {
		return
	}
	die := func() { os.Exit(51) }
	root := os.Getenv("HOOSHIX_WSLFS_LINUX_CRASH_TEST_ROOT")
	if !strings.HasPrefix(root, "/tmp/hooshix-wslfs-e2e-workspace-") ||
		path.Clean(root) != root || strings.Contains(root, "..") {
		die()
	}
	dec := json.NewDecoder(io.LimitReader(os.Stdin, MaxRequestBytes+1))
	dec.DisallowUnknownFields()
	var request Request
	if err := dec.Decode(&request); err != nil {
		die()
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); err != io.EOF {
		die()
	}
	if request.Operation != "git_commit" {
		// Probe and all read-only test requests execute through the same
		// production Run dispatcher; exit directly so go test won't append
		// "PASS" to its stdout after the one JSON response.
		_ = json.NewEncoder(os.Stdout).Encode(Run(root, request))
		os.Exit(0)
	}
	if request.Version != 1 || request.Path != "." || len(request.Paths) != 0 ||
		request.IncludeSHA256 || request.ExpectedSHA256 != "" ||
		request.RestoredSHA256 != "" || !gitCommitRequestID.MatchString(request.Query) {
		_ = json.NewEncoder(os.Stdout).Encode(Err("invalid_wslgit_commit_crash_test_request"))
		os.Exit(0)
	}
	opened, err := os.OpenRoot(root)
	if err != nil {
		die()
	}
	defer opened.Close()
	result, err := secureRootGitCommitWithPostCAS(opened, request.Content, request.Query,
		func(string) error {
			// This executes strictly AFTER durable Git update-ref CAS. No success
			// response is written to stdout. wsl.exe must observe a dead child.
			if killErr := unix.Kill(os.Getpid(), unix.SIGKILL); killErr != nil {
				return killErr
			}
			return errors.New("SIGKILL unexpectedly returned")
		})
	if err != nil && result.OK {
		die()
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
	os.Exit(0)
}
