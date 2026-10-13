//go:build windows

package tray

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// menuHost owns the hidden window, the notification-area icon, the context
// menu, and the message pump that drives them.
type menuHost struct {
	app            *App
	instance       uintptr
	window         windows.Handle
	menu           windows.Handle
	iconToken      uint32
	taskbarCreated uint32

	// notifyIcon is the seam through which every Shell_NotifyIconW call runs,
	// so a test can prove the NIM_SETVERSION request is really issued — and
	// force its failure — without a live taskbar.
	notifyIcon func(op uint32, data *notifyIconData) error

	// legacyNotifications records a refused version upgrade. The window
	// procedure still handles the raw mouse messages, and the hotkey remains,
	// so a shell that will not deliver v4 clicks does not leave the user with a
	// decorative icon.
	legacyNotifications atomic.Bool

	// uiWork serializes menu mutation onto the message-loop thread.
	// TrackPopupMenu must run on the thread that pumps its owner window, and
	// Insert/DeleteMenu must not race it — a menu truncated mid-display is the
	// classic "nothing appears on click" bug.
	uiMu   sync.Mutex
	uiWork []func()

	// statusRows is how many disabled header rows are currently inserted at the
	// top of the menu. Deleting a fixed count instead eats the command items
	// whenever the status block is shorter than assumed.
	statusRows int

	hotkeyMu         sync.Mutex
	hotkeyRegistered bool

	// lastReadiness is the colour the last balloon was issued for, so a
	// flapping state cannot produce a balloon every two seconds.
	balloonMu        sync.Mutex
	lastReadiness    readiness
	lastReadinessSet bool
}

const (
	wmTrayCallback = 0x8000 // WM_APP
	wmUiWork       = 0x8001 // WM_APP+1: run a queued UI-thread closure
	wmDestroy      = 0x0002
	wmEndSession   = 0x0016
	wmClose        = 0x0010
	wmNull         = 0x0000
	wmHotkey       = 0x0312
)

var (
	shell32     = windows.NewLazySystemDLL("shell32.dll")
	user32      = windows.NewLazySystemDLL("user32.dll")
	kernel32    = windows.NewLazySystemDLL("kernel32.dll")
	shellProc   = shell32.NewProc("Shell_NotifyIconW")
	className   = syscall.StringToUTF16Ptr("HooshiXMCPTray")
	windowTitle = syscall.StringToUTF16Ptr("HooshiX MCP Tray")
)

// notifyIconData is NOTIFYICONDATAW as documented by the Windows SDK.
type notifyIconData struct {
	Size             uint32
	Window           windows.Handle
	ID               uint32
	Flags            uint32
	CallbackMessage  uint32
	Icon             windows.Handle
	Tip              [128]uint16
	State            uint32
	StateMask        uint32
	Info             [256]uint16
	VersionOrTimeout uint32
	InfoTitle        [64]uint16
	InfoFlags        uint32
	GUIDItem         windows.GUID
	BalloonIcon      windows.Handle
}

const (
	nifMessage  = 0x01
	nifIcon     = 0x02
	nifTip      = 0x04
	nifInfo     = 0x10
	nimAdd      = 0x00
	nimModify   = 0x01
	nimDelete   = 0x02
	nimSetVer   = 0x04
	notifyVer4  = 4
	niifInfo    = 0x00000001
	niifWarning = 0x00000002
	niifError   = 0x00000003

	// Menu hotkey fallback: Ctrl+Alt+M opens the same menu the icon click
	// should open, for shells that stop forwarding tray clicks.
	hotkeyID    = 1
	modAlt      = 0x0001
	modControl  = 0x0002
	modNoRepeat = 0x4000
	vkM         = 0x4D

	// NOTIFYICON_VERSION_4 delivers notification codes, not raw mouse messages.
	// Balloon lifecycle codes sit in the same range and must never open the menu.
	ninSelect           = 0x0400
	ninKeySelect        = 0x0401
	ninBalloonTimeout   = 0x0404
	ninBalloonUserClick = 0x0405
	wmContextMenu       = 0x007B
	wmLButtonUp         = 0x0202
	wmLButtonDblClk     = 0x0203
	wmRButtonUp         = 0x0205
	wmRButtonDblClk     = 0x0206

	mfString     = 0x0000
	mfGrayed     = 0x0002
	mfSeparator  = 0x0800
	mfByPosition = 0x0400
)

