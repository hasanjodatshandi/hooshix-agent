package tray

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// TestEmbeddedStatusIconsAreUsableAtTheSizesTheShellDraws guards the asset
// pipeline: the icons are generated, and a generator change that drops the 16
// frame would otherwise only be noticed as a blurry tray icon on someone's
// taskbar.
func TestEmbeddedStatusIconsAreUsableAtTheSizesTheShellDraws(t *testing.T) {
	for _, level := range []readiness{readinessGreen, readinessYellow, readinessRed} {
		for _, size := range []int{16, 32} {
			frame, err := pickFrame(iconData(level), size)
			if err != nil {
				t.Fatalf("readiness %d at %dpx: %v", level, size, err)
			}
			decoded, err := png.Decode(bytes.NewReader(frame))
			if err != nil {
				t.Fatalf("frame for readiness %d at %dpx is not decodable: %v", level, size, err)
			}
			if got := decoded.Bounds().Dx(); got != size {
				t.Fatalf("expected a %dpx frame, got %dpx", size, got)
			}
			if got := decoded.At(size/2, size/2); !distinctFromBackground(t, got) {
				t.Fatalf("the mark is missing at %dpx: centre pixel %v", size, got)
			}
		}
	}
}

// distinctFromBackground checks the centre pixel carries the mark's ink rather
// than a flat tint, which is what makes the three states tell apart at a glance.
func distinctFromBackground(t *testing.T, pixel color.Color) bool {
	t.Helper()
	red, green, blue, alpha := pixel.RGBA()
	if alpha == 0 {
		return false
	}
	return red < 0x4000 && green < 0x4000 && blue < 0x6000
}

func TestPickFrameRejectsWhatTheShellCannotDraw(t *testing.T) {
	pngFrame := encodeFrame(t, 16)
	good := buildContainer([]int{16}, [][]byte{pngFrame})

	t.Run("truncated container", func(t *testing.T) {
		if _, err := pickFrame(good[:4], 16); err == nil {
			t.Fatal("expected a truncated container to be refused")
		}
	})
	t.Run("cursor instead of icon", func(t *testing.T) {
		cursor := append([]byte(nil), good...)
		binary.LittleEndian.PutUint16(cursor[2:4], 2)
		if _, err := pickFrame(cursor, 16); err == nil {
			t.Fatal("expected a non-icon container to be refused")
		}
	})
	t.Run("empty directory", func(t *testing.T) {
		empty := append([]byte(nil), good...)
		binary.LittleEndian.PutUint16(empty[4:6], 0)
		if _, err := pickFrame(empty, 16); err == nil {
			t.Fatal("expected a frameless container to be refused")
		}
	})
	t.Run("frame outside the file", func(t *testing.T) {
		corrupt := append([]byte(nil), good...)
		binary.LittleEndian.PutUint32(corrupt[6+8:6+12], 1<<20)
		if _, err := pickFrame(corrupt, 16); err == nil {
			t.Fatal("expected an out-of-range frame to be refused")
		}
	})
	t.Run("bmp frame", func(t *testing.T) {
		bmp := buildContainer([]int{16}, [][]byte{{0x28, 0, 0, 0}})
		if _, err := pickFrame(bmp, 16); err == nil {
			t.Fatal("expected an unsupported BMP frame to be refused rather than half-drawn")
		}
	})
}

func encodeFrame(t *testing.T, size int) []byte {
	t.Helper()
	frame := image.NewRGBA(image.Rect(0, 0, size, size))
	frame.Set(size/2, size/2, color.RGBA{R: 0x0B, G: 0x12, B: 0x1F, A: 0xFF})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, frame); err != nil {
		t.Fatalf("encode frame: %v", err)
	}
	return buffer.Bytes()
}

// buildContainer mirrors cmd/make-tray-icons' writer for test fixtures.
func buildContainer(sizes []int, frames [][]byte) []byte {
	offset := 6 + 16*len(sizes)
	buffer := bytes.NewBuffer(nil)
	_ = binary.Write(buffer, binary.LittleEndian, uint16(0))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(1))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(len(sizes)))
	for index, size := range sizes {
		encoded := size
		if encoded >= 256 {
			encoded = 0
		}
		buffer.Write([]byte{byte(encoded), byte(encoded), 0, 0})
		_ = binary.Write(buffer, binary.LittleEndian, uint16(1))
		_ = binary.Write(buffer, binary.LittleEndian, uint16(32))
		_ = binary.Write(buffer, binary.LittleEndian, uint32(len(frames[index])))
		_ = binary.Write(buffer, binary.LittleEndian, uint32(offset))
		offset += len(frames[index])
	}
	for _, frame := range frames {
		buffer.Write(frame)
	}
	return buffer.Bytes()
}
