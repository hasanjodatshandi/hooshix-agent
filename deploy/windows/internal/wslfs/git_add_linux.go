//go:build linux

package wslfs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// Git staging is limited to already-present regular files. We read each
// selected inode through Linux openat2, then use Git plumbing with content
// delivered over stdin. Unlike "git add", this does not run repository
// clean/smudge filters, fsmonitor, or select files by Git pathspec expansion.
// Deletions, recursive directories, submodules, and symlinks are unsupported.
var gitObjectID = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

func checkGitIndexAndObjects(root *os.Root) error {
	if err := validatePinnedGitBranchMetadata(root, "hooshix-check"); err != nil {
		return err
	}
	for _, rel := range []string{".git/objects", ".git/objects/info", ".git/objects/pack"} {
		st, err := root.Lstat(rel)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !st.IsDir() {
			return errors.New("git object directory redirected")
		}
		opened, e := secureRootOpen(root, rel)
		if e != nil {
			return e
		}
		opened.Close()
	}
	// A pre-existing index.lock is owned by another Git writer (or is a
	// deliberately retained crash marker). Never race it or remove it.
	if _, err := root.Lstat(".git/index.lock"); err == nil {
		return errors.New("git index busy: existing index.lock")
	} else if !os.IsNotExist(err) {
		return err
	}
	for _, rel := range []string{".git/index"} {
		st, err := root.Lstat(rel)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !st.Mode().IsRegular() {
			return errors.New("git index path redirected")
		}
		opened, e := secureRootOpen(root, rel)
		if e != nil {
			return e
		}
		opened.Close()
	}
	return nil
}

