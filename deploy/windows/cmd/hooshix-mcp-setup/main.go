// Command hooshix-mcp-setup installs and removes the HooshiX MCP service from
// the single file the operator double-clicks.
//
// The runtime it installs comes out of the archive appended to this executable's
// own bytes, so there is nothing to download beside it and no second file to
// keep. One elevation prompt covers the whole install: the service registration,
// the files under Program Files and the entries that make the install visible in
// Programs. Everything written here is listed in README.md, and --uninstall
// removes exactly that list — the operator's database and logs stay unless
// --purge-data says otherwise.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/setup"
	"github.com/hasanjodatshandi/hooshix-agent/deploy/windows/internal/svc"
)

// listenerReleaseTimeout bounds how long the installer waits for the service it
// just stopped to let go of the port and of node.exe. A supervisor exits in well
// under a second, so anything slower means the port belongs to a process this
// installer did not start — and it has to say that rather than wait.
const listenerReleaseTimeout = 15 * time.Second

// uninstallerName is the payload-less copy of this program the Programs entry
// runs. Its name alone selects uninstall mode, so a stray double-click on it can
// never look like an install that failed.
const uninstallerName = "uninstall.exe"

func main() {
	var (
		baseURL   = flag.String("base-url", "", fmt.Sprintf("the HTTPS origin ChatGPT reaches this connector on (default: %s)", setup.DefaultPublicBaseURL))
		uninstall = flag.Bool("uninstall", false, "remove the service, the startup entry and the installed files")
		purgeData = flag.Bool("purge-data", false, "with --uninstall: also delete the data root, which holds the database, the logs and the settings document")
		verify    = flag.Bool("verify", false, "verify the embedded runtime payload without installing anything or requesting elevation")
		repair    = flag.Bool("repair", false, "repair an existing Windows installation using this complete offline installer")
		rollback  = flag.Bool("rollback", false, "restore the prior installed program version; preserve user data")
	)
	flag.Usage = usage
	flag.Parse()

	if *verify {
		if *uninstall || *purgeData || *repair || *rollback {
			fmt.Fprintln(os.Stderr, "setup: --verify cannot be combined with uninstall options")
			os.Exit(2)
		}
		self, err := os.Executable()
		if err == nil {
			err = verifyInstaller(self, os.Stdout)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "setup: verify:", err)
			os.Exit(1)
		}
		return
	}

	proceed, err := ensureElevated(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "setup:", err)
		notify(setup.AppName, "Windows did not give the installer administrator rights, so nothing was changed.\n\n"+err.Error(), true)
		os.Exit(1)
	}
	if !proceed {
		// An elevated copy of this file owns the rest of the work, and its own
		// console carries the transcript.
		return
	}

	self, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "setup:", err)
		os.Exit(1)
	}
	summary, err := run(self, *baseURL, *uninstall || isUninstaller(self), *purgeData, *repair, *rollback, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, "setup:", err)
		notify(setup.AppName,
			"This did not finish:\n\n"+err.Error()+
				"\n\nRunning setup again replaces whatever this run left behind, and the installer never touches a process it did not start.",
			true)
		os.Exit(1)
	}
	fmt.Println(summary)
	notify(setup.AppName, summary, false)
}

// verifyInstaller proves an installer has an intact payload, without elevated
// privileges, SCM changes, registry access, or file extraction.
func verifyInstaller(filename string, out io.Writer) error {
	file, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("open installer: %w", err)
	}
	defer file.Close()
	payload, err := setup.Locate(file)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "verified runtime payload: %d bytes (CRC32 0x%08x)\n", payload.Size, payload.Checksum)
	return err
}

// run does the work for both modes and returns the sentence for the dialog. It
// takes the executable path and the writer so a test can drive it without a
// registry, a service control manager or an installer to point at.
func run(self, baseURL string, uninstalling, purgeData, repairing, rollingBack bool, out io.Writer) (string, error) {
	layout, err := setup.DefaultLayout()
	if err != nil {
		return "", err
	}
	if (uninstalling && (repairing || rollingBack)) || (repairing && rollingBack) {
		return "", fmt.Errorf("repair, rollback and uninstall modes cannot be combined")
	}
	if rollingBack {
		if err := runRollback(layout, out); err != nil {
			return "", err
		}
		return setup.AppName + " previous version restored; settings and user data preserved.", nil
	}
	if uninstalling {
		if err := runUninstall(layout, purgeData, out); err != nil {
			return "", err
		}
		return setup.AppName + " has been removed. The service, the installed files and the entry in Programs are gone.", nil
	}
	if repairing {
		if _, err := os.Stat(layout.ServiceBinary()); err != nil {
			return "", fmt.Errorf("repair requires an existing Windows installation: %w", err)
		}
	}
	if err := runInstall(layout, self, baseURL, out); err != nil {
		return "", err
	}
	return setup.AppName + " was installed and the Windows service was started.\n\n" +
		"A green tray icon verifies LOCAL service health only; it does not verify ChatGPT connectivity. " +
		"Set up your own HTTPS origin and protected OAuth connection before using ChatGPT.\n\n" +
		"First-time instructions: " + filepath.Join(layout.AppDir, "QUICKSTART.txt"), nil
}

