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
	Version int           `json:"version"`
	Root    string        `json:"root"`
	File    wslfs.Request `json:"file"`
}

func WSLFilePipeName(ownerRoot string) string {
	return strings.Replace(PipeName(ownerRoot), "HooshiXGitWorker-", "HooshiXWSLFSWorker-", 1)
}
func validateFSRequest(r WSLFileRequest, ownerRoot string) error {
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
	switch r.File.Operation {
	case "probe", "read", "list", "search":
		return nil
	default:
		return errors.New("wslfs_unsupported_operation")
	}
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
	pipe, err := windows.UTF16PtrFromString(WSLFilePipeName(canonical))
	if err != nil {
		return err
	}
	handle, err := windows.CreateNamedPipe(pipe, windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
		1, MaxResponseBytes, MaxRequestBytes, 0, &attrs)
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
		func() {
			_ = file.SetDeadline(time.Now().Add(35 * time.Second))
			dec := json.NewDecoder(io.LimitReader(file, MaxRequestBytes+1))
			dec.DisallowUnknownFields()
			var req WSLFileRequest
			if dec.Decode(&req) != nil || validateFSRequest(req, canonical) != nil {
				return
			}
			if req.File.Operation == "probe" && req.File.Path == "." && req.File.Query == "__HOOSHIX_WSLFS_REVOKE__" {
				_ = json.NewEncoder(file).Encode(wslfs.Response{OK: true})
				_ = windows.FlushFileBuffers(handle)
				stop = true
				return
			}
			result := runWSLFileRequest(req, distro, linuxRoot, broker, canonical)
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
	}
}
func runWSLFileRequest(req WSLFileRequest, distro, linuxRoot, broker, ownerRoot string) wslfs.Response {
	if err := validateFSRequest(req, ownerRoot); err != nil {
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
	canonical, err := CanonicalRoot(ownerRoot)
	if err != nil {
		return wslfs.Response{}, err
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		return wslfs.Response{}, err
	}
	req := WSLFileRequest{Version: 1, Root: canonical, File: fileReq}
	if err = validateFSRequest(req, canonical); err != nil {
		return wslfs.Response{}, err
	}
	name, err := windows.UTF16PtrFromString(WSLFilePipeName(canonical))
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