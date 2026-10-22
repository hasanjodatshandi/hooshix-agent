//go:build windows

package gitworker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path"
	"strings"
	"time"
	"unsafe"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
	"golang.org/x/sys/windows"
)

type WSLFileRequest struct {
	Version           int           `json:"version"`
	Root              string        `json:"root"`
	ExpectedDistro    string        `json:"expectedDistro,omitempty"`
	ExpectedLinuxRoot string        `json:"expectedLinuxRoot,omitempty"`
	File              wslfs.Request `json:"file"`
}

func WSLFilePipeName(ownerRoot string) string {
	return strings.Replace(PipeName(ownerRoot), "HooshiXGitWorker-", "HooshiXWSLFSWorker-", 1)
}
func validateFSRequest(r WSLFileRequest, ownerRoot string) error {
	return validateWSLFileRequest(r, ownerRoot, false)
}

func validateWSLFileRequest(r WSLFileRequest, ownerRoot string, writable bool) error {
	return validateWSLFileRequestPolicy(r, ownerRoot, writable, false)
}
func validateWSLFileRequestPolicy(r WSLFileRequest, ownerRoot string, writable, gitWritable bool) error {
	actual, err := CanonicalRoot(r.Root)
	if err != nil {
		return err
	}
	if r.Version != 1 || !sameSID(strings.ToLower(actual), strings.ToLower(ownerRoot)) || r.File.Version != 1 {
		return errors.New("invalid_wslfs_request")
	}
	if _, err = wslfs.SafePath(r.File.Path); err != nil {
		return err
	}
	if len(r.File.Query) > 256 {
		return errors.New("invalid_search_query")
	}
	if r.File.Operation != "git_add" && len(r.File.Paths) != 0 {
		return errors.New("unexpected_git_paths")
	}
	if r.File.Operation == "git_add" {
		if r.File.Path != "." || r.File.Query != "" || len(r.File.Paths) == 0 || len(r.File.Paths) > 100 {
			return errors.New("invalid_wslgit_add_request")
		}
		seen := make(map[string]bool, len(r.File.Paths))
		for _, selected := range r.File.Paths {
			clean, e := wslfs.SafeFilePath(selected)
			if e != nil || clean == "." || strings.HasPrefix(clean, "-") ||
				strings.ContainsAny(clean, "*?[]") || seen[clean] {
				return errors.New("invalid_wslgit_add_path")
			}
			seen[clean] = true
		}
	}
	if int64(len(r.File.Content)) > wslfs.MaxFileBytes ||
		(r.File.Operation != "create" && r.File.Operation != "write_existing" &&
			r.File.Operation != "modify_existing" && r.File.Operation != "restore_deleted" &&
			r.File.Operation != "restore_modified" && r.File.Operation != "git_commit" && r.File.Content != "") {
		return errors.New("invalid_wslfs_content")
	}
	if r.File.Operation == "git_commit_reconcile" &&
		(r.File.Path != "." || r.File.Content != "" || len(r.File.Paths) != 0 ||
			len(r.File.Query) != 32 || strings.Trim(r.File.Query, "0123456789abcdef") != "") {
		return errors.New("invalid_wslgit_commit_reconcile_request")
	}
	if r.File.Operation == "git_commit" && r.File.Query != "" &&
		(len(r.File.Query) != 32 || strings.Trim(r.File.Query, "0123456789abcdef") != "") {
		return errors.New("invalid_wslgit_commit_request_id")
	}
	if gitWritable {
		if r.File.Operation == "probe" || r.File.Operation == "git_branch" || r.File.Operation == "git_add" || r.File.Operation == "git_commit" || r.File.Operation == "git_checkout" {
			return nil
		}
		return errors.New("wslgit_write_unsupported_operation")
	}
	// The owner write enrollment has a DIFFERENT named pipe and startup
	// registration. Never grant writes through the existing read-only pipe.
	if writable {
		switch r.File.Operation {
		case "probe", "create", "write_existing", "modify_existing", "delete_existing",
			"restore_deleted", "restore_modified", "restore_created":
			return nil
		default:
			return errors.New("wslfs_write_unsupported_operation")
		}
	}
	switch r.File.Operation {
	case "probe", "read", "list", "search", "stat", "git_status", "git_diff", "git_log", "git_commit_reconcile":
		return nil
	default:
		return errors.New("wslfs_unsupported_operation")
	}
}

