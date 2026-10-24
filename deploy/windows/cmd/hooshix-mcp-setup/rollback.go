package main

import (
	"fmt"
	"io"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/svc"
)

// runRollback is the explicit one-level Windows program restore point.
// The settings, SQLite database, logs, and user workspaces are never removed.
// No installer payload is needed: even the uninstaller executable can invoke it.
func runRollback(layout setup.Layout, out io.Writer) error {
	recovery := setup.RecoveryFor(layout)
	if err := recovery.CheckPrevious(); err != nil {
		return err
	}
	if err := layout.CheckExistingSettingsRuntime(); err != nil {
		return err
	}
	if err := layout.CheckWorkerIdle(); err != nil {
		return err
	}
	if err := layout.CheckTrayIdle(); err != nil {
		return err
	}

	present, err := svc.PrepareForUpgrade(layout.ServiceBinary())
	if err != nil {
		return fmt.Errorf("stop installed Windows service for rollback: %w", err)
	}
	if !present {
		return fmt.Errorf("Windows service registration is absent; refusing unowned rollback")
	}
	if err = setup.WaitListenerFree(setup.DefaultPort, listenerReleaseTimeout); err != nil {
		_ = svc.Start()
		return err
	}
	if err = recovery.RestorePrevious(); err != nil {
		return fmt.Errorf("rollback restoration incomplete; saved program snapshot is retained: %w", err)
	}
	if err = registerInstall(layout, layout.ReadAppVersion()); err != nil {
		return fmt.Errorf("program restored but Programs entry could not be updated: %w", err)
	}
	if err = svc.Start(); err != nil {
		return fmt.Errorf("program restored but service failed to restart; recovery snapshot retained: %w", err)
	}
	if err = recovery.ConsumePrevious(); err != nil {
		return fmt.Errorf("previous program restored and started, but consumed rollback snapshot could not be deleted: %w", err)
	}
	fmt.Fprintf(out, "restored previous Windows program files; settings and databases preserved\n")
	return nil
}
