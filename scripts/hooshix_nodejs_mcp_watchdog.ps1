$ErrorActionPreference = "Stop"

# --- Configuration ---
$NodeJsDir = Split-Path -Parent $PSScriptRoot
$McpPort = 3001
$LogPath = "$NodeJsDir\logs\watchdog.jsonl"
$MaxLogBytes = 10MB
$MaxLogFiles = 5
$HeartbeatSeconds = 300
$NodeProbeIntervalSeconds = 10
$NodeProbeFailureThreshold = 3

# --- Functions ---

function Hide-OwnConsole {
    if (-not ("HooshiX.Native.ConsoleWindow2" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace HooshiX.Native {
    public static class ConsoleWindow2 {
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    }
}
"@
    }
    $handle = [HooshiX.Native.ConsoleWindow2]::GetConsoleWindow()
    if ($handle -ne [IntPtr]::Zero) {
        [void][HooshiX.Native.ConsoleWindow2]::ShowWindowAsync($handle, 0)
    }
}

function Rotate-Log {
    if (-not (Test-Path -LiteralPath $LogPath)) { return }
    $length = (Get-Item -LiteralPath $LogPath).Length
    if ($length -lt $MaxLogBytes) { return }
    for ($i = $MaxLogFiles - 1; $i -ge 1; $i--) {
        $src = "$LogPath.$i"
        $dst = "$LogPath." + ($i + 1)
        if (Test-Path -LiteralPath $src) {
            if ($i -eq ($MaxLogFiles - 1) -and (Test-Path -LiteralPath $dst)) {
                Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue
            }
            Move-Item -LiteralPath $src -Destination $dst -Force
        }
    }
    Move-Item -LiteralPath $LogPath -Destination "$LogPath.1" -Force
}

function Write-Log {
    param(
        [Parameter(Mandatory=$true)][string]$Event,
        [Parameter(Mandatory=$true)][string]$State,
        [hashtable]$Extra
    )
    if (-not $Extra) { $Extra = @{} }
    Rotate-Log
    $record = [ordered]@{
        ts = [DateTimeOffset]::UtcNow.ToString("o")
        component = "hooshix_watchdog"
        event = $Event
        state = $State
    }
    foreach ($key in $Extra.Keys) { $record[$key] = $Extra[$key] }
    $json = $record | ConvertTo-Json -Compress -Depth 4
    Add-Content -LiteralPath $LogPath -Value $json -Encoding utf8
}

# Only a child process started by THIS watchdog instance can be terminated.
# Do not discover/kill other node.exe instances by port or command line.
$script:OwnedNodeProcess = $null

function Stop-NodeProcesses {
    $owned = $script:OwnedNodeProcess
    if ($null -eq $owned) {
        Write-Log -Event "node_server_not_owned" -State "skipped"
        return
    }
    try {
        if (-not $owned.HasExited) {
            Write-Log -Event "node_server_stop" -State "stopping" -Extra @{ pid = $owned.Id }
            Stop-Process -InputObject $owned -Force -ErrorAction SilentlyContinue
        }
    } finally {
        $owned.Dispose()
        $script:OwnedNodeProcess = $null
    }
}

function Test-LocalNodeHealth {
    # HTTP-level health check. A frozen event loop still accepts TCP connections,
    # so Test-TcpPort alone cannot detect the hang that caused the 2026-09-06 outage.
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:${McpPort}/health/live" -Method Get -TimeoutSec 5
        if ([int]$response.StatusCode -ne 200) { return $false }
        $payload = $response.Content | ConvertFrom-Json
        return $payload.status -eq "ok"
    }
    catch { return $false }
}

function Start-NodeMcpServer {
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $script:NodeExecutable
    $psi.Arguments = "dist/index-http.js"
    $psi.WorkingDirectory = $NodeJsDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    # Do not redirect without an async reader: a full stderr pipe can block the child.
    $psi.RedirectStandardError = $false
    $psi.EnvironmentVariables["HOOSHIX_HTTP_PORT"] = "$McpPort"
    # Permission ceiling. execute_command / package_manage / set_workspace require
    # DEVELOPER_MODE; inheriting an ad-hoc session value silently regressed the
    # assistant to PROJECT_ACCESS once, so pin it here unconditionally.
    $psi.EnvironmentVariables["HOOSHIX_PERMISSION_LEVEL"] = "DEVELOPER_MODE"
    # OAuth discovery/issuer base URL — REQUIRED so discovery documents
    # advertise the public tunnel host (agent.hooshix.com), not localhost.
    # Without it, ChatGPT rejects the connector with "doesn't support
    # RFC 7591 Dynamic Client Registration" (issuer/endpoint mismatch).
    # HOOSHIX_PUBLIC_BASE_URL is inherited only from the operator's approved service environment.
    $psi.EnvironmentVariables["NODE_ENV"] = "production"

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    if (-not $proc.Start()) {
        throw "Failed to start Node.js MCP server"
    }
    # Hold the Process object created by this watchdog, not a discovered PID.
    $script:OwnedNodeProcess = $proc
    return $proc
}

# --- Main ---

Hide-OwnConsole

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($false, "HooshiXNodeJsMcpWatchdog", [ref]$createdNew)
if (-not $createdNew) {
    Write-Log -Event "watchdog_duplicate" -State "ignored"
    exit 0
}

