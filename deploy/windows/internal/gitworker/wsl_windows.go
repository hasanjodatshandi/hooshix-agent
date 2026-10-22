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
	"path"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// WSL runs under the signed-in Windows owner's token, never LocalSystem.
// It has its own pipe, explicit opt-in and pinned distro/Linux work directory.
type WSLRequest struct {
	Version int    `json:"version"`
	Root    string `json:"root"`
	Command string `json:"command"`
}

func WSLPipeName(root string) string {
	return strings.Replace(PipeName(root), "HooshiXGitWorker-", "HooshiXWSLWorker-", 1)
}

func ValidateWSLConfig(distro, linuxRoot string) error {
	if len(distro) < 1 || len(distro) > 80 || strings.HasPrefix(distro, "-") || distro == "." || distro == ".." {
		return errors.New("invalid WSL distribution")
	}
	for _, c := range distro {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '-' || c == '_' || c == '.') {
			return errors.New("invalid WSL distribution")
		}
	}
	if !strings.HasPrefix(linuxRoot, "/") || path.Clean(linuxRoot) != linuxRoot ||
		strings.HasPrefix(linuxRoot, "//") || strings.ContainsAny(linuxRoot, "\x00\n\r") {
		return errors.New("invalid absolute Linux work directory")
	}
	return nil
}

func validateWSLRequest(req WSLRequest, allowedRoot string) error {
	if req.Version != 1 {
		return errors.New("unsupported WSL protocol")
	}
	canonical, err := CanonicalRoot(req.Root)
	if err != nil {
		return err
	}
	if !sameSID(strings.ToLower(canonical), strings.ToLower(allowedRoot)) {
		return errors.New("WSL Windows anchor root mismatch")
	}
	if len(req.Command) < 1 || len(req.Command) > 6000 || strings.ContainsRune(req.Command, '\x00') {
		return errors.New("invalid or oversized WSL command")
	}
	return nil
}

func wslChildEnv() []string {
	allowed := map[string]bool{
		"PATH": true, "PATHEXT": true, "SYSTEMROOT": true, "SYSTEMDRIVE": true,
		"WINDIR": true, "USERPROFILE": true, "LOCALAPPDATA": true, "APPDATA": true,
		"PROGRAMDATA": true, "TEMP": true, "TMP": true,
	}
	env := []string{}
	for _, item := range os.Environ() {
		key, _, ok := strings.Cut(item, "=")
		if ok && allowed[strings.ToUpper(key)] {
			env = append(env, item)
		}
	}
	return env
}

func executeWSL(req WSLRequest, root, distro, linuxRoot string) Response {
	if validateWSLRequest(req, root) != nil {
		return Response{ExitCode: 126, Stderr: "WSL request rejected"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	// --exec guarantees argv is passed to Linux without a Windows shell.
	// /bin/sh -c is intentional: exec is already a fully unrestricted,
	// separately operator-enabled MCP tool. No WSL permission is inferred
	// from enrolling the Git worker; this distinct WSL worker is opt-in.
	cmd := exec.CommandContext(ctx, "wsl.exe", "--distribution", distro,
		"--cd", linuxRoot, "--exec", "/bin/sh", "-c", req.Command)
	cmd.Dir = root
	cmd.Env = wslChildEnv()
	out := &boundedCapture{max: MaxResponseBytes / 2}
	errOut := &boundedCapture{max: MaxResponseBytes / 2}
	cmd.Stdout = out
	cmd.Stderr = errOut
	err := cmd.Run()
	if ctx.Err() != nil {
		return Response{ExitCode: 124, Stderr: "WSL command timed out"}
	}
	if out.overflow || errOut.overflow {
		return Response{ExitCode: 125, Stderr: "WSL output limit exceeded"}
	}
	res := Response{ExitCode: 0, Stdout: out.String(), Stderr: errOut.String()}
	if err == nil {
		return res
	}
	if exit, ok := err.(*exec.ExitError); ok {
		res.ExitCode = exit.ExitCode()
	} else {
		res.ExitCode = 127
		res.Stderr = "WSL executable unavailable for this Windows user"
	}
	return res
}

// ServeWSL is an explicitly launched, owner-session-only counterpart to Serve.
// The service owns no WSL Linux token and cannot inherit access via Git enrollment.
func ServeWSL(root, distro, linuxRoot string) error {
	if err := ValidateWSLConfig(distro, linuxRoot); err != nil {
		return err
	}
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
	if !sameSID(user, owner) || sameSID(user, systemSID) {
		return errors.New("WSL worker enrollment requires the signed-in Windows directory owner")
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;GA;;;SY)(A;;GA;;;" + user + ")")
	if err != nil {
		return err
	}
	attrs := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	name, err := windows.UTF16PtrFromString(WSLPipeName(canonical))
	if err != nil {
		return err
	}
	handle, err := windows.CreateNamedPipe(name, windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
		1, MaxResponseBytes, MaxRequestBytes, 0, &attrs)
	if err != nil {
		return fmt.Errorf("open WSL user pipe: %w", err)
	}
	file := os.NewFile(uintptr(handle), "owner-wsl-pipe")
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
			_ = file.SetDeadline(time.Now().Add(125 * time.Second))
			dec := json.NewDecoder(io.LimitReader(file, MaxRequestBytes+1))
			dec.DisallowUnknownFields()
			var req WSLRequest
			if dec.Decode(&req) != nil {
				return
			}
			if req.Command == "__HOOSHIX_WSL_STOP__" {
				if validateWSLRequest(req, canonical) == nil {
					_ = json.NewEncoder(file).Encode(Response{ExitCode: 0})
					_ = windows.FlushFileBuffers(handle)
					stop = true
				}
				return
			}
			response := executeWSL(req, canonical, distro, linuxRoot)
			_ = json.NewEncoder(file).Encode(response)
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

func ProxyWSL(root, command string) (Response, error) {
	canonical, err := CanonicalRoot(root)
	if err != nil {
		return Response{}, err
	}
	if err = validateWSLRequest(WSLRequest{Version: 1, Root: canonical, Command: command}, canonical); err != nil {
		return Response{}, err
	}
	owner, err := fileOwnerSID(canonical)
	if err != nil {
		return Response{}, err
	}
	pipe, err := windows.UTF16PtrFromString(WSLPipeName(canonical))
	if err != nil {
		return Response{}, err
	}
	var handle windows.Handle
	for i := 0; i < 20; i++ {
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
		return Response{}, errors.New("user WSL worker is offline or not enrolled")
	}
	file := os.NewFile(uintptr(handle), "wsl-proxy")
	defer file.Close()
	var pid uint32
	if err = windows.GetNamedPipeServerProcessId(handle, &pid); err != nil {
		return Response{}, err
	}
	sid, err := processSID(pid)
	if err != nil || !sameSID(sid, owner) {
		return Response{}, errors.New("WSL worker identity does not match enrolled Windows owner")
	}
	_ = file.SetDeadline(time.Now().Add(130 * time.Second))
	if err = json.NewEncoder(file).Encode(WSLRequest{Version: 1, Root: canonical, Command: command}); err != nil {
		return Response{}, err
	}
	dec := json.NewDecoder(io.LimitReader(file, MaxResponseBytes+1))
	var result Response
	if err = dec.Decode(&result); err != nil {
		return Response{}, err
	}
	if len(result.Stdout)+len(result.Stderr) > MaxResponseBytes {
		return Response{}, errors.New("oversized WSL response")
	}
	return result, nil
}
