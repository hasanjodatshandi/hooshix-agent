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
const MaxEntries = 5000
const MaxSearchFiles = 10000
const MaxSearchMatches = 1000
const MaxSearchLine = 512

type Request struct {
	Version       int    `json:"version"`
	Operation     string `json:"operation"`
	Path          string `json:"path"`
	Query         string `json:"query,omitempty"`
	IncludeSHA256 bool   `json:"includeSha256,omitempty"`
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
	OK              bool     `json:"ok"`
	Error           string   `json:"error,omitempty"`
	Content         string   `json:"content,omitempty"`
	SHA256          string   `json:"sha256,omitempty"`
	Entries         []string `json:"entries,omitempty"`
	DetailedEntries []Entry  `json:"detailedEntries,omitempty"`
	Matches         []Match  `json:"matches,omitempty"`
	Truncated       bool     `json:"truncated,omitempty"`
	Distro          string   `json:"distro,omitempty"`
	LinuxRoot       string   `json:"linuxRoot,omitempty"`
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
	switch req.Operation {
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
		var walk func(string) error
		walk = func(dir string) error {
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
					if err = walk(child); err != nil {
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
		if err = walk(rel); err != nil {
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
	dec := json.NewDecoder(io.LimitReader(source, 8192))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return fmt.Errorf("invalid request: %w", err)
	}
	return json.NewEncoder(destination).Encode(Run(root, req))
}