// Prevent a principal from authorizing one WSL root but inadvertently
// writing through another owner's independently enrolled write worker.
// The exact distro + canonical Linux directory are checked *inside* the
// owner-side worker, not inferred from a client-supplied pipe name.
func validateWSLWriteRootBinding(req WSLFileRequest, distro, linuxRoot string, writable bool) error {
	if !writable || req.File.Operation == "probe" {
		return nil
	}
	if req.ExpectedDistro != distro || req.ExpectedLinuxRoot != linuxRoot {
		return errors.New("wslfs_write_root_binding_mismatch")
	}
	return nil
}

func validateLinuxBroker(p string) error {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || path.Clean(p) != p ||
		strings.ContainsAny(p, "\x00\r\n") || len(p) > 2048 {
		return errors.New("invalid_linux_broker_path")
	}
	return nil
}

// This filesystem pipe is separate from the unrestricted WSL shell pipe.
// A WSL exec enrollment can never implicitly enable workspace file access.
func ServeWSLFiles(ownerRoot, distro, linuxRoot, broker string) error {
	return serveWSLFiles(ownerRoot, distro, linuxRoot, broker, false)
}
func ServeWSLFileWrites(ownerRoot, distro, linuxRoot, broker string) error {
	return serveWSLFiles(ownerRoot, distro, linuxRoot, broker, true)
}
func WSLFileWritePipeName(root string) string {
	return strings.Replace(WSLFilePipeName(root), "HooshiXWSLFSWorker-", "HooshiXWSLFSWriteWorker-", 1)
}
func serveWSLFiles(ownerRoot, distro, linuxRoot, broker string, writable bool) error {
	return serveWSLFilesWithPolicy(ownerRoot, distro, linuxRoot, broker, writable, false)
}
func WSLGitWritePipeName(root string) string {
	return strings.Replace(WSLFilePipeName(root), "HooshiXWSLFSWorker-", "HooshiXWSLGitWriteWorker-", 1)
}
func ServeWSLGitWrites(ownerRoot, distro, linuxRoot, broker string) error {
	return serveWSLFilesWithPolicy(ownerRoot, distro, linuxRoot, broker, false, true)
}
func serveWSLFilesWithPolicy(ownerRoot, distro, linuxRoot, broker string, writable, gitWritable bool) error {
	return serveWSLFilesWithBeforeReply(ownerRoot, distro, linuxRoot, broker, writable, gitWritable, nil)
}

