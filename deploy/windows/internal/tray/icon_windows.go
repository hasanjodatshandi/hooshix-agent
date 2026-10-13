//go:build windows

package tray

import (
	"fmt"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// iconCache turns the embedded containers into HICONs once each. Creating an
// icon is a kernel allocation and the tray repaints every poll, so the handles
// are kept for the life of the process; a failed creation is cached too, which
// stops a broken asset from being retried every two seconds.
type iconCache struct {
	mu    sync.Mutex
	icons map[readiness]windows.Handle
	size  int
	err   error
}

var trayIcons = &iconCache{icons: make(map[readiness]windows.Handle)}

// statusIcon returns the tray icon for a readiness level, or 0 when the tinted
// variants cannot be decoded. Callers pass that straight to Shell_NotifyIcon: a
// zero handle means no icon change, which is honest, rather than showing green
// because the red frame failed to load.
func statusIcon(level readiness) windows.Handle { return trayIcons.handleFor(level) }

// lastIconError reports why statusIcon is returning zero handles, for the log
// line the operator sees when the tray looks blank.
func lastIconError() error {
	trayIcons.mu.Lock()
	defer trayIcons.mu.Unlock()
	return trayIcons.err
}

func (cache *iconCache) handleFor(level readiness) windows.Handle {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if icon, seen := cache.icons[level]; seen {
		return icon
	}
	frame, err := pickFrame(iconData(level), cache.pixelSize())
	if err == nil {
		var icon windows.Handle
		icon, err = createHIcon(frame, cache.pixelSize())
		if err == nil {
			cache.icons[level] = icon
			return icon
		}
	}
	cache.err = err
	cache.icons[level] = 0
	return 0
}

// pixelSize is the notification area's icon width in physical pixels. Asking
// the system rather than assuming 16 is what keeps the mark legible on a scaled
// display, where the shell actually draws 20 or 24 pixel tray icons.
func (cache *iconCache) pixelSize() int {
	if cache.size != 0 {
		return cache.size
	}
	metrics := user32.NewProc("GetSystemMetrics")
	size, _, _ := metrics.Call(smCxSmIcon)
	if size == 0 {
		size = 16
	}
	cache.size = int(size)
	return cache.size
}

// createHIcon builds an icon handle from a PNG-encoded ICO frame. This avoids
// writing the asset to disk and avoids GDI image loading entirely, so the tray
// has no install-path dependency at runtime.
func createHIcon(frame []byte, size int) (windows.Handle, error) {
	if len(frame) == 0 {
		return 0, fmt.Errorf("empty icon frame")
	}
	createIcon := user32.NewProc("CreateIconFromResourceEx")
	handle, _, callErr := createIcon.Call(
		uintptr(unsafe.Pointer(&frame[0])),
		uintptr(len(frame)),
		1, // fIcon: build an icon, not a cursor
		0x00030000,
		uintptr(size),
		uintptr(size),
		0x00000080, // LR_DEFAULTCOLOR
	)
	if handle == 0 {
		return 0, fmt.Errorf("CreateIconFromResourceEx: %w", callErr)
	}
	return windows.Handle(handle), nil
}

// SM_CXSMICON — the small icon width the shell uses for the tray.
const smCxSmIcon = 49
