// Package gitworker implements a deliberately narrow, opt-in user-session
// Git transport. It never accepts a shell command from the MCP service.
package gitworker

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

const MaxRequestBytes = 8192
const MaxResponseBytes = 2 * 1024 * 1024

// Request is one pre-authorized Git operation, not an arbitrary argv.
type Request struct {
	Version int      `json:"version"`
	Tool    string   `json:"tool"`
	Root    string   `json:"root"`
	Args    []string `json:"args"`
}

type Response struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

func CanonicalRoot(root string) (string, error) {
	if !filepath.IsAbs(root) {
		return "", errors.New("absolute repository root required")
	}
	actual, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve repository: %w", err)
	}
	return filepath.Clean(actual), nil
}

func PipeName(root string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(root))))
	return `\\.\pipe\HooshiXGitWorker-` + hex.EncodeToString(digest[:16])
}

func Validate(req Request, allowedRoot string) error {
	if req.Version != 1 {
		return errors.New("unsupported Git worker protocol")
	}
	canonical, err := CanonicalRoot(req.Root)
	if err != nil {
		return err
	}
	if !strings.EqualFold(canonical, allowedRoot) {
		return errors.New("requested repository differs from worker enrollment")
	}
	a := req.Args
	switch req.Tool {
	case "worker_stop":
		if len(a) == 0 {
			return nil
		}
	case "git_status":
		if exact(a, "status", "--porcelain=v1", "--branch") {
			return nil
		}
	case "git_diff":
		if exact(a, "rev-parse", "--is-inside-work-tree") || exact(a, "diff", "--") || exact(a, "diff", "--cached", "--") {
			return nil
		}
	case "git_log":
		if len(a) == 4 && a[0] == "log" && a[2] == "--oneline" && a[3] == "--decorate" && strings.HasPrefix(a[1], "--max-count=") {
			n := strings.TrimPrefix(a[1], "--max-count=")
			if n != "" && len(n) <= 3 {
				var v int
				if _, e := fmt.Sscanf(n, "%d", &v); e == nil && v >= 1 && v <= 100 {
					return nil
				}
			}
		}
	case "git_add":
		if len(a) >= 3 && a[0] == "add" && a[1] == "--" && len(a) <= 102 && safePathArgs(a[2:]) {
			return nil
		}
	case "git_commit":
		if len(a) == 3 && a[0] == "commit" && a[1] == "-m" && strings.TrimSpace(a[2]) != "" && len(a[2]) <= 500 {
			return nil
		}
	case "git_branch":
		if len(a) == 3 && a[0] == "branch" && a[1] == "--" && validRef(a[2]) {
			return nil
		}
	case "git_checkout":
		if len(a) == 3 && a[0] == "switch" && a[1] == "-c" && validRef(a[2]) {
			return nil
		}
		if len(a) == 2 && a[0] == "switch" && validRef(a[1]) {
			return nil
		}
	}
	return errors.New("Git worker operation or arguments are not authorized")
}
func exact(a []string, expected ...string) bool {
	if len(a) != len(expected) {
		return false
	}
	for i, x := range expected {
		if a[i] != x {
			return false
		}
	}
	return true
}
func validRef(ref string) bool {
	if len(ref) < 1 || len(ref) > 128 || strings.ContainsAny(ref, " \\~^:?*[") ||
		strings.Contains(ref, "..") || strings.Contains(ref, "@{") || strings.HasPrefix(ref, "-") ||
		strings.HasSuffix(ref, ".") || strings.HasSuffix(ref, "/") || strings.Contains(ref, "//") {
		return false
	}
	for _, r := range ref {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '_' || r == '-' || r == '.' || r == '/') {
			return false
		}
	}
	return true
}
func safePathArgs(paths []string) bool {
	for _, p := range paths {
		if p == "" || len(p) > 1024 || filepath.IsAbs(p) || p == ".." || p == "." || strings.HasPrefix(p, "-") ||
			strings.Contains(p, ".."+string(filepath.Separator)) || strings.Contains(p, "../") ||
			strings.Contains(p, "\\..") || strings.Contains(p, ":") || strings.ContainsAny(p, "\n\r\x00") {
			return false
		}
	}
	return true
}
