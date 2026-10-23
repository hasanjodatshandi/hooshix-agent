package setup

import (
	"bytes"
	"testing"
)

func TestSignedTrailerAlignmentBounds(t *testing.T) {
	trailer := make([]byte, TrailerSize)
	copy(trailer, trailerMagic)
	prefix := bytes.Repeat([]byte("P"), 64)
	for padding := 0; padding <= 7; padding++ {
		content := append(append([]byte(nil), prefix...), trailer...)
		endOfTrailer := int64(len(content))
		content = append(content, make([]byte, padding)...)
		actual, err := signedTrailerEnd(bytes.NewReader(content), int64(len(content)))
		if err != nil || actual != endOfTrailer {
			t.Fatalf("zero padding=%d: got offset=%d error=%v; expected %d",
				padding, actual, err, endOfTrailer)
		}
		if padding != 0 {
			corrupt := append([]byte(nil), content...)
			corrupt[len(corrupt)-1] = 0x37
			if _, err := signedTrailerEnd(bytes.NewReader(corrupt), int64(len(corrupt))); err == nil {
				t.Fatalf("nonzero padding=%d was allowed", padding)
			}
		}
	}
	t.Run("padding beyond seven is rejected", func(t *testing.T) {
		content := append(append([]byte(nil), prefix...), trailer...)
		content = append(content, make([]byte, 8)...)
		if _, err := signedTrailerEnd(bytes.NewReader(content), int64(len(content))); err == nil {
			t.Fatal("eight-byte padding was allowed")
		}
	})
	t.Run("missing marker rejected", func(t *testing.T) {
		content := append(append([]byte(nil), prefix...), make([]byte, TrailerSize+4)...)
		if _, err := signedTrailerEnd(bytes.NewReader(content), int64(len(content))); err == nil {
			t.Fatal("missing marker accepted")
		}
	})
}
