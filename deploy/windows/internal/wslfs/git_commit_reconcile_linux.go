//go:build linux

package wslfs

import (
	"bytes"
	"errors"
	"os"
	"strings"
)

// A read-only reconciliation of a durable, uniquely marked commit. Absence
// within the bounded first-parent history is NEVER proof of non-execution:
// the branch may have moved, been reset or advanced past our read horizon.
// The caller must never automatically retry an ambiguous Git mutation.
func secureRootGitCommitReconcile(root *os.Root, requestID string) (Response, error) {
	if !gitCommitRequestID.MatchString(requestID) {
		return Err("wslgit_commit_reconcile_invalid_request_id"), errors.New("invalid commit request ID")
	}
	if err := validatePinnedGitBranchMetadata(root, "hooshix-check"); err != nil {
		return Err("wslgit_commit_reconcile_unsafe_git_metadata"), err
	}
	cwd, err := secureRootOpen(root, ".")
	if err != nil {
		return Err("wslgit_commit_reconcile_workspace_unavailable"), err
	}
	defer cwd.Close()
	// -z separates records with NUL, and the fixed pretty format separates
	// the OID from message with NUL. No shell, reflog traversal or arbitrary argv.
	out, err := runPinnedGit(cwd, []string{
		"log", "--first-parent", "--max-count=64", "--no-show-signature",
		"-z", "--format=%H%x00%B",
	}, nil)
	if err != nil {
		return Err("wslgit_commit_reconcile_outcome_unknown"), err
	}
	parts := bytes.Split(out, []byte{0})
	trailer := "\nHooshiX-Request-ID: " + requestID
	for i := 0; i+1 < len(parts); i += 2 {
		oid := string(parts[i])
		body := strings.TrimRight(string(parts[i+1]), "\n")
		if !gitObjectID.MatchString(oid) {
			return Err("wslgit_commit_reconcile_bad_history"), errors.New("Git returned invalid object ID")
		}
		// Require the nonce in its own trailing line. The ID is cryptographically
		// unpredictable, unique per mutation attempt and injected by our broker.
		if strings.HasSuffix(body, trailer) {
			return Response{OK: true, State: "applied", GitStdout: oid}, nil
		}
	}
	// The result is unconfirmed, never "not committed".
	return Response{OK: true, State: "unresolved", GitStdout: ""}, nil
}
