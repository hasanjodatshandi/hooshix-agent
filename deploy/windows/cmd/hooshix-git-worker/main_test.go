//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/wslfs"
)

func TestWSLFSStdinTransportAcceptsOneLargeFrame(t *testing.T) {
	original := wslfs.Request{Version: 1, Operation: "create", Path: "src/new.txt", Content: strings.Repeat("a", int(wslfs.MaxFileBytes))}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeWSLFSRequest(true, "", bytes.NewReader(raw))
	if err != nil || got.Content != original.Content || got.Path != original.Path {
		t.Fatalf("large stdin WSLFS payload damaged: size=%d err=%v", len(got.Content), err)
	}
}
func TestWSLFSStdinTransportRejectsOverlongAndMultipleFrames(t *testing.T) {
	for _, payload := range []string{
		strings.Repeat(" ", wslfs.MaxRequestBytes+10),
		"{}{}",
		"{\"version\":1,\"operation\":\"read\",\"path\":\".\",\"unexpected\":true}",
		"not-json",
	} {
		if _, err := decodeWSLFSRequest(true, "", strings.NewReader(payload)); err == nil {
			t.Fatalf("invalid stdin frame accepted (%d bytes)", len(payload))
		}
	}
}
func TestWSLFSBase64LegacyReadCompatibility(t *testing.T) {
	payload := `{"version":1,"operation":"read","path":"README.md"}`
	encoded := base64.StdEncoding.EncodeToString([]byte(payload))
	req, err := decodeWSLFSRequest(false, encoded, strings.NewReader(""))
	if err != nil || req.Operation != "read" || req.Path != "README.md" {
		t.Fatalf("legacy frame failed: %+v %v", req, err)
	}
	if _, err := decodeWSLFSRequest(false, "not~base64", strings.NewReader("")); err == nil {
		t.Fatal("malformed base64 accepted")
	}
}