// Menu command IDs, dispatched in dispatchMenu.
const (
	menuStatus  = 1000
	menuLogs    = 1001
	menuStart   = 1002
	menuStop    = 1003
	menuExit    = 1004
	menuRestart = 1005
)

// wndClassEx mirrors the Win32 WNDCLASSEXW structure exactly.
type wndClassEx struct {
	Size        uint32
	Style       uint32
	WndProc     uintptr
	ClassExtra  int32
	WindowExtra int32
	Instance    uintptr
	Icon        uintptr
	Cursor      uintptr
	Background  uintptr
	MenuName    uintptr
	ClassName   uintptr
	IconSm      uintptr
}

var currentHost *menuHost

func newMenuHost(app *App) (*menuHost, error) {
	host := &menuHost{app: app}
	instance, _, err := kernel32.NewProc("GetModuleHandleW").Call(0)
	if instance == 0 {
		return nil, fmt.Errorf("GetModuleHandle: %w", err)
	}
	host.instance = uintptr(instance)

	taskbarCreated, _, registerErr := user32.NewProc("RegisterWindowMessageW").Call(
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("TaskbarCreated"))))
	if taskbarCreated == 0 {
		return nil, fmt.Errorf("RegisterWindowMessage(TaskbarCreated): %w", registerErr)
	}
	host.taskbarCreated = uint32(taskbarCreated)

	currentHost = host
	registerClass := user32.NewProc("RegisterClassExW")
	appIcon := loadAppIcon(host.instance)
	class := wndClassEx{
		Size:      uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:   syscall.NewCallback(trayWndProc),
		Instance:  host.instance,
		Icon:      uintptr(appIcon),
		Cursor:    uintptr(loadArrowCursor()),
		IconSm:    uintptr(appIcon),
		ClassName: uintptr(unsafe.Pointer(className)),
	}
	if atom, _, classErr := registerClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return nil, fmt.Errorf("RegisterClassEx: %w", classErr)
	}

	window, _, createErr := user32.NewProc("CreateWindowExW").Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowTitle)),
		0, // never shown: this window exists only to receive tray callbacks
		0, 0, 0, 0,
		0, 0,
		host.instance,
		0,
	)
	if window == 0 {
		return nil, fmt.Errorf("CreateWindowEx: %w", createErr)
	}
	host.window = windows.Handle(window)

	menu, _, menuErr := user32.NewProc("CreatePopupMenu").Call()
	if menu == 0 {
		return nil, fmt.Errorf("CreatePopupMenu: %w", menuErr)
	}
	host.menu = windows.Handle(menu)
	host.appendStaticMenuItems()
	// Rebuild rather than only insert the status rows: the command rows must
	// start greyed-out correctly, not in AppendMenu's default enabled state.
	host.rebuildMenu()

	host.iconToken = 1
	host.notifyIcon = shellNotifyIconCall
	if err := host.registerIcon(); err != nil {
		return nil, err
	}
	host.registerHotkey()
	return host, nil
}

// registerIcon adds the icon and installs the v4 click layout. Both halves are
// always done together: an icon registered without the version call is painted
// but never delivers a click, which looks identical to a working icon until
// someone tries to use it.
func (host *menuHost) registerIcon() error {
	if err := host.notify(nimAdd); err != nil {
		return fmt.Errorf("Shell_NotifyIcon add: %w", err)
	}
	host.applyNotifyVersion()
	return nil
}

func (host *menuHost) applyNotifyVersion() {
	data := notifyIconData{Window: host.window, ID: host.iconToken, VersionOrTimeout: notifyVer4}
	data.Size = uint32(unsafe.Sizeof(data))
	if err := host.shellNotifyIcon(nimSetVer, &data); err != nil {
		host.legacyNotifications.Store(true)
		host.app.logger.Warn("tray click layout refused; using legacy tray events; Ctrl+Alt+M still opens the menu", "error", err)
		return
	}
	host.legacyNotifications.Store(false)
}

func (host *menuHost) registerHotkey() {
	register := user32.NewProc("RegisterHotKey")
	if ok, _, hkErr := register.Call(uintptr(host.window), hotkeyID,
		uintptr(modControl|modAlt|modNoRepeat), uintptr(vkM)); ok == 0 {
		// Logged loudly on purpose: this is the only remaining way to reach the
		// menu when click delivery breaks.
		host.app.logger.Error("register menu hotkey failed: Ctrl+Alt+M cannot open the tray menu", "error", hkErr)
		return
	}
	host.hotkeyMu.Lock()
	host.hotkeyRegistered = true
	host.hotkeyMu.Unlock()
}

