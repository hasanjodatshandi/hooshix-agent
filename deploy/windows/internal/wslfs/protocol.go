// Package wslfs provides an OS-root-confined filesystem protocol executed
// inside the selected WSL distribution with that distribution's Linux UID.
//
// It does not run shell commands, and the Windows LocalSystem service never
// reads the Linux filesystem directly.
package wslfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf8"
)

const MaxFileBytes int64 = 1024 * 1024
const MaxRequestBytes = 2 * 1024 * 1024
const MaxEntries = 5000
const MaxSearchFiles = 10000
const MaxSearchMatches = 1000
const MaxSearchLine = 512

type Request struct {
	Version        int      `json:"version"`
	Operation      string   `json:"operation"`
	Path           string   `json:"path"`
	Query          string   `json:"query,omitempty"`
	Paths          []string `json:"paths,omitempty"`
	IncludeSHA256  bool     `json:"includeSha256,omitempty"`
	Content        string   `json:"content,omitempty"`
	ExpectedSHA256 string   `json:"expectedSha256,omitempty"`
	RestoredSHA256 string   `json:"restoredSha256,omitempty"`
}
type Match struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}
type Entry struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type Response struct {
	OK                  bool     `json:"ok"`
	Error               string   `json:"error,omitempty"`
	Content             string   `json:"content"`
	SHA256              string   `json:"sha256,omitempty"`
	Created             bool     `json:"created,omitempty"`
	Restored            bool     `json:"restored,omitempty"`
	State               string   `json:"state,omitempty"`
	GitStdout           string   `json:"gitStdout"`
	GitStderr           string   `json:"gitStderr,omitempty"`
	StagedFiles         int      `json:"stagedFiles,omitempty"`
	ReplacedOccurrences int      `json:"replacedOccurrences,omitempty"`
	Entries             []string `json:"entries"`
	DetailedEntries     []Entry  `json:"detailedEntries"`
	Matches             []Match  `json:"matches"`
	Truncated           bool     `json:"truncated,omitempty"`
	Distro              string   `json:"distro,omitempty"`
	LinuxRoot           string   `json:"linuxRoot,omitempty"`
}

func Err(code string) Response { return Response{Error: code} }

