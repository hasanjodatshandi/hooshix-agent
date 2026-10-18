package gitworker

import (
	"bytes"
	"testing"
)

func TestBoundedGitOutput(t *testing.T) {
	writer := &boundedCapture{max: 128}
	data := bytes.Repeat([]byte("x"), 1<<20)
	n, err := writer.Write(data)
	if err != nil || n != len(data) {
		t.Fatalf("write result n=%d err=%v", n, err)
	}
	if !writer.overflow || len(writer.bytes) != 128 {
		t.Fatalf("capture retained %d bytes, overflow=%v", len(writer.bytes), writer.overflow)
	}
}