func (host *menuHost) unregisterHotkey() {
	host.hotkeyMu.Lock()
	defer host.hotkeyMu.Unlock()
	if !host.hotkeyRegistered {
		return
	}
	if result, _, err := user32.NewProc("UnregisterHotKey").Call(uintptr(host.window), hotkeyID); result == 0 {
		host.app.logger.Warn("unregister menu hotkey failed", "error", err)
		return
	}
	host.hotkeyRegistered = false
}

// appendStaticMenuItems adds the command rows once at startup. Only the status
// block above them changes afterwards.
func (host *menuHost) appendStaticMenuItems() {
	appendMenu := user32.NewProc("AppendMenuW")
	add := func(flags, id uintptr, label string) {
		utf16 := syscall.StringToUTF16Ptr(label)
		appendMenu.Call(uintptr(host.menu), flags, id, uintptr(unsafe.Pointer(utf16)))
	}
	add(mfSeparator, 0, "-")
	add(mfString, menuLogs, "Open logs")
	add(mfString, menuStart, "Start service")
	add(mfString, menuStop, "Stop service")
	add(mfString, menuRestart, "Restart service")
	add(mfSeparator, 0, "-")
	add(mfString, menuExit, "Close tray icon")
}

// rebuildMenu refreshes the status block and the enable/disable state of the
// command rows. It runs on the UI thread.
func (host *menuHost) rebuildMenu() {
	snapshot := host.app.snapshot()
	host.applyStatusRows(snapshot)
	enable := user32.NewProc("EnableMenuItem")
	state := snapshot.Service
	// Start is only meaningful while the service is registered and not running;
	// Stop and Restart only while it is running or transitioning. A greyed row
	// that cannot do anything beats one that fails with access denied.
	on, off := uintptr(0x0000), uintptr(0x0001) // MF_ENABLED, MF_GRAYED
	startEnabled, stopEnabled := off, on
	if state != "running" {
		startEnabled, stopEnabled = on, off
	}
	enable.Call(uintptr(host.menu), menuStart, startEnabled)
	enable.Call(uintptr(host.menu), menuStop, stopEnabled)
	enable.Call(uintptr(host.menu), menuRestart, stopEnabled)
}

// applyStatusRows replaces the leading status block, removing exactly the rows
// it inserted last time whatever their count.
func (host *menuHost) applyStatusRows(snapshot Snapshot) {
	deleteMenu := user32.NewProc("DeleteMenu")
	insertMenu := user32.NewProc("InsertMenuW")
	for index := 0; index < host.statusRows; index++ {
		// Position 0 every time: removing the top row shifts the next into it.
		deleteMenu.Call(uintptr(host.menu), 0, mfByPosition)
	}
	host.statusRows = 0
	lines := statusLines(snapshot)
	for index, line := range lines {
		utf16 := syscall.StringToUTF16Ptr(line)
		// MF_BYPOSITION is required: without it the position argument is read
		// as a command ID and the rows land beside an unrelated item.
		insertMenu.Call(uintptr(host.menu), uintptr(index), uintptr(mfByPosition|mfString|mfGrayed),
			menuStatus, uintptr(unsafe.Pointer(utf16)))
	}
	host.statusRows = len(lines)
}

func trayWndProc(window windows.Handle, message uint32, wParam, lParam uintptr) uintptr {
	host := currentHost
	if host == nil {
		return 0
	}
	if message == host.taskbarCreated {
		// Explorer restarted: its tray table is empty again, and an icon that
		// is merely cached by Explorer shows but swallows every click. Re-add
		// with the version call, retrying once before giving up loudly.
		host.app.logger.Info("taskbar recreated; re-adding tray icon")
		var err error
		for attempt := 1; attempt <= 2; attempt++ {
			if err = host.registerIcon(); err == nil {
				break
			}
			host.app.logger.Warn("re-add tray icon failed", "attempt", attempt, "error", err)
			time.Sleep(500 * time.Millisecond)
		}
		if err != nil {
			host.app.logger.Error("tray icon re-add failed after taskbar recreation", "error", err)
		}
		return 0
	}
	switch message {
	case wmUiWork:
		host.drainUiWork()
		return 0
	case wmHotkey:
		if uint32(wParam) == hotkeyID {
			host.runOnUi(host.showMenu)
		}
		return 0
	case wmTrayCallback:
		switch code := uint32(lParam) & 0xFFFF; code {
		case ninSelect, ninKeySelect, wmContextMenu, // version 4
			wmLButtonUp, wmLButtonDblClk, wmRButtonUp, wmRButtonDblClk: // legacy
			host.runOnUi(host.showMenu)
		}
		return 0
	case wmDestroy:
		host.unregisterHotkey()
		_ = host.notify(nimDelete)
		postQuitMessage()
		return 0
	case wmClose:
		user32.NewProc("DestroyWindow").Call(uintptr(window))
		return 0
	case wmEndSession:
		// Sign-out: leave the pump so the process exits with the session.
		postQuitMessage()
		return 0
	}
	result, _, _ := user32.NewProc("DefWindowProcW").Call(uintptr(window), uintptr(message), wParam, lParam)
	return result
}

