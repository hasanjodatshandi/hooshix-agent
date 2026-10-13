// Command make-tray-icons writes the three status-tinted tray icons that
// internal/tray embeds.
//
// They are generated rather than hand-authored: the tray has to communicate a
// state at 16×16, and a mark that only reads well on a design canvas is worth
// nothing there. Regenerate with:
//
//	go run ./cmd/make-tray-icons -out internal/tray/icons
package main

import (
	"bytes"
	"encoding/binary"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
)

// tints are the three states the tray can show, in the order an operator reads
// them: serving, reachable-but-not-serving, unusable.
var tints = map[string]color.RGBA{
	"green":  {R: 0x16, G: 0xA3, B: 0x4A, A: 0xFF},
	"yellow": {R: 0xEA, G: 0xB3, B: 0x08, A: 0xFF},
	"red":    {R: 0xDC, G: 0x26, B: 0x26, A: 0xFF},
}

// ink is the mark's colour. Dark on every tint keeps the "H" readable, which
// white on yellow does not.
var ink = color.RGBA{R: 0x0B, G: 0x12, B: 0x1F, A: 0xFF}

// frameSizes are the ICO entries. 16 is what the notification area draws; the
// larger frames make the same file usable as a window or shortcut icon.
var frameSizes = []int{16, 32, 48, 256}

func main() {
	out := flag.String("out", filepath.Join("internal", "tray", "icons"), "directory for the generated .ico files")
	flag.Parse()
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fail(fmt.Errorf("create output directory: %w", err))
	}
	for _, name := range []string{"green", "yellow", "red"} {
		path := filepath.Join(*out, "hooshix-mcp-"+name+".ico")
		if err := writeIcon(path, tints[name]); err != nil {
			fail(fmt.Errorf("write %s: %w", path, err))
		}
		fmt.Println("wrote", path)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "make-tray-icons:", err)
	os.Exit(1)
}

func writeIcon(path string, tint color.RGBA) error {
	var frames [][]byte
	for _, size := range frameSizes {
		frame, err := pngFrame(size, tint)
		if err != nil {
			return err
		}
		frames = append(frames, frame)
	}
	return os.WriteFile(path, container(frames, frameSizes), 0o644)
}

// pngFrame renders one square frame and encodes it as PNG, which is how modern
// ICO entries store image data.
func pngFrame(size int, tint color.RGBA) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	drawBadge(img, tint)
	drawMark(img)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// drawBadge fills a rounded square with the state colour. The corner radius
// scales with the frame so the silhouette is the same shape at 16 and at 256.
func drawBadge(img *image.RGBA, tint color.RGBA) {
	size := img.Bounds().Dx()
	radius := size / 8
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if insideBadge(x, y, size, radius) {
				img.Set(x, y, tint)
			}
		}
	}
}

// insideBadge tests a pixel centre against the rounded rectangle. Corner pixels
// are the only ones that can fall outside, and they are measured against the
// nearest corner's circle.
func insideBadge(x, y, size, radius int) bool {
	if radius < 1 {
		return true
	}
	fx, fy := float64(x)+0.5, float64(y)+0.5
	r := float64(radius)
	last := float64(size) - r
	if fx >= r && fx <= last && fy >= r && fy <= last {
		return true
	}
	originX, originY := r, r
	if fx > last {
		originX = last
	}
	if fy > last {
		originY = last
	}
	dx, dy := fx-originX, fy-originY
	return dx*dx+dy*dy <= r*r
}

// drawMark paints the HooshiX initial. Strokes are never thinner than two
// pixels, because 16×16 is the size the tray actually draws and a one-pixel
// stroke disappears there.
func drawMark(img *image.RGBA) {
	size := img.Bounds().Dx()
	margin := size / 4
	thickness := size / 8
	if thickness < 2 {
		thickness = 2
	}
	for y := margin; y < size-margin; y++ {
		fillSpan(img, y, margin, margin+thickness)
		fillSpan(img, y, size-margin-thickness, size-margin)
	}
	for y := size/2 - thickness/2; y < size/2-thickness/2+thickness; y++ {
		fillSpan(img, y, margin, size-margin)
	}
}

func fillSpan(img *image.RGBA, y, x0, x1 int) {
	for x := x0; x < x1; x++ {
		img.Set(x, y, ink)
	}
}

// container packs PNG frames into an ICO file: an ICONDIR header, one
// ICONDIRENTRY per frame, then the image data. Sizes of 256 are written as zero,
// which is how the format encodes anything above 255.
func container(frames [][]byte, sizes []int) []byte {
	offset := 6 + 16*len(frames)
	buffer := bytes.NewBuffer(make([]byte, 0, offset))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(0)) // reserved
	_ = binary.Write(buffer, binary.LittleEndian, uint16(1)) // type: icon
	_ = binary.Write(buffer, binary.LittleEndian, uint16(len(frames)))
	for index, size := range sizes {
		encoded := size
		if encoded >= 256 {
			encoded = 0
		}
		_ = binary.Write(buffer, binary.LittleEndian, uint8(encoded)) // width
		_ = binary.Write(buffer, binary.LittleEndian, uint8(encoded)) // height
		_ = binary.Write(buffer, binary.LittleEndian, uint8(0))       // palette entries
		_ = binary.Write(buffer, binary.LittleEndian, uint8(0))       // reserved
		_ = binary.Write(buffer, binary.LittleEndian, uint16(1))      // colour planes
		_ = binary.Write(buffer, binary.LittleEndian, uint16(32))     // bits per pixel
		_ = binary.Write(buffer, binary.LittleEndian, uint32(len(frames[index])))
		_ = binary.Write(buffer, binary.LittleEndian, uint32(offset))
		offset += len(frames[index])
	}
	for _, frame := range frames {
		buffer.Write(frame)
	}
	return buffer.Bytes()
}