func runPinnedGit(rootFD *os.File, args []string, input []byte) ([]byte, error) {
	pinned := fmt.Sprintf("/proc/%d/fd/%d", os.Getpid(), rootFD.Fd())
	prefix := []string{
		"-c", "core.worktree=" + pinned,
		"-c", "core.bare=false",
		"-c", "core.hooksPath=/dev/null",
		"-c", "core.fsmonitor=false",
		"-c", "core.sparseCheckout=false",
		"-c", "core.splitIndex=false",
		"-c", "core.attributesFile=/dev/null",
		"-c", "protocol.allow=never",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/git", append(prefix, args...)...)
	cmd.Dir = pinned
	cmd.Stdin = bytes.NewReader(input)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "LANG=C.UTF-8",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "GIT_PAGER=cat",
		"GIT_EXTERNAL_DIFF=", "GIT_NO_REPLACE_OBJECTS=1",
	}
	var out, errout limitedGitCapture
	cmd.Stdout = &out
	cmd.Stderr = &errout
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, errors.New("git_outcome_unknown_timeout")
	}
	if out.exceeded || errout.exceeded {
		return nil, errors.New("git_output_limit")
	}
	if err != nil {
		return nil, fmt.Errorf("git_operation_failed_or_unknown: %w", err)
	}
	return out.buf, nil
}
func secureRootGitAdd(root *os.Root, selected []string) (Response, error) {
	if len(selected) < 1 || len(selected) > 100 {
		return Err("wslgit_invalid_add_paths"), errors.New("invalid path count")
	}
	if err := checkGitIndexAndObjects(root); err != nil {
		return Err("wslgit_unsafe_git_metadata"), err
	}
	dir, err := secureRootOpen(root, ".")
	if err != nil {
		return Err("wslgit_workspace_unavailable"), err
	}
	defer dir.Close()
	type staged struct {
		rel, mode string
		content   []byte
	}
	pending := make([]staged, 0, len(selected))
	seen := make(map[string]bool, len(selected))
	var total int64
	for _, entry := range selected {
		rel, e := SafeFilePath(entry)
		if e != nil || rel == "." || strings.HasPrefix(rel, "-") ||
			strings.ContainsAny(rel, "*?[]") || strings.HasPrefix(rel, ":") || seen[rel] {
			return Err("wslgit_invalid_add_path"), errors.New("invalid or duplicate path")
		}
		seen[rel] = true
		file, e := secureRootOpen(root, rel)
		if e != nil {
			return Err("wslgit_add_file_unavailable"), e
		}
		info, e := file.Stat()
		if e != nil || !info.Mode().IsRegular() || info.Size() > MaxFileBytes {
			file.Close()
			return Err("wslgit_add_file_not_regular_or_too_large"), errors.New("invalid regular file")
		}
		// Detect in-place writes while the source inode is being copied. An
		// inode equality check alone misses truncate/rewrite races.
		var before unix.Stat_t
		if e = unix.Fstat(int(file.Fd()), &before); e != nil {
			file.Close()
			return Err("wslgit_add_file_stat_failed"), e
		}
		b, e := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
		var pinned unix.Stat_t
		if e == nil {
			e = unix.Fstat(int(file.Fd()), &pinned)
		}
		file.Close()
		if e != nil || int64(len(b)) > MaxFileBytes {
			return Err("wslgit_add_file_unreadable"), errors.New("read failed")
		}
		if before.Dev != pinned.Dev || before.Ino != pinned.Ino ||
			before.Size != pinned.Size || before.Mtim != pinned.Mtim ||
			before.Ctim != pinned.Ctim || before.Mode != pinned.Mode ||
			int64(len(b)) != pinned.Size {
			return Err("wslgit_add_source_changed_during_read"), errors.New("source inode modified while staged")
		}
		parent, e := secureRootOpen(root, path.Dir(rel))
		if e != nil {
			return Err("wslgit_add_parent_unavailable"), e
		}
		var named unix.Stat_t
		e = unix.Fstatat(int(parent.Fd()), path.Base(rel), &named, unix.AT_SYMLINK_NOFOLLOW)
		parent.Close()
		if e != nil || pinned.Ino != named.Ino || pinned.Dev != named.Dev ||
			pinned.Size != named.Size || pinned.Mtim != named.Mtim ||
			pinned.Ctim != named.Ctim || pinned.Mode != named.Mode ||
			named.Mode&unix.S_IFMT != unix.S_IFREG {
			return Err("wslgit_add_inode_changed"), errors.New("file changed while reading")
		}
		total += int64(len(b))
		if total > MaxFileBytes {
			return Err("wslgit_add_total_size_limit"), errors.New("total staging size limit")
		}
		mode := "100644"
		if info.Mode()&0111 != 0 {
			mode = "100755"
		}
		pending = append(pending, staged{rel: rel, mode: mode, content: b})
	}
	// Do not write any object until all requested paths are validated.
	var index bytes.Buffer
	for _, file := range pending {
		oid, err := runPinnedGit(dir, []string{"hash-object", "--stdin"}, file.content)
		if err != nil {
			return Err("wslgit_hash_failed"), err
		}
		sha := strings.TrimSpace(string(oid))
		if !gitObjectID.MatchString(sha) {
			return Err("wslgit_invalid_object_id"), errors.New("unexpected Git oid")
		}
		// Reject externally redirected loose-object buckets before -w.
		bucket := ".git/objects/" + sha[:2]
		st, e := root.Lstat(bucket)
		if e != nil && !os.IsNotExist(e) {
			return Err("wslgit_object_bucket_unavailable"), e
		}
		if e == nil {
			if !st.IsDir() {
				return Err("wslgit_object_bucket_redirected"), errors.New("object bucket not directory")
			}
			d, e := secureRootOpen(root, bucket)
			if e != nil {
				return Err("wslgit_object_bucket_unavailable"), e
			}
			d.Close()
		}
		written, err := runPinnedGit(dir, []string{"hash-object", "-w", "--stdin"}, file.content)
		if err != nil {
			return Err("wslgit_object_write_unknown"), err
		}
		if strings.TrimSpace(string(written)) != sha {
			return Err("wslgit_object_digest_mismatch"), errors.New("written Git OID changed")
		}
		index.WriteString(file.mode + " " + sha + "\t" + file.rel)
		index.WriteByte(0)
	}
	if _, err := runPinnedGit(dir, []string{"update-index", "-z", "--index-info"}, index.Bytes()); err != nil {
		return Err("wslgit_index_update_unknown"), err
	}
	return Response{OK: true, GitStdout: fmt.Sprintf("staged %d file(s)", len(pending)), StagedFiles: len(pending)}, nil
}