func (host *menuHost) runOnUi(work func()) {
	host.uiMu.Lock()
	host.uiWork = append(host.uiWork, work)
	host.uiMu.Unlock()
	user32.NewProc("PostMessageW").Call(uintptr(host.window), wmUiWork, 0, 0)
}

func (host *menuHost) drainUiWork() {
	for {
		host.uiMu.Lock()
		if len(host.uiWork) == 0 {
			host.uiMu.Unlock()
			return
		}
		work := host.uiWork[0]
		host.uiWork = host.uiWork[1:]
		host.uiMu.Unlock()
		work()
	}
}

func (host *menuHost) showMenu() {
	const tpmRightAlign, tpmBottomAlign, tpmReturnCmd, tpmNonotify = 0x0008, 0x0020, 0x0100, 0x0080
	// Standard tray pattern (KB135238): own the foreground so the menu dismisses
	// on an outside click or ESC, then post WM_NULL to end the modal loop.
	user32.NewProc("SetForegroundWindow").Call(uintptr(host.window))
	var point struct{ x, y int32 }
	user32.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&point)))
	chosen, _, trackErr := user32.NewProc("TrackPopupMenu").Call(
		uintptr(host.menu),
		uintptr(tpmRightAlign|tpmBottomAlign|tpmReturnCmd|tpmNonotify),
		uintptr(int64(point.x)), uintptr(int64(point.y)),
		0, uintptr(host.window), 0,
	)
	user32.NewProc("PostMessageW").Call(uintptr(host.window), wmNull, 0, 0)
	if trackErr != nil && chosen == 0 {
		host.app.logger.Warn("tray menu did not open", "error", trackErr)
		return
	}
	// Dispatch on the UI thread: the menu was just rebuilt for this snapshot,
	// and an async dispatch could act on a newer one.
	host.dispatchMenu(uint32(chosen))
}

func (host *menuHost) dispatchMenu(id uint32) {
	switch id {
	case menuLogs:
		host.app.openLogs()
	case menuStart:
		host.app.startService()
	case menuStop:
		host.app.stopService()
	case menuRestart:
		host.app.restartService()
	case menuExit:
		host.app.exit()
	}
}

// run pumps messages until the window is destroyed. It must be called on the
// thread that created the window.
func (host *menuHost) run() error {
	getMessage := user32.NewProc("GetMessageW")
	var msg struct {
		Window   windows.Handle
		Message  uint32
		WParam   uintptr
		LParam   uintptr
		Time     uint32
		Point    struct{ x, y int32 }
		LPrivate uint32
	}
	for {
		result, _, err := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) == -1 {
			return fmt.Errorf("GetMessage: %w", err)
		}
		if result == 0 {
			return nil
		}
		user32.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&msg)))
		user32.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (host *menuHost) quit() {
	if result, _, err := user32.NewProc("PostMessageW").Call(uintptr(host.window), wmClose, 0, 0); result == 0 {
		host.app.logger.Error("request tray shutdown failed", "error", err)
	}
}

func (host *menuHost) dispose() {
	host.unregisterHotkey()
	_ = host.notify(nimDelete)
}

func shellNotifyIconCall(op uint32, data *notifyIconData) error {
	result, _, err := shellProc.Call(uintptr(op), uintptr(unsafe.Pointer(data)))
	if result == 0 {
		return fmt.Errorf("Shell_NotifyIcon(%d): %w", op, err)
	}
	return nil
}

func (host *menuHost) shellNotifyIcon(op uint32, data *notifyIconData) error {
	if host.notifyIcon == nil {
		return shellNotifyIconCall(op, data)
	}
	return host.notifyIcon(op, data)
}

