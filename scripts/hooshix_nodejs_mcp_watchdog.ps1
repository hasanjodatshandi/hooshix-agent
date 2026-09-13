$ErrorActionPreference = "Stop"

# --- Configuration ---
$NodeJsDir = "D:\workspace\hooshix-agent"
$McpPort = 3001
# Read token from .token file (persistent, survives restarts)
$TokenFile = Join-Path $NodeJsDir ".token"
if (Test-Path $TokenFile) {
    $McpAccessToken = (Get-Content $TokenFile -Raw).Trim()
} else {
    $McpAccessToken = ""
    Write-Host "WARNING: No .token file found. Run scripts/mcp-token.ps1 reset" -ForegroundColor Yellow
}

$LogPath = "D:\MCP\HooshiXBrainMCP\.brain\logs\nodejs_mcp.jsonl"
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

function Stop-NodeProcesses {
    # NOTE: the server command line is "node dist/index-http.js" and does NOT contain
    # the port number, so matching on $McpPort never matched anything (frozen servers
    # survived every cleanup). Match on the entrypoint script instead.
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $cmd = [string]$_.CommandLine
            $cmd -and $cmd.Contains("index-http.js")
        } | ForEach-Object {
            Write-Log -Event "node_server_stop" -State "stopping" -Extra @{ pid = $_.ProcessId }
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

function Test-LocalNodeHealth {
    # HTTP-level health check. A frozen event loop still accepts TCP connections,
    # so Test-TcpPort alone cannot detect the hang that caused the 2026-09-06 outage.
    try {
        $headers = @{}
        if ($McpAccessToken) { $headers["Authorization"] = "Bearer $McpAccessToken" }
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:${McpPort}/health" -Method Get -TimeoutSec 5 -Headers $headers
        if ([int]$response.StatusCode -ne 200) { return $false }
        $payload = $response.Content | ConvertFrom-Json
        return $payload.status -eq "ok"
    }
    catch { return $false }
}

function Start-NodeMcpServer {
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "node"
    $psi.Arguments = "dist/index-http.js"
    $psi.WorkingDirectory = $NodeJsDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables["MCP_PORT"] = "$McpPort"
    $psi.EnvironmentVariables["MCP_ACCESS_TOKEN"] = $McpAccessToken
    # OAuth discovery/issuer base URL — REQUIRED so discovery documents
    # advertise the public tunnel host (agent.hooshix.com), not localhost.
    # Without it, ChatGPT rejects the connector with "doesn't support
    # RFC 7591 Dynamic Client Registration" (issuer/endpoint mismatch).
    $psi.EnvironmentVariables["MCP_PUBLIC_BASE_URL"] = "https://agent.hooshix.com"
    $psi.EnvironmentVariables["NODE_ENV"] = "production"

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    if (-not $proc.Start()) {
        throw "Failed to start Node.js MCP server"
    }
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
    if (-not (Test-Path -LiteralPath "$NodeJsDir\dist\index-http.js")) { throw "Node.js MCP build missing: $NodeJsDir\dist\index-http.js" }

    # Clean up orphans
    $orphanNodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.CommandLine -match "index-http.js" -and [string]$_.CommandLine -match "dist" })
    if ($orphanNodes.Count -gt 0) {
        Write-Log -Event "orphan_node_detected" -State "cleanup" -Extra @{ orphan_count = $orphanNodes.Count }
        Stop-NodeProcesses
        Start-Sleep -Milliseconds 500
    }

    Write-Log -Event "watchdog_start" -State "running" -Extra @{ pid = $PID; mode = "node_only" }

    # --- Phase 1: Ensure Node.js MCP server is running ---
    $nodeUp = Test-LocalNodeHealth
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
                    Write-Log -Event "node_health_critical" -State "restarting_node"
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