try {
    # Validate prerequisites
    $nodeCommand = Get-Command node -ErrorAction Stop
    $script:NodeExecutable = $nodeCommand.Source
    $nodeVersion = & $script:NodeExecutable --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24[.]') { throw "HooshiX requires Node.js 24; detected $nodeVersion" }
    $pnpmCommand = Get-Command pnpm -ErrorAction Stop
    $pnpmVersion = & $pnpmCommand.Source --version
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion.Trim() -ne '11.24.0') { throw "HooshiX requires pnpm 11.24.0; detected $pnpmVersion" }
    if (-not (Test-Path -LiteralPath "$NodeJsDir\dist\index-http.js")) { throw "Node.js MCP build missing: $NodeJsDir\dist\index-http.js" }

    # Existing Node.js processes are not owned by this watchdog instance.
    # Never kill a discovered process on startup, even if its command line
    # resembles HooshiX. An unhealthy unowned server requires operator review.
    $existingNodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.CommandLine -match "index-http.js" -and [string]$_.CommandLine -match "dist" })
    if ($existingNodes.Count -gt 0) {
        Write-Log -Event "unowned_node_detected" -State "left_intact" -Extra @{ count = $existingNodes.Count }
    }

    Write-Log -Event "watchdog_start" -State "running" -Extra @{ pid = $PID; mode = "node_only" }

    # --- Phase 1: Ensure Node.js MCP server is running ---
    $nodeUp = Test-LocalNodeHealth
    if (-not $nodeUp -and $existingNodes.Count -gt 0) {
        Write-Log -Event "unowned_node_unhealthy" -State "operator_required" -Extra @{ count = $existingNodes.Count }
        throw "An unowned index-http.js process exists but is unhealthy. Refusing to start or terminate any server until ownership is verified."
    }
    if (-not $nodeUp) {
        Write-Log -Event "node_server_starting" -State "starting"
        try {
            $nodeProc = Start-NodeMcpServer
            Start-Sleep -Seconds 2
            $nodeUp = Test-LocalNodeHealth
            if ($nodeUp) {
                Write-Log -Event "node_server_started" -State "running" -Extra @{ pid = $nodeProc.Id }
            } else {
                Write-Log -Event "node_server_failed" -State "failed"
            }
        } catch {
            Write-Log -Event "node_server_error" -State "error" -Extra @{ error = $_.Exception.Message }
        }
    } else {
        Write-Log -Event "node_server_already_running" -State "running"
    }

    # --- Phase 2: Monitor node server health ---
    $heartbeat = [System.Diagnostics.Stopwatch]::StartNew()
    $nodeProbe = [System.Diagnostics.Stopwatch]::StartNew()
    $nodeHealthFailures = 0

    while ($true) {
        Start-Sleep -Seconds 2

        # Heartbeat
        if ($heartbeat.Elapsed.TotalSeconds -ge $HeartbeatSeconds) {
            $status = @{ node_mcp = if (Test-LocalNodeHealth) { "up" } else { "down" } }
            Write-Log -Event "heartbeat" -State "running" -Extra $status
            $heartbeat.Restart()
        }

        # Node server health watchdog: restart when the HTTP health check fails
        # repeatedly (covers both crashed and frozen-event-loop servers).
        if ($nodeProbe.Elapsed.TotalSeconds -ge $NodeProbeIntervalSeconds) {
            if (Test-LocalNodeHealth) {
                if ($nodeHealthFailures -gt 0) {
                    Write-Log -Event "node_health_restored" -State "up"
                }
                $nodeHealthFailures = 0
            } else {
                $nodeHealthFailures++
                Write-Log -Event "node_health_failed" -State "degraded" -Extra @{ failures = $nodeHealthFailures }
                if ($nodeHealthFailures -ge $NodeProbeFailureThreshold) {
                    if ($null -eq $script:OwnedNodeProcess) {
                        Write-Log -Event "node_health_critical_unowned" -State "operator_required" -Extra @{ failures = $nodeHealthFailures }
                        throw "Node health failed repeatedly, but the listening process is not owned by this watchdog. Refusing to kill or replace it."
                    }
                    Write-Log -Event "node_health_critical" -State "restarting_owned_node"
                    Stop-NodeProcesses
                    Start-Sleep -Seconds 2
                    try {
                        $newNode = Start-NodeMcpServer
                        Start-Sleep -Seconds 2
                        if (Test-LocalNodeHealth) {
                            Write-Log -Event "node_server_restarted" -State "running" -Extra @{ pid = $newNode.Id }
                        } else {
                            Write-Log -Event "node_server_restart_unhealthy" -State "failed" -Extra @{ pid = $newNode.Id }
                        }
                    } catch {
                        Write-Log -Event "node_server_restart_failed" -State "error" -Extra @{ error = $_.Exception.Message }
                    }
                    $nodeHealthFailures = 0
                }
            }
            $nodeProbe.Restart()
        }
    }
} catch {
    Write-Log -Event "watchdog_fatal" -State "failed" -Extra @{ error = $_.Exception.Message }
    exit 1
} finally {
    Stop-NodeProcesses
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}