// Restricted paths are relative to the *enrolled* Linux workspace; callers
// cannot select a different root, absolute path, parent or Windows path.
func SafePath(input string) (string, error) {
	if len(input) > 2048 || strings.ContainsAny(input, "\\:\x00\r\n") ||
		strings.HasPrefix(input, "/") || input == "" && input != "." {
		return "", errors.New("invalid_workspace_relative_path")
	}
	if input == "." || input == "" {
		return ".", nil
	}
	for _, part := range strings.Split(input, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("invalid_workspace_relative_path")
		}
	}
	return input, nil
}
func sensitive(name string) bool {
	base := path.Base(strings.ToLower(name))
	if strings.HasPrefix(base, ".hooshix-wsl-stage-") || strings.HasPrefix(base, ".hooshix-wsl-deleted-") {
		return true
	}
	switch base {
	case ".env", ".env.local", ".env.production", ".git-credentials", ".npmrc",
		".pypirc", ".netrc", ".htpasswd", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials", "credentials.json",
		"secrets.json", "secrets.yaml", "secrets.yml", ".token", ".ssh", ".gnupg", ".aws", ".azure", ".git", "node_modules", "dist", "coverage", "logs", "data":
		return true
	}
	if strings.HasSuffix(base, ".pem") || strings.HasSuffix(base, ".key") ||
		strings.HasSuffix(base, ".p12") || strings.HasSuffix(base, ".pfx") || strings.HasSuffix(base, ".kdbx") ||
		strings.HasSuffix(base, ".token") || strings.HasSuffix(base, ".secret") ||
		strings.HasPrefix(base, ".env.") {
		return true
	}
	return false
}
func SafeFilePath(name string) (string, error) {
	rel, err := SafePath(name)
	if err != nil {
		return "", err
	}
	for _, part := range strings.Split(rel, "/") {
		if sensitive(part) {
			return "", errors.New("sensitive_path_denied")
		}
	}
	return rel, nil
}
func Run(root string, req Request) Response {
	if req.Version != 1 {
		return Err("unsupported_wslfs_protocol")
	}
	rel, err := SafePath(req.Path)
	if err != nil {
		return Err("invalid_workspace_relative_path")
	}
	// Reject a root whose name resolves through symlinks. The user's
	// enrollment grants one exact Linux directory; a link to some other
	// directory must not silently extend that authority.
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return Err("wsl_workspace_root_invalid")
	}
	canonical, err := filepath.EvalSymlinks(root)
	if runtime.GOOS == "linux" && (err != nil || canonical != root) {
		return Err("wsl_workspace_root_not_canonical")
	}
	// A rooted filesystem descriptor enforces traversal confinement, including
	// ancestor swaps and symlinks escaping the root (unlike string prefix checks).
	opened, err := os.OpenRoot(root)
	if err != nil {
		return Err("wsl_workspace_root_unavailable")
	}
	defer opened.Close()
	// A request to the broker never grants itself authority: the separate
	// Windows owner-session worker must authorize any new operation first.
	// The Linux side also rejects malformed writes and sensitive targets.
	if req.Operation != "create" && req.Operation != "restore_deleted" && req.Operation != "write_existing" && req.Operation != "modify_existing" && req.Operation != "restore_modified" && req.Operation != "git_commit" && req.Content != "" {
		return Err("unexpected_wslfs_content")
	}
	if req.Operation != "restore_deleted" && req.Operation != "write_existing" && req.Operation != "modify_existing" && req.Operation != "delete_existing" && req.Operation != "restore_modified" && req.Operation != "restore_created" && req.ExpectedSHA256 != "" {
		return Err("unexpected_wslfs_precondition")
	}
	if req.Operation != "restore_modified" && req.RestoredSHA256 != "" {
		return Err("unexpected_restore_digest")
	}
	if req.Operation != "git_add" && len(req.Paths) != 0 {
		return Err("unexpected_wslgit_paths")
	}
	switch req.Operation {
	case "git_checkout":
		if rel != "." || req.Content != "" || req.IncludeSHA256 || len(req.Paths) != 0 ||
			req.ExpectedSHA256 != "" || req.RestoredSHA256 != "" {
			return Err("invalid_wslgit_checkout_request")
		}
		result, e := secureRootGitCheckout(opened, req.Query)
		if e != nil {
			return result
		}
		return result
	case "git_commit_reconcile":
		if rel != "." || req.Content != "" || len(req.Paths) != 0 ||
			req.IncludeSHA256 || req.ExpectedSHA256 != "" || req.RestoredSHA256 != "" {
			return Err("invalid_wslgit_commit_reconcile_request")
		}
		result, e := secureRootGitCommitReconcile(opened, req.Query)
		if e != nil {
			return result
		}
		return result
	case "git_commit":
		if rel != "." || len(req.Paths) != 0 || req.IncludeSHA256 ||
			req.ExpectedSHA256 != "" || req.RestoredSHA256 != "" {
			return Err("invalid_wslgit_commit_request")
		}
		result, e := secureRootGitCommitWithPostCAS(opened, req.Content, req.Query, nil)
		if e != nil {
			return result
		}
		return result
	case "git_add":
		if rel != "." || req.Query != "" || req.Content != "" || req.IncludeSHA256 ||
			req.ExpectedSHA256 != "" || req.RestoredSHA256 != "" {
			return Err("invalid_wslgit_add_request")
		}
		result, e := secureRootGitAdd(opened, req.Paths)
		if e != nil {
			return result
		}
		return result
	case "git_branch":
		if rel != "." || req.Content != "" || req.IncludeSHA256 || req.ExpectedSHA256 != "" ||
			req.RestoredSHA256 != "" {
			return Err("invalid_wslgit_branch_request")
		}
		result, e := secureRootGitCreateBranch(opened, req.Query)
		if e != nil {
			return result
		}
		return result
	case "git_status", "git_diff", "git_log":
		if rel != "." || req.Content != "" || req.IncludeSHA256 || req.ExpectedSHA256 != "" || req.RestoredSHA256 != "" {
			return Err("invalid_wslgit_request")
		}
		result, e := secureRootGitRead(opened, req.Operation, req.Query)
		if e != nil {
			return result
		}
		return result
	case "stat":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 || req.Content != "" || req.ExpectedSHA256 != "" {
			return Err("invalid_stat_request")
		}
		state, digest, e := secureRootStat(opened, rel)
		if e != nil {
			return Err("stat_target_unavailable_or_changed")
		}
		return Response{OK: true, State: state, SHA256: digest}
	case "restore_created":
		// Undo creation only if the current bytes still equal the observed
		// post-create revision. A later modification is never removed.
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 || req.Content != "" ||
			len(req.ExpectedSHA256) != 64 {
			return Err("invalid_restore_request")
		}
		if err := secureRootDeleteExisting(opened, rel, req.ExpectedSHA256); err != nil {
			return Err("restore_revision_conflict_or_unknown")
		}
		return Response{OK: true, Restored: true}
	case "delete_existing":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 || req.Content != "" || len(req.ExpectedSHA256) != 64 {
			return Err("invalid_delete_request")
		}
		if err := secureRootDeleteExisting(opened, rel, req.ExpectedSHA256); err != nil {
			return Err("delete_revision_conflict_or_unknown")
		}
		return Response{OK: true}
	case "restore_modified":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 || len(req.ExpectedSHA256) != 64 {
			return Err("invalid_restore_request")
		}
		data := []byte(req.Content)
		if int64(len(data)) > MaxFileBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return Err("invalid_restore_content")
		}
		sum := sha256.Sum256(data)
		digest := hex.EncodeToString(sum[:])
		if req.RestoredSHA256 != digest {
			return Err("restore_backup_integrity_failure")
		}
		if err := secureRootReplaceExisting(opened, rel, data, req.ExpectedSHA256); err != nil {
			return Err("restore_revision_conflict_or_unknown")
		}
		return Response{OK: true, Restored: true, SHA256: digest}
	case "modify_existing":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query == "" || len(req.Query) > 256 || req.IncludeSHA256 || len(req.ExpectedSHA256) != 64 {
			return Err("invalid_modify_request")
		}
		if int64(len(req.Content)) > MaxFileBytes || !utf8.ValidString(req.Content) || strings.ContainsRune(req.Content, 0) {
			return Err("invalid_modify_replacement")
		}
		file, e := secureRootOpen(opened, rel)
		if e != nil {
			return Err("file_unavailable")
		}
		info, e := file.Stat()
		if e != nil || !info.Mode().IsRegular() || info.Size() > MaxFileBytes {
			file.Close()
			return Err("modify_target_unavailable")
		}
		before, e := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
		file.Close()
		if e != nil || int64(len(before)) > MaxFileBytes || !utf8.Valid(before) || bytes.IndexByte(before, 0) >= 0 {
			return Err("modify_target_not_utf8")
		}
		oldHash := sha256.Sum256(before)
		if hex.EncodeToString(oldHash[:]) != req.ExpectedSHA256 {
			return Err("stale_modify_revision_conflict")
		}
		count := strings.Count(string(before), req.Query)
		if count == 0 {
			return Err("modify_text_not_found")
		}
		updated := []byte(strings.ReplaceAll(string(before), req.Query, req.Content))
		if int64(len(updated)) > MaxFileBytes {
			return Err("modified_file_size_limit")
		}
		if err := secureRootReplaceExisting(opened, rel, updated, req.ExpectedSHA256); err != nil {
			return Err("modify_revision_conflict_or_unknown")
		}
		sha := sha256.Sum256(updated)
		return Response{OK: true, SHA256: hex.EncodeToString(sha[:]), ReplacedOccurrences: count}
	case "write_existing":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 {
			return Err("invalid_write_request")
		}
		data := []byte(req.Content)
		if int64(len(data)) > MaxFileBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return Err("invalid_write_content")
		}
		if err := secureRootReplaceExisting(opened, rel, data, req.ExpectedSHA256); err != nil {
			return Err("write_revision_conflict_or_unknown")
		}
		sum := sha256.Sum256(data)
		return Response{OK: true, SHA256: hex.EncodeToString(sum[:])}
	case "restore_deleted":
		// Recreate only a file whose documented post-mutation state is ABSENT.
		// This is the safe no-clobber subset of restore. Existing targets,
		// including symlinks or a concurrent create, are always preserved.
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 {
			return Err("invalid_restore_request")
		}
		data := []byte(req.Content)
		if int64(len(data)) > MaxFileBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return Err("invalid_restore_content")
		}
		sum := sha256.Sum256(data)
		digest := hex.EncodeToString(sum[:])
		if len(req.ExpectedSHA256) != 64 || digest != req.ExpectedSHA256 {
			return Err("restore_backup_integrity_failure")
		}
		if err := secureRootCreateAtomic(opened, rel, data); err != nil {
			return Err("restore_revision_conflict_or_unknown")
		}
		return Response{OK: true, Created: true, Restored: true, SHA256: digest}
	case "create":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		if rel == "." || req.Query != "" || req.IncludeSHA256 {
			return Err("invalid_create_request")
		}
		data := []byte(req.Content)
		if int64(len(data)) > MaxFileBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return Err("invalid_create_content")
		}
		if err := secureRootCreateAtomic(opened, rel, data); err != nil {
			return Err("create_failed_or_target_exists")
		}
		sum := sha256.Sum256(data)
		return Response{OK: true, Created: true, SHA256: hex.EncodeToString(sum[:])}
	case "probe":
		if rel != "." || req.Query != "" {
			return Err("invalid_probe_request")
		}
		return Response{OK: true}
	case "read":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		f, e := secureRootOpen(opened, rel)
		if e != nil {
			return Err("file_unavailable")
		}
		defer f.Close()
		info, e := f.Stat()
		if e != nil || !info.Mode().IsRegular() {
			return Err("not_regular_file")
		}
		if info.Size() > MaxFileBytes {
			return Err("file_size_limit")
		}
		b, e := io.ReadAll(io.LimitReader(f, MaxFileBytes+1))
		if e != nil {
			return Err("file_read_failed")
		}
		if int64(len(b)) > MaxFileBytes {
			return Err("file_size_limit")
		}
		if !utf8.Valid(b) || bytes.IndexByte(b, 0) >= 0 {
			return Err("not_utf8_text_file")
		}
		out := Response{OK: true, Content: string(b)}
		if req.IncludeSHA256 {
			hash := sha256.Sum256(b)
			out.SHA256 = hex.EncodeToString(hash[:])
		}
		return out
	case "list":
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		f, e := secureRootOpen(opened, rel)
		if e != nil {
			return Err("directory_unavailable")
		}
		defer f.Close()
		info, e := f.Stat()
		if e != nil || !info.IsDir() {
			return Err("not_directory")
		}
		names, e := f.Readdirnames(MaxEntries + 1)
		if e != nil && !errors.Is(e, io.EOF) {
			return Err("directory_read_failed")
		}
		if len(names) > MaxEntries {
			return Err("directory_entry_limit")
		}
		visible := make([]string, 0, len(names))
		details := make([]Entry, 0, len(names))
		for _, n := range names {
			if sensitive(n) {
				continue
			}
			child := path.Join(rel, n)
			info, err := opened.Lstat(child)
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			kind := "file"
			if info.IsDir() {
				kind = "directory"
			}
			if !info.IsDir() && !info.Mode().IsRegular() {
				continue
			}
			visible = append(visible, n)
			details = append(details, Entry{Name: n, Type: kind})
		}
		return Response{OK: true, Entries: visible, DetailedEntries: details}
	case "search":
		if req.Query == "" || len(req.Query) > 256 {
			return Err("invalid_search_query")
		}
		rel, err = SafeFilePath(rel)
		if err != nil {
			return Err(err.Error())
		}
		matches := make([]Match, 0)
		visited := 0
		visitedDirs := 0
		var walk func(string, int) error
		walk = func(dir string, depth int) error {
			visitedDirs++
			if visitedDirs > MaxSearchFiles || depth > 128 {
				return errors.New("search_directory_budget_exceeded")
			}
			if visited >= MaxSearchFiles {
				return errors.New("search_file_budget_exceeded")
			}
			f, e := secureRootOpen(opened, dir)
			if e != nil {
				return nil
			}
			info, e := f.Stat()
			if e != nil {
				f.Close()
				return nil
			}
			if !info.IsDir() {
				f.Close()
				return nil
			}
			names, e := f.Readdirnames(MaxEntries + 1)
			f.Close()
			if e != nil && !errors.Is(e, io.EOF) {
				return errors.New("directory_read_failed")
			}
			if len(names) > MaxEntries {
				return errors.New("directory_entry_limit")
			}
			for _, name := range names {
				if sensitive(name) {
					continue
				}
				child := name
				if dir != "." {
					child = path.Join(dir, name)
				}
				metadata, err := opened.Lstat(child)
				if err != nil || metadata.Mode()&os.ModeSymlink != 0 {
					continue
				}
				if metadata.IsDir() {
					if err = walk(child, depth+1); err != nil {
						return err
					}
					continue
				}
				if !metadata.Mode().IsRegular() || metadata.Size() > MaxFileBytes {
					continue
				}
				visited++
				if visited > MaxSearchFiles {
					return errors.New("search_file_budget_exceeded")
				}
				file, e := secureRootOpen(opened, child)
				if e != nil {
					continue
				}
				safeInfo, e := file.Stat()
				if e != nil || !safeInfo.Mode().IsRegular() || safeInfo.Size() > MaxFileBytes {
					file.Close()
					continue
				}
				b, e := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
				file.Close()
				if e != nil || int64(len(b)) > MaxFileBytes {
					continue
				}
				if !utf8.Valid(b) || bytes.IndexByte(b, 0) >= 0 {
					continue
				}
				for i, line := range strings.Split(string(b), "\n") {
					if strings.Contains(line, req.Query) {
						if len(line) > MaxSearchLine {
							line = line[:MaxSearchLine]
						}
						matches = append(matches, Match{Path: child, Line: i + 1, Text: line})
						if len(matches) >= MaxSearchMatches {
							return errors.New("search_match_limit")
						}
					}
				}
			}
			return nil
		}
		if err = walk(rel, 0); err != nil {
			if strings.Contains(err.Error(), "search_") {
				return Response{OK: true, Matches: matches, Truncated: true}
			}
			return Err("search_failed")
		}
		return Response{OK: true, Matches: matches}
	default:
		return Err("unsupported_wslfs_operation")
	}
}
func Serve(root string, source io.Reader, destination io.Writer) error {
	// A single stdin frame per invocation prevents one request from changing the
	// scope of another; root is supplied only by the pinned owner worker.
	var req Request
	dec := json.NewDecoder(io.LimitReader(source, MaxRequestBytes+1))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return fmt.Errorf("invalid request: %w", err)
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); err != io.EOF {
		return errors.New("wslfs_extra_frame_or_invalid_trailer")
	}
	return json.NewEncoder(destination).Encode(Run(root, req))
}