// notify registers or updates the icon entry with its current colour and
// tooltip.
func (host *menuHost) notify(op uint32) error {
	snapshot := host.app.snapshot()
	data := notifyIconData{
		Window:          host.window,
		ID:              host.iconToken,
		Flags:           nifMessage | nifTip,
		CallbackMessage: wmTrayCallback,
	}
	if icon := statusIcon(readinessOf(snapshot)); icon != 0 {
		data.Flags |= nifIcon
		data.Icon = icon
	}
	copy(data.Tip[:], syscall.StringToUTF16(tooltip(snapshot)))
	data.Size = uint32(unsafe.Sizeof(data))
	return host.shellNotifyIcon(op, &data)
}

// tooltip is what the icon says when the operator hovers it: the state in one
// line, and where to look when it is wrong.
func tooltip(snapshot Snapshot) string {
	text := "HooshiX MCP — " + displayText(snapshot)
	if snapshot.Listener != "" && snapshot.Published && !snapshot.Stale {
		text += " · " + snapshot.Listener
	}
	return truncate(text, 63) // NIF_TIP holds 63 characters plus the terminator.
}

// refresh applies a new snapshot: icon, tooltip, menu rows, and a balloon when
// the colour changed. It runs on the poll goroutine, so every menu mutation is
// marshalled onto the message-loop thread; Shell_NotifyIcon itself is safe to
// call from here.
func (host *menuHost) refresh(snapshot Snapshot) {
	host.notifyTunnelChange(snapshot)
	host.runOnUi(host.rebuildMenu)
	if err := host.notify(nimModify); err != nil {
		// Debug because this runs on every tick: a persistently failing modify
		// means the on-screen icon is a dead Explorer cache entry.
		host.app.logger.Debug("update tray icon failed", "error", err)
	}
}

// notifyTunnelChange posts one balloon per colour change. The first snapshot
// only sets the baseline: an icon that balloons "not running" every time the
// user logs in trains them to ignore the balloon. Windows may also fade or
// suppress a balloon entirely (Focus Assist), so this is an addition to the
// icon and tooltip, never the only signal.
func (host *menuHost) notifyTunnelChange(snapshot Snapshot) {
	level := readinessOf(snapshot)
	host.balloonMu.Lock()
	previous, seen := host.lastReadiness, host.lastReadinessSet
	host.lastReadiness, host.lastReadinessSet = level, true
	host.balloonMu.Unlock()
	if !seen || previous == level {
		return
	}
	switch level {
	case readinessGreen:
		host.showBalloon("HooshiX MCP", "Connected and ready.", niifInfo)
	case readinessRed:
		host.showBalloon("HooshiX MCP", "Not running: "+displayText(snapshot)+". Details are in the service logs.", niifError)
	default:
		host.showBalloon("HooshiX MCP", displayText(snapshot), niifWarning)
	}
}

func (host *menuHost) showBalloon(title, message string, flags uint32) {
	var data notifyIconData
	data.Window = host.window
	data.ID = host.iconToken
	// NIF_MESSAGE is deliberately absent: including it would overwrite the
	// registered callback with this struct's zero value and kill click delivery.
	data.Flags = nifInfo
	data.InfoFlags = flags
	copy(data.InfoTitle[:], syscall.StringToUTF16(title))
	copy(data.Info[:], syscall.StringToUTF16(message))
	data.Size = uint32(unsafe.Sizeof(data))
	if err := host.shellNotifyIcon(nimModify, &data); err != nil {
		host.app.logger.Debug("show tray balloon failed", "error", err)
	}
}

func truncate(text string, max int) string {
	if len(text) <= max {
		return text
	}
	return strings.TrimRight(text[:max-3], " ·") + "..."
}

func loadAppIcon(instance uintptr) windows.Handle {
	if icon, _, _ := user32.NewProc("LoadIconW").Call(instance, 1); icon != 0 {
		return windows.Handle(icon)
	}
	icon, _, _ := user32.NewProc("LoadIconW").Call(0, 32512) // IDI_APPLICATION
	return windows.Handle(icon)
}

func loadArrowCursor() windows.Handle {
	cursor, _, _ := user32.NewProc("LoadCursorW").Call(0, 32512) // IDC_ARROW
	return windows.Handle(cursor)
}

func postQuitMessage() {
	user32.NewProc("PostQuitMessage").Call(0)
}
