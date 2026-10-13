//go:build windows

package svc

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// applyRecoveryPolicy configures "restart on failure" through
// ChangeServiceConfig2 (SERVICE_CONFIG_FAILURE_ACTIONS): restart after five
// seconds, reset the counter daily. The supervisor already respawns a crashed
// server; this is the second layer, for the case where the service host itself
// dies (a malformed settings document, an uncaught fault).
func applyRecoveryPolicy(handle windows.Handle) error {
	type scAction struct {
		actionType uint32
		delayMs    uint32
	}
	type failureActions struct {
		resetPeriodSeconds uint32
		rebootMsg          *uint16
		command            *uint16
		actionsCount       uint32
		actions            *scAction
	}
	const (
		scActionRestart       = 1
		serviceConfigFailures = 2
	)
	actions := []scAction{{actionType: scActionRestart, delayMs: 5000}}
	config := failureActions{
		resetPeriodSeconds: 24 * 60 * 60,
		actionsCount:       uint32(len(actions)),
		actions:            &actions[0],
	}
	advapi32 := windows.NewLazySystemDLL("advapi32.dll")
	changeServiceConfig2 := advapi32.NewProc("ChangeServiceConfig2W")
	result, _, err := changeServiceConfig2.Call(
		uintptr(handle),
		uintptr(serviceConfigFailures),
		uintptr(unsafe.Pointer(&config)),
	)
	if result == 0 {
		return fmt.Errorf("ChangeServiceConfig2: %w", err)
	}
	return nil
}

// grantUserStartStop replaces the service DACL so a non-elevated tray can
// start, stop and read the service. Configuration changes and deletion stay
// administrator-only, which is what makes "install once, control forever" safe.
func grantUserStartStop(handle windows.Handle) error {
	descriptor, err := windows.SecurityDescriptorFromString(serviceStartStopSDDL)
	if err != nil {
		return fmt.Errorf("parse service SDDL: %w", err)
	}
	const daclSecurityInformation = 0x00000004
	advapi32 := windows.NewLazySystemDLL("advapi32.dll")
	setServiceObjectSecurity := advapi32.NewProc("SetServiceObjectSecurity")
	result, _, err := setServiceObjectSecurity.Call(
		uintptr(handle),
		uintptr(daclSecurityInformation),
		uintptr(unsafe.Pointer(descriptor)),
	)
	if result == 0 {
		return fmt.Errorf("SetServiceObjectSecurity: %w", err)
	}
	return nil
}