func runInstall(layout setup.Layout, self, baseURL string, out io.Writer) (err error) {
	baseURL, err = setup.ValidatePublicBaseURL(baseURL)
	if err != nil {
		return err
	}
	file, err := os.Open(self)
	if err != nil {
		return fmt.Errorf("open the installer: %w", err)
	}
	defer file.Close()

	// Nothing is written before the payload has been read and checksummed. A
	// truncated download would otherwise produce a half-installed service that
	// fails at boot instead of an error now.
	payload, err := setup.Locate(file)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "installing %s into %s\n", setup.AppName, layout.InstallDir)
	fmt.Fprintf(out, "runtime verified: %s (%d bytes) at offset %d\n",
		setup.HumanBytes(payload.Size), payload.Size, payload.Offset)

	// Refuse a stale dev-checkout runtime BEFORE unregistering a healthy service.
	// Existing operator environment and permissions must be preserved.
	if err := layout.CheckExistingSettingsRuntime(); err != nil {
		return err
	}

	// The previous registration is removed before anything is overwritten,
	// because a running host keeps the service binary, node.exe and the port
	// locked. Unregistering a service that is not there is not an error, so a
	// fresh install pays nothing for this.
	// Retain existing SCM account/DACL/recovery settings during upgrades.
	// Recreating the service would reset the existing owner-session permissions.
	// Owner-session workers keep running even after an SCM stop. Probe both
	// locked images before stopping a healthy service or touching installed
	// files, so a busy worker can never strand a partially extracted package.
	if err := layout.CheckWorkerIdle(); err != nil {
		return err
	}
	if err := layout.CheckTrayIdle(); err != nil {
		return err
	}
	// Create a complete restore point before the service or installed files are changed.
	recovery := setup.RecoveryFor(layout)
	if err := recovery.Snapshot(); err != nil {
		return err
	}
	prepared := false
	hadService := false
	defer func() {
		if err == nil {
			return
		}
		if !prepared {
			_ = recovery.Cancel() // No program files were changed.
			return
		}
		if !recovery.HasSnapshot() {
			// A fresh install owns the program directory and new SCM registration;
			// leave any pre-existing ProgramData untouched.
			if !hadService {
				_ = cleanupNewServiceAfterInstallFailure()
				_ = removeRegistration()
				_ = os.RemoveAll(layout.InstallDir)
			}
			return
		}
		_, stopErr := svc.PrepareForUpgrade(layout.ServiceBinary())
		if stopErr != nil {
			err = fmt.Errorf("%w; automatic rollback could not stop the failed service: %v (recovery snapshot %s)", err, stopErr, recovery.Pending)
			return
		}
		if restoreErr := recovery.RestorePending(); restoreErr != nil {
			err = fmt.Errorf("%w; automatic rollback failed: %v (snapshot %s retained)", err, restoreErr, recovery.Pending)
			return
		}
		if !hadService {
			_ = cleanupNewServiceAfterInstallFailure()
			_ = removeRegistration()
		}
		if hadService {
			if registryErr := registerInstall(layout, layout.ReadAppVersion()); registryErr != nil {
				err = fmt.Errorf("%w; prior program restored but Apps registration could not be restored: %v", err, registryErr)
				return
			}
			if startErr := svc.Start(); startErr != nil {
				err = fmt.Errorf("%w; previous version restored but service restart failed: %v", err, startErr)
				return
			}
		}
		_ = recovery.Cancel()
		err = fmt.Errorf("%w; prior installed program version restored automatically", err)
	}()
	existingService, err := svc.PrepareForUpgrade(layout.ServiceBinary())
	if err != nil {
		return err
	}
	prepared = true
	hadService = existingService
	if err := setup.WaitListenerFree(setup.DefaultPort, listenerReleaseTimeout); err != nil {
		return err
	}

	files, err := setup.ExtractArchive(file, payload, layout.InstallDir, reportProgress(out))
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "\nwrote %d files to %s\n", files, layout.InstallDir)

	// Remove the exact obsolete HooshiX-owned WSL payload names on an upgrade.
	// This never accesses the user's WSL distributions or project files.
	if err := removeRetiredLinuxPayload(layout.InstallDir); err != nil {
		return err
	}

	created, err := layout.WriteSettings(layout.Settings(baseURL))
	if err != nil {
		return err
	}
	if created {
		fmt.Fprintf(out, "created %s\n", layout.SettingsFile())
	} else {
		// An upgrade keeps the document: its port, its origin and anything the
		// operator added on purpose survive a re-run of setup.
		fmt.Fprintf(out, "kept the existing %s\n", layout.SettingsFile())
	}

	// The entry in Programs runs this same image with the archive left behind, so
	// removing the install never needs the original download.
	if err := setup.WriteUninstaller(self, layout.UninstallerBinary(), payload.Offset); err != nil {
		return err
	}

	if err := registerInstall(layout, layout.ReadAppVersion()); err != nil {
		return err
	}
	if !existingService {
		if err := svc.Install(layout.ServiceBinary()); err != nil {
			return fmt.Errorf("register the service with the service control manager: %w", err)
		}
	}
	if err := svc.Start(); err != nil {
		return fmt.Errorf("%s is installed but did not start: %w\n\nRead %s, then start it from the tray icon or from services.msc.",
			setup.AppName, err, filepath.Join(layout.DataRoot, "service.log"))
	}
	// The newly installed Windows service is already running. Failure to rotate
	// snapshots must not trigger an unsafe second destructive rollback attempt.
	prepared = false
	if err := recovery.Commit(); err != nil {
		return fmt.Errorf("Windows service running but recovery snapshot needs inspection: %w", err)
	}
	return nil
}

