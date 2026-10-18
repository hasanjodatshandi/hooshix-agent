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
	)
	flag.Usage = usage
	flag.Parse()

	if *verify {
		if *uninstall || *purgeData {
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
	summary, err := run(self, *baseURL, *uninstall || isUninstaller(self), *purgeData, os.Stdout)
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
func run(self, baseURL string, uninstalling, purgeData bool, out io.Writer) (string, error) {
	layout, err := setup.DefaultLayout()
	if err != nil {
		return "", err
	}
	if uninstalling {
		if err := runUninstall(layout, purgeData, out); err != nil {
			return "", err
		}
		return setup.AppName + " has been removed. The service, the installed files and the entry in Programs are gone.", nil
	}
	if err := runInstall(layout, self, baseURL, out); err != nil {
		return "", err
	}
	return setup.AppName + " is installed and running as a Windows service.\n\n" +
		"Look for the coloured icon in the notification area: green means ChatGPT can reach it. " +
		"The icon appears at the next sign-in, and the tray menu starts, stops and restarts the service.", nil
}

func runInstall(layout setup.Layout, self, baseURL string, out io.Writer) error {
	baseURL, err := setup.ValidatePublicBaseURL(baseURL)
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

	// The previous registration is removed before anything is overwritten,
	// because a running host keeps the service binary, node.exe and the port
	// locked. Unregistering a service that is not there is not an error, so a
	// fresh install pays nothing for this.
	if err := svc.Uninstall(); err != nil {
		return fmt.Errorf("stop the service from the previous install: %w", err)
	}
	if err := setup.WaitListenerFree(setup.DefaultPort, listenerReleaseTimeout); err != nil {
		return err
	}
	if err := layout.CheckTrayIdle(); err != nil {
		return err
	}

	files, err := setup.ExtractArchive(file, payload, layout.InstallDir, reportProgress(out))
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "\nwrote %d files to %s\n", files, layout.InstallDir)

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
	if err := svc.Install(layout.ServiceBinary()); err != nil {
		return fmt.Errorf("register the service with the service control manager: %w", err)
	}
	if err := svc.Start(); err != nil {
		return fmt.Errorf("%s is installed but did not start: %w\n\nRead %s, then start it from the tray icon or from services.msc.",
			setup.AppName, err, filepath.Join(layout.DataRoot, "service.log"))
	}
	return nil
}

func runUninstall(layout setup.Layout, purgeData bool, out io.Writer) error {
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
  --uninstall    remove the service, the files and the entry in Programs
  --purge-data   with --uninstall, also delete %ProgramData%\HooshiXMCP
  --help         show this message

The tray icon is started per user from the machine startup entry; closing the
icon never stops the service.
`)
}