// The optional callback is an in-process test seam. Production always calls
// the wrapper above with nil, and no request, environment variable, or public
// IPC operation can activate it. If the callback returns true, disconnect the
// actual Windows Named Pipe without writing an acknowledgment.
func serveWSLFilesWithBeforeReply(ownerRoot, distro, linuxRoot, broker string, writable, gitWritable bool,
	beforeReply func(WSLFileRequest, wslfs.Response) bool) error {
	if err := ValidateWSLConfig(distro, linuxRoot); err != nil {
		return err
	}
	if err := validateLinuxBroker(broker); err != nil {
		return err
	}
	canonical, err := CanonicalRoot(ownerRoot)
	if err != nil {
		return err
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		return err
	}
	user, err := currentSID()
	if err != nil {
		return err
	}
	if !sameSID(user, owner) || sameSID(user, systemSID) {
		return errors.New("wslfs worker requires the registered Windows directory owner")
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;GA;;;SY)(A;;GA;;;" + user + ")")
	if err != nil {
		return err
	}
	attrs := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	pipeName := WSLFilePipeName(canonical)
	if writable {
		pipeName = WSLFileWritePipeName(canonical)
	}
	if gitWritable {
		pipeName = WSLGitWritePipeName(canonical)
	}
	pipe, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return err
	}
	handle, err := windows.CreateNamedPipe(pipe, windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
		1, MaxResponseBytes, wslfs.MaxRequestBytes, 0, &attrs)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(handle), "owner-wslfs-pipe")
	defer file.Close()
	for {
		err = windows.ConnectNamedPipe(handle, nil)
		if errors.Is(err, windows.ERROR_NO_DATA) {
			_ = windows.DisconnectNamedPipe(handle)
			continue
		}
		if err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
			return err
		}
		stop := false
		dropAcknowledgment := false
		func() {
			_ = file.SetDeadline(time.Now().Add(35 * time.Second))
			dec := json.NewDecoder(io.LimitReader(file, wslfs.MaxRequestBytes+1))
			dec.DisallowUnknownFields()
			var req WSLFileRequest
			if dec.Decode(&req) != nil || validateWSLFileRequestPolicy(req, canonical, writable, gitWritable) != nil {
				return
			}
			if validateWSLWriteRootBinding(req, distro, linuxRoot, writable || gitWritable) != nil {
				_ = json.NewEncoder(file).Encode(wslfs.Err("wslfs_write_root_binding_mismatch"))
				_ = windows.FlushFileBuffers(handle)
				return
			}
			if req.File.Operation == "probe" && req.File.Path == "." && req.File.Query == "__HOOSHIX_WSLFS_REVOKE__" {
				_ = json.NewEncoder(file).Encode(wslfs.Response{OK: true})
				_ = windows.FlushFileBuffers(handle)
				stop = true
				return
			}
			result := runWSLFileRequestWithPolicy(req, distro, linuxRoot, broker, canonical, writable, gitWritable)
			if beforeReply != nil && beforeReply(req, result) {
				dropAcknowledgment = true
				return
			}
			_ = json.NewEncoder(file).Encode(result)
			_ = windows.FlushFileBuffers(handle)
		}()
		err = windows.DisconnectNamedPipe(handle)
		if err != nil && !errors.Is(err, windows.ERROR_PIPE_NOT_CONNECTED) {
			return err
		}
		if stop {
			return nil
		}
		if dropAcknowledgment {
			return errors.New("wslfs_test_post_commit_ack_disconnected")
		}
	}
}
func runWSLFileRequest(req WSLFileRequest, distro, linuxRoot, broker, ownerRoot string) wslfs.Response {
	return runWSLFileRequestWithMode(req, distro, linuxRoot, broker, ownerRoot, false)
}
func runWSLFileRequestWithMode(req WSLFileRequest, distro, linuxRoot, broker, ownerRoot string, writable bool) wslfs.Response {
	return runWSLFileRequestWithPolicy(req, distro, linuxRoot, broker, ownerRoot, writable, false)
}
func runWSLFileRequestWithPolicy(req WSLFileRequest, distro, linuxRoot, broker, ownerRoot string, writable, gitWritable bool) wslfs.Response {
	if err := validateWSLFileRequestPolicy(req, ownerRoot, writable, gitWritable); err != nil {
		return wslfs.Err("wslfs_request_denied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "wsl.exe", "--distribution", distro, "--cd", linuxRoot,
		"--exec", broker, "--root", linuxRoot)
	cmd.Dir = ownerRoot
	cmd.Env = wslChildEnv()
	input, _ := json.Marshal(req.File)
	cmd.Stdin = strings.NewReader(string(input) + "\n")
	stdout := &boundedCapture{max: MaxResponseBytes}
	stderr := &boundedCapture{max: 1024}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return wslfs.Err("wslfs_process_timeout")
	}
	if stdout.overflow || stderr.overflow {
		return wslfs.Err("wslfs_response_size_limit")
	}
	if err != nil {
		return wslfs.Err("wslfs_worker_execution_failed")
	}
	var resp wslfs.Response
	if json.Unmarshal(stdout.bytes, &resp) != nil {
		return wslfs.Err("wslfs_invalid_linux_response")
	}
	if req.File.Operation == "probe" && resp.OK {
		resp.Distro = distro
		resp.LinuxRoot = linuxRoot
	}
	return resp
}
func ProxyWSLFiles(ownerRoot string, fileReq wslfs.Request) (wslfs.Response, error) {
	return proxyWSLFiles(ownerRoot, fileReq, false, "", "")
}