func runUninstall(layout setup.Layout, purgeData bool, out io.Writer) error {
	// Refuse to unregister a healthy service if enrolled user workers/tray
	// still hold Program Files images; otherwise uninstall would be partial.
	if err := layout.CheckWorkerIdle(); err != nil {
		return err
	}
	if err := layout.CheckTrayIdle(); err != nil {
		return err
	}
	fmt.Fprintf(out, "removing %s\n", setup.AppName)
	if err := svc.Uninstall(); err != nil {
		return fmt.Errorf("remove the service: %w", err)
	}
	if err := removeRegistration(); err != nil {
		return err
	}
	// Everything the installer wrote lives under one directory. The data root is a
	// separate tree, and the operator's conversations, approvals and logs are in
	// it, so it is never part of an ordinary uninstall.
	if err := os.RemoveAll(layout.InstallDir); err != nil {
		return fmt.Errorf("delete %s: %w", layout.InstallDir, err)
	}
	fmt.Fprintf(out, "deleted %s\n", layout.InstallDir)
	if !purgeData {
		fmt.Fprintf(out, "kept %s\n", layout.DataRoot)
		return nil
	}
	if err := os.RemoveAll(layout.DataRoot); err != nil {
		return fmt.Errorf("delete %s: %w", layout.DataRoot, err)
	}
	fmt.Fprintf(out, "deleted %s\n", layout.DataRoot)
	return nil
}

// reportProgress writes a percentage line as the runtime is unpacked. The
// extraction takes long enough that silence looks like a hang, and the number of
// files is the only signal that says which of the two it is.
func reportProgress(out io.Writer) setup.Progress {
	last := -1
	return func(done, total int64) {
		percent := 100
		if total > 0 {
			percent = int(done * 100 / total)
		}
		if percent < last+5 && percent != 100 {
			return
		}
		last = percent
		fmt.Fprintf(out, "\rextracting %3d%% (%s of %s)", percent, setup.HumanBytes(done), setup.HumanBytes(total))
	}
}

func isUninstaller(self string) bool {
	return strings.EqualFold(filepath.Base(self), uninstallerName)
}

// quoteArguments rebuilds a command line for the elevation call, which takes one
// string rather than an argument vector. Anything holding a space or a quote
// would otherwise arrive in the elevated copy as a different argument.
func quoteArguments(arguments []string) string {
	quoted := make([]string, 0, len(arguments))
	for _, argument := range arguments {
		if strings.ContainsAny(argument, " \"") {
			argument = `"` + argument + `"`
		}
		quoted = append(quoted, argument)
	}
	return strings.Join(quoted, " ")
}

func usage() {
	fmt.Fprint(os.Stderr, `usage: hooshix-mcp-setup [--base-url https://mcp.example] [options]

Installs the HooshiX MCP server as an auto-starting Windows service from the
runtime carried inside this file, then starts it. Run it again to upgrade.

options:
  --base-url     the HTTPS origin the connector is reached on
  --repair       reinstall this Windows version, preserving settings and data
  --rollback     restore the previous program version after an upgrade
  --uninstall    remove the service, the files and the entry in Programs
  --purge-data   with --uninstall, also delete %ProgramData%\HooshiXMCP
  --help         show this message

The tray icon is started per user from the machine startup entry; closing the
icon never stops the service.
`)
}
