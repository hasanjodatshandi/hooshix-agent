//go:build windows

package gitworker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const systemSID = "S-1-5-18"

func fileOwnerSID(root string) (string, error) {
	sd, err := windows.GetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return "", fmt.Errorf("read repository owner: %w", err)
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return "", err
	}
	return owner.String(), nil
}
func processSID(pid uint32) (string, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	var token windows.Token
	if err = windows.OpenProcessToken(handle, windows.TOKEN_QUERY, &token); err != nil {
		return "", err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", err
	}
	return user.User.Sid.String(), nil
}
func currentSID() (string, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", err
	}
	return user.User.Sid.String(), nil
}
func sameSID(a, b string) bool { return strings.EqualFold(a, b) }

// Serve is intentionally opt-in: launch it interactively in the repository
// owner's logon session. No service is installed and no root is auto-enrolled.
func Serve(root string) error {
	canonical, err := CanonicalRoot(root)
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
	if !sameSID(user, owner) {
		return errors.New("Git worker must be started by the repository owner")
	}
	if sameSID(user, systemSID) {
		return errors.New("Git worker cannot run as LocalSystem")
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;GA;;;SY)(A;;GA;;;" + user + ")")
	if err != nil {
		return err
	}
	attrs := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	name, err := windows.UTF16PtrFromString(PipeName(canonical))
	if err != nil {
		return err
	}
	// Keep one server instance alive across requests: no reconnection race
	// between rev-parse and diff and no unprotected pipe-name takeover window.
	handle, err := windows.CreateNamedPipe(name, windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
		1, MaxResponseBytes, MaxRequestBytes, 0, &attrs)
	if err != nil {
		return fmt.Errorf("create protected Git pipe: %w", err)
	}
	file := os.NewFile(uintptr(handle), "owner-git-pipe")
	defer file.Close()
	for {
		err = windows.ConnectNamedPipe(handle, nil)
		if errors.Is(err, windows.ERROR_NO_DATA) {
			_ = windows.DisconnectNamedPipe(handle)
			continue
		}
		if err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
			return fmt.Errorf("accept Git pipe: %w", err)
		}
		// The DACL admits only the user's SID and SYSTEM. Clients always connect
		// with SecurityIdentification; the worker must not impersonate SYSTEM.
		stopRequested := false
		func() {
			_ = file.SetDeadline(time.Now().Add(25 * time.Second))
			decoder := json.NewDecoder(io.LimitReader(file, MaxRequestBytes+1))
			decoder.DisallowUnknownFields()
			var req Request
			if decoder.Decode(&req) != nil {
				return
			}
			if req.Tool == "worker_stop" {
				if Validate(req, canonical) == nil {
					_ = json.NewEncoder(file).Encode(Response{ExitCode: 0})
					_ = windows.FlushFileBuffers(handle)
					stopRequested = true
				}
				return
			}
			response := execute(req, canonical)
			_ = json.NewEncoder(file).Encode(response)
			_ = windows.FlushFileBuffers(handle)
		}()
		if err = windows.DisconnectNamedPipe(handle); err != nil && !errors.Is(err, windows.ERROR_PIPE_NOT_CONNECTED) {
			return fmt.Errorf("disconnect Git pipe: %w", err)
		}
		if stopRequested {
			return nil
		}
	}
}

// boundedCapture limits memory while Git is still running. Returning len(p)
// prevents a writer error from stalling the Git process's output pipe.
type boundedCapture struct {
	bytes    []byte
	max      int
	overflow bool
}

func (b *boundedCapture) Write(p []byte) (int, error) {
	n := len(p)
	available := b.max - len(b.bytes)
	if available < 0 {
		available = 0
	}
	if available > n {
		available = n
	}
	if available > 0 {
		b.bytes = append(b.bytes, p[:available]...)
	}
	if available < n {
		b.overflow = true
	}
	return n, nil
}
func (b *boundedCapture) String() string { return string(b.bytes) }
func execute(req Request, root string) Response {
	if err := Validate(req, root); err != nil {
		return Response{ExitCode: 126, Stderr: "Git operation denied by owner worker"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "git", req.Args...)
	command.Dir = root
	command.Env = filteredUserEnv()
	stdout := &boundedCapture{max: MaxResponseBytes / 2}
	stderr := &boundedCapture{max: MaxResponseBytes / 2}
	command.Stdout = stdout
	command.Stderr = stderr
	err := command.Run()
	if ctx.Err() != nil {
		return Response{ExitCode: 124, Stderr: "Git operation timed out"}
	}
	if stdout.overflow || stderr.overflow {
		return Response{ExitCode: 125, Stderr: "Git worker output limit exceeded"}
	}
	result := Response{ExitCode: 0, Stdout: stdout.String(), Stderr: stderr.String()}
	if err == nil {
		return result
	}
	if exit, ok := err.(*exec.ExitError); ok {
		result.ExitCode = exit.ExitCode()
	} else {
		result.ExitCode = 127
		result.Stderr = "Git executable unavailable"
	}
	return result
}
func filteredUserEnv() []string {
	allowed := map[string]bool{"PATH": true, "PATHEXT": true, "SYSTEMROOT": true, "SYSTEMDRIVE": true,
		"WINDIR": true, "TEMP": true, "TMP": true, "USERPROFILE": true, "APPDATA": true,
		"LOCALAPPDATA": true, "PROGRAMDATA": true, "COMSPEC": true, "HOME": true}
	env := []string{}
	for _, entry := range os.Environ() {
		key, _, ok := strings.Cut(entry, "=")
		if ok && allowed[strings.ToUpper(key)] {
			env = append(env, entry)
		}
	}
	return append(env, "GIT_TERMINAL_PROMPT=0")
}
func Proxy(root, tool string, args []string) (Response, error) {
	canonical, err := CanonicalRoot(root)
	if err != nil {
		return Response{}, err
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		return Response{}, err
	}
	req := Request{Version: 1, Root: canonical, Tool: tool, Args: args}
	if e := Validate(req, canonical); e != nil {
		return Response{}, e
	}
	pipe, err := windows.UTF16PtrFromString(PipeName(canonical))
	if err != nil {
		return Response{}, err
	}
	var handle windows.Handle
	for attempt := 0; attempt < 20; attempt++ {
		handle, err = windows.CreateFile(pipe, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil,
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
		return Response{}, errors.New("owner Git worker is offline or busy; launch it as repository owner")
	}
	f := os.NewFile(uintptr(handle), "owner-git-proxy")
	defer f.Close()
	var pid uint32
	if err = windows.GetNamedPipeServerProcessId(handle, &pid); err != nil {
		return Response{}, err
	}
	serverSID, err := processSID(pid)
	if err != nil || !sameSID(serverSID, owner) {
		return Response{}, errors.New("Git worker identity does not match repository owner")
	}
	_ = f.SetDeadline(time.Now().Add(23 * time.Second))
	if err = json.NewEncoder(f).Encode(req); err != nil {
		return Response{}, err
	}
	dec := json.NewDecoder(io.LimitReader(f, MaxResponseBytes+1))
	dec.DisallowUnknownFields()
	var resp Response
	if err = dec.Decode(&resp); err != nil {
		return Response{}, err
	}
	if len(resp.Stdout)+len(resp.Stderr) > MaxResponseBytes {
		return Response{}, errors.New("oversized Git worker response")
	}
	return resp, nil
}

// The errors can be interpreted by the CLI without a command-injection-prone shell.
var _ syscall.Errno