// Enrollment and revocation may use an unbound probe; never a mutation.
func ProxyWSLFileWrites(ownerRoot string, fileReq wslfs.Request) (wslfs.Response, error) {
	if fileReq.Operation != "probe" {
		return wslfs.Response{}, errors.New("wslfs_write_binding_required")
	}
	return proxyWSLFiles(ownerRoot, fileReq, true, "", "")
}
func ProxyWSLFileWritesBound(ownerRoot string, fileReq wslfs.Request, distro, linuxRoot string) (wslfs.Response, error) {
	if fileReq.Operation == "probe" {
		return wslfs.Response{}, errors.New("wslfs_write_mutation_required")
	}
	if err := ValidateWSLConfig(distro, linuxRoot); err != nil {
		return wslfs.Response{}, err
	}
	return proxyWSLFiles(ownerRoot, fileReq, true, distro, linuxRoot)
}
func ProxyWSLGitWriteProbe(ownerRoot string, fileReq wslfs.Request) (wslfs.Response, error) {
	if fileReq.Operation != "probe" {
		return wslfs.Response{}, errors.New("wslgit_probe_only")
	}
	return proxyWSLFilesWithPolicy(ownerRoot, fileReq, false, true, "", "")
}
func ProxyWSLGitWriteBound(ownerRoot string, fileReq wslfs.Request, distro, linuxRoot string) (wslfs.Response, error) {
	if fileReq.Operation != "git_branch" && fileReq.Operation != "git_add" && fileReq.Operation != "git_commit" && fileReq.Operation != "git_checkout" {
		return wslfs.Response{}, errors.New("wslgit_write_operation_denied")
	}
	if err := ValidateWSLConfig(distro, linuxRoot); err != nil {
		return wslfs.Response{}, err
	}
	return proxyWSLFilesWithPolicy(ownerRoot, fileReq, false, true, distro, linuxRoot)
}
func proxyWSLFiles(ownerRoot string, fileReq wslfs.Request, writable bool, expectedDistro, expectedLinuxRoot string) (wslfs.Response, error) {
	return proxyWSLFilesWithPolicy(ownerRoot, fileReq, writable, false, expectedDistro, expectedLinuxRoot)
}
func proxyWSLFilesWithPolicy(ownerRoot string, fileReq wslfs.Request, writable, gitWritable bool, expectedDistro, expectedLinuxRoot string) (wslfs.Response, error) {
	canonical, err := CanonicalRoot(ownerRoot)
	if err != nil {
		return wslfs.Response{}, err
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		return wslfs.Response{}, err
	}
	req := WSLFileRequest{Version: 1, Root: canonical, File: fileReq,
		ExpectedDistro: expectedDistro, ExpectedLinuxRoot: expectedLinuxRoot}
	if b, e := json.Marshal(req); e != nil || len(b) > wslfs.MaxRequestBytes {
		return wslfs.Response{}, errors.New("wslfs_request_size_limit")
	}
	if err = validateWSLFileRequestPolicy(req, canonical, writable, gitWritable); err != nil {
		return wslfs.Response{}, err
	}
	pipeName := WSLFilePipeName(canonical)
	if writable {
		pipeName = WSLFileWritePipeName(canonical)
	}
	if gitWritable {
		pipeName = WSLGitWritePipeName(canonical)
	}
	name, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return wslfs.Response{}, err
	}
	var handle windows.Handle
	for i := 0; i < 20; i++ {
		handle, err = windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil,
			windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL|windows.SECURITY_SQOS_PRESENT|windows.SECURITY_IDENTIFICATION, 0)
		if err == nil {
			break
		}
		if !errors.Is(err, windows.ERROR_PIPE_BUSY) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		return wslfs.Response{}, errors.New("wslfs owner worker unavailable_or_not_enrolled")
	}
	f := os.NewFile(uintptr(handle), "wslfs-proxy")
	defer f.Close()
	var pid uint32
	if err = windows.GetNamedPipeServerProcessId(handle, &pid); err != nil {
		return wslfs.Response{}, err
	}
	sid, err := processSID(pid)
	if err != nil || !sameSID(sid, owner) {
		return wslfs.Response{}, errors.New("wslfs owner SID mismatch")
	}
	_ = f.SetDeadline(time.Now().Add(35 * time.Second))
	if err = json.NewEncoder(f).Encode(req); err != nil {
		return wslfs.Response{}, err
	}
	var result wslfs.Response
	if err = json.NewDecoder(io.LimitReader(f, MaxResponseBytes+1)).Decode(&result); err != nil {
		return wslfs.Response{}, err
	}
	return result, nil
}
