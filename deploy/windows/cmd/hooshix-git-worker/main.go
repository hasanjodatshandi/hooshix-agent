//go:build windows

// hooshix-git-worker runs in the repository owner's own Windows session.
// It is never launched as an administrator or a Windows service.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/gitworker"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
)

// decodeWSLFSRequest accepts one bounded JSON frame. Future mutation payloads
// use stdin rather than Windows argv, which has a much smaller size limit.
// Never accept trailing JSON frames or unknown fields from an untrusted caller.
func decodeWSLFSRequest(fromStdin bool, encoded string, source io.Reader) (wslfs.Request, error) {
	var req wslfs.Request
	var raw []byte
	var err error
	if fromStdin {
		raw, err = io.ReadAll(io.LimitReader(source, wslfs.MaxRequestBytes+1))
		if err != nil || len(raw) > wslfs.MaxRequestBytes {
			return req, fmt.Errorf("wslfs_input_size_or_read_failure")
		}
	} else {
		raw, err = base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(raw) > 8192 {
			return req, fmt.Errorf("wslfs_invalid_b64_input")
		}
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return req, err
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); err != io.EOF {
		return req, fmt.Errorf("wslfs_extra_frame_or_invalid_trailer")
	}
	return req, nil
}

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	options := flag.NewFlagSet("hooshix-git-worker", flag.ContinueOnError)
	options.SetOutput(os.Stderr)
	mode := options.String("mode", "", "worker, proxy, enroll, unenroll or wsl-worker|wsl-proxy|wsl-enroll|wsl-unenroll")
	distro := options.String("distro", "", "registered WSL distribution name")
	linuxRoot := options.String("linux-root", "", "absolute Linux working directory pinned by WSL owner")
	wslCommand := options.String("wsl-command", "", "shell command passed only through opted-in WSL worker proxy")
	fsBroker := options.String("fs-broker", "", "Linux executable path selected by signed-in owner for confined file tools")
	fsRequest := options.String("fs-request-b64", "", "Base64 JSON request for authenticated WSL filesystem proxy")
	fsStdin := options.Bool("fs-stdin", false, "Accept a bounded WSLFS JSON request over stdin for large contents")
	root := options.String("root", "", "approved absolute repository root")
	tool := options.String("tool", "", "specific governed Git tool (proxy only)")
	if e := options.Parse(args); e != nil {
		return 2
	}
	if *root == "" {
		fmt.Fprintln(os.Stderr, "-root required")
		return 2
	}
	switch *mode {
	case "wslfs-enroll":
		if *distro == "" || *linuxRoot == "" || *fsBroker == "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.EnrollWSLFiles(*root, *distro, *linuxRoot, *fsBroker); err != nil {
			fmt.Fprintln(os.Stderr, "WSLFS enrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL native filesystem owner worker enrolled separately")
		return 0
	case "wslfs-unenroll":
		if *distro != "" || *linuxRoot != "" || *fsBroker != "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.UnenrollWSLFiles(*root); err != nil {
			fmt.Fprintln(os.Stderr, "WSLFS revocation:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL native filesystem owner worker revoked")
		return 0
	case "wslfs-worker":
		if *distro == "" || *linuxRoot == "" || *fsBroker == "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.ServeWSLFiles(*root, *distro, *linuxRoot, *fsBroker); err != nil {
			fmt.Fprintln(os.Stderr, "WSLFS owner worker:", err)
			return 1
		}
		return 0
	case "wslfs-proxy":
		if *distro != "" || *linuxRoot != "" || *fsBroker != "" || len(options.Args()) != 0 ||
			*fsStdin == (*fsRequest != "") {
			return 2 // exactly one of stdin or base64 request is required
		}
		req, err := decodeWSLFSRequest(*fsStdin, *fsRequest, os.Stdin)
		if err != nil {
			_ = json.NewEncoder(os.Stdout).Encode(wslfs.Err("invalid_wslfs_json"))
			return 0
		}
		result, err := gitworker.ProxyWSLFiles(*root, req)
		if err != nil {
			result = wslfs.Err("wslfs_owner_worker_unavailable")
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return 0
	case "wslfs-write-enroll":
		if *distro == "" || *linuxRoot == "" || *fsBroker == "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.EnrollWSLFileWrites(*root, *distro, *linuxRoot, *fsBroker); err != nil {
			fmt.Fprintln(os.Stderr, "WSLFS enrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL native filesystem WRITE owner worker enrolled separately")
		return 0
	case "wslfs-write-unenroll":
		if *distro != "" || *linuxRoot != "" || *fsBroker != "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.UnenrollWSLFileWrites(*root); err != nil {
			fmt.Fprintln(os.Stderr, "WSLFS revocation:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL native filesystem WRITE owner worker revoked")
		return 0
	case "wslfs-write-worker":
		if *distro == "" || *linuxRoot == "" || *fsBroker == "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.ServeWSLFileWrites(*root, *distro, *linuxRoot, *fsBroker); err != nil {
			fmt.Fprintln(os.Stderr, "WSLFS WRITE owner worker:", err)
			return 1
		}
		return 0
	case "wslfs-write-proxy":
		if *distro == "" || *linuxRoot == "" || *fsBroker != "" || len(options.Args()) != 0 ||
			*fsStdin == (*fsRequest != "") {
			return 2 // exactly one of stdin or base64 request is required
		}
		req, err := decodeWSLFSRequest(*fsStdin, *fsRequest, os.Stdin)
		if err != nil {
			_ = json.NewEncoder(os.Stdout).Encode(wslfs.Err("invalid_wslfs_json"))
			return 0
		}
		result, err := gitworker.ProxyWSLFileWritesBound(*root, req, *distro, *linuxRoot)
		if err != nil {
			result = wslfs.Err("wslfs_owner_worker_unavailable")
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return 0
	case "wslgit-write-enroll":
		if *distro == "" || *linuxRoot == "" || *fsBroker == "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.EnrollWSLGitWrites(*root, *distro, *linuxRoot, *fsBroker); err != nil {
			fmt.Fprintln(os.Stderr, "WSLGit enrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL native Git WRITE owner worker enrolled separately")
		return 0
	case "wslgit-write-unenroll":
		if *distro != "" || *linuxRoot != "" || *fsBroker != "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.UnenrollWSLGitWrites(*root); err != nil {
			fmt.Fprintln(os.Stderr, "WSLGit revocation:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL native Git WRITE owner worker revoked")
		return 0
	case "wslgit-write-worker":
		if *distro == "" || *linuxRoot == "" || *fsBroker == "" || *fsRequest != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.ServeWSLGitWrites(*root, *distro, *linuxRoot, *fsBroker); err != nil {
			fmt.Fprintln(os.Stderr, "WSLGit WRITE owner worker:", err)
			return 1
		}
		return 0
	case "wslgit-write-proxy":
		if *distro == "" || *linuxRoot == "" || *fsBroker != "" || len(options.Args()) != 0 ||
			*fsStdin == (*fsRequest != "") {
			return 2 // exactly one of stdin or base64 request is required
		}
		req, err := decodeWSLFSRequest(*fsStdin, *fsRequest, os.Stdin)
		if err != nil {
			_ = json.NewEncoder(os.Stdout).Encode(wslfs.Err("invalid_wslfs_json"))
			return 0
		}
		result, err := gitworker.ProxyWSLGitWriteBound(*root, req, *distro, *linuxRoot)
		if err != nil {
			result = wslfs.Err("wslfs_owner_worker_unavailable")
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return 0
	case "wsl-enroll":
		if *distro == "" || *linuxRoot == "" || *wslCommand != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.EnrollWSL(*root, *distro, *linuxRoot); err != nil {
			fmt.Fprintln(os.Stderr, "WSL enrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL owner worker enrolled for this Windows user and Linux root")
		return 0
	case "wsl-unenroll":
		if *distro != "" || *linuxRoot != "" || *wslCommand != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.UnenrollWSL(*root); err != nil {
			fmt.Fprintln(os.Stderr, "WSL unenrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "WSL owner worker revoked")
		return 0
	case "wsl-worker":
		if *distro == "" || *linuxRoot == "" || *wslCommand != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.ServeWSL(*root, *distro, *linuxRoot); err != nil {
			fmt.Fprintln(os.Stderr, "WSL owner worker:", err)
			return 1
		}
		return 0
	case "wsl-proxy":
		if *wslCommand == "" || *distro != "" || *linuxRoot != "" || len(options.Args()) != 0 {
			return 2
		}
		result, err := gitworker.ProxyWSL(*root, *wslCommand)
		if err != nil {
			result = gitworker.Response{ExitCode: 126, Stderr: err.Error()}
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return 0
	case "enroll":
		if *tool != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.Enroll(*root); err != nil {
			fmt.Fprintln(os.Stderr, "Git enrollment:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "owner Git worker enrolled for current Windows user")
		return 0
	case "unenroll":
		if *tool != "" || len(options.Args()) != 0 {
			return 2
		}
		if err := gitworker.Unenroll(*root); err != nil {
			fmt.Fprintln(os.Stderr, "Git revocation:", err)
			return 1
		}
		fmt.Fprintln(os.Stdout, "owner Git worker startup entry revoked")
		return 0
	case "worker":
		if *tool != "" || len(options.Args()) != 0 {
			fmt.Fprintln(os.Stderr, "worker mode does not accept Git arguments")
			return 2
		}
		if e := gitworker.Serve(*root); e != nil {
			fmt.Fprintln(os.Stderr, "Git worker:", e)
			return 1
		}
		return 0
	case "proxy":
		if *tool == "" {
			fmt.Fprintln(os.Stderr, "proxy requires -tool")
			return 2
		}
		response, e := gitworker.Proxy(*root, *tool, options.Args())
		if e != nil {
			result := gitworker.Response{ExitCode: 126, Stderr: e.Error()}
			_ = json.NewEncoder(os.Stdout).Encode(result)
			return 0
		}
		_ = json.NewEncoder(os.Stdout).Encode(response)
		return 0
	default:
		fmt.Fprintln(os.Stderr, "-mode worker|proxy|enroll|unenroll is required")
		return 2
	}
}
