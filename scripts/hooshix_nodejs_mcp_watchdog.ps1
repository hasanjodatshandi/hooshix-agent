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
$McpPublicBaseURL = "https://agent.hooshix.com"

$VpsHost = "188.240.196.151"
$VpsPort = 2222
$RemoteBind = "127.0.0.1"
$LocalHost = "127.0.0.1"
$KeyPath = Join-Path $env:USERPROFILE ".ssh\hooshix_tunnel_windows_ed25519"
$SshPath = "$env:WINDIR\System32\OpenSSH\ssh.exe"

# Tunnel definitions
$Tunnels = @(
    @{
        Name        = "nodejs_mcp"
        RemotePort  = 18898
        LocalPort   = 3001
        Description = "Node.js MCP (agent.hooshix.com)"
    },
    @{
        Name        = "python_mcp"
        RemotePort  = 18899
        LocalPort   = 8899
        Description = "Python MCP (brain.hooshix.com)"
    }
)

$LogPath = "D:\MCP\HooshiXBrainMCP\.brain\logs\nodejs_mcp.jsonl"
$MaxLogBytes = 10MB
$MaxLogFiles = 5
$HeartbeatSeconds = 300
$StableConnectionSeconds = 60
$PublicHealthUrl = "$McpPublicBaseURL/health"
$PublicProbeIntervalSeconds = 10
$PublicProbeFailureThreshold = 2
$ReconnectBackoffSeconds = @(1, 2, 5, 10)

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

function Test-TcpPort {
    param([string]$HostName, [int]$Port, [int]$TimeoutMs = 750)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($HostName, $Port)
        if (-not $task.Wait($TimeoutMs)) { return $false }
        return $client.Connected
    }
    catch { return $false }
    finally { $client.Dispose() }
}

function Test-PublicHealth {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $PublicHealthUrl -Method Get -TimeoutSec 5
        if ([int]$response.StatusCode -ne 200) { return $false }
        $payload = $response.Content | ConvertFrom-Json
        return $payload.status -eq "ok"
    }
    catch { return $false }
}

function Stop-NodeProcesses {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $cmd = [string]$_.CommandLine
            $cmd -and $cmd.Contains("index-http.js") -and $cmd.Contains("$McpPort")
        } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

function Stop-AllTunnelProcesses {
    $keyLeaf = [System.IO.Path]::GetFileName($KeyPath)
    $userHostToken = "hooshixtunnel@$VpsHost"
    $portToken = "-p $VpsPort"

    Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $cmd = [string]$_.CommandLine
            $cmd -and $cmd.Contains($keyLeaf) -and $cmd.Contains($userHostToken) -and $cmd.Contains($portToken)
        } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
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
    $psi.EnvironmentVariables["MCP_PUBLIC_BASE_URL"] = $McpPublicBaseURL
    $psi.EnvironmentVariables["NODE_ENV"] = "production"

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    if (-not $proc.Start()) {
        throw "Failed to start Node.js MCP server"
    }
    return $proc
}

function Start-SshTunnel {
    param([int]$RemotePort, [int]$LocalPort)

    $sshArgs = @(
        "-NT",
        "-p", "$VpsPort",
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=5",
        "-o", "ServerAliveCountMax=3",
        "-o", "ConnectTimeout=5",
        "-i", $KeyPath,
        "-R", "$RemoteBind`:$RemotePort`:$LocalHost`:$LocalPort",
        "hooshixtunnel@$VpsHost"
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $SshPath
    $psi.Arguments = ($sshArgs -join " ")
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    if (-not $proc.Start()) {
        throw "Failed to start SSH tunnel to port $RemotePort"
    }
    return $proc
}

function Stop-TunnelByName {
    param([int]$RemotePort, [int]$LocalPort)
    $keyLeaf = [System.IO.Path]::GetFileName($KeyPath)
    $forwardToken = "$RemoteBind`:$RemotePort`:$LocalHost`:$LocalPort"
    $userHostToken = "hooshixtunnel@$VpsHost"
    $portToken = "-p $VpsPort"

    Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $cmd = [string]$_.CommandLine
            $cmd -and $cmd.Contains($keyLeaf) -and $cmd.Contains($forwardToken) -and $cmd.Contains($userHostToken) -and $cmd.Contains($portToken)
        } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
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
    if (-not (Test-Path -LiteralPath $SshPath)) { throw "OpenSSH client missing" }
    if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Tunnel private key missing" }
    if (-not (Test-Path -LiteralPath "$NodeJsDir\dist\index-http.js")) { throw "Node.js MCP build missing: $NodeJsDir\dist\index-http.js" }

    # Clean up orphans
    $orphanNodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.CommandLine -match "index-http.js" -and [string]$_.CommandLine -match "$McpPort" })
    if ($orphanNodes.Count -gt 0) {
        Write-Log -Event "orphan_node_detected" -State "cleanup" -Extra @{ orphan_count = $orphanNodes.Count }
        Stop-NodeProcesses
        Start-Sleep -Milliseconds 500
    }

    $orphanTunnels = @(Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.CommandLine -match "hooshixtunnel@$VpsHost" })
    if ($orphanTunnels.Count -gt 0) {
        Write-Log -Event "orphan_tunnel_detected" -State "cleanup" -Extra @{ orphan_count = $orphanTunnels.Count }
        Stop-AllTunnelProcesses
        Start-Sleep -Milliseconds 500
    }

    Write-Log -Event "watchdog_start" -State "running" -Extra @{ pid = $PID; tunnels = ($Tunnels | ForEach-Object { $_.Name }) -join "," }

    # --- Phase 1: Ensure Node.js MCP server is running ---
    $nodeUp = Test-TcpPort -HostName $LocalHost -Port $McpPort
    if (-not $nodeUp) {
        Write-Log -Event "node_server_starting" -State "starting"
        try {
            $nodeProc = Start-NodeMcpServer
            Start-Sleep -Seconds 2
            $nodeUp = Test-TcpPort -HostName $LocalHost -Port $McpPort
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

    # --- Phase 2: Manage tunnels in parallel ---
    $tunnelProcs = @{}

    foreach ($tunnel in $Tunnels) {
        $tunnelName = $tunnel.Name
        $remotePort = $tunnel.RemotePort
        $localPort = $tunnel.LocalPort

        # Check if local service is running
        $localUp = Test-TcpPort -HostName $LocalHost -Port $localPort
        if (-not $localUp) {
            Write-Log -Event "tunnel_skipped" -State "skipped" -Extra @{ tunnel = $tunnelName; reason = "local_port_${localPort}_not_listening" }
            continue
        }

        Write-Log -Event "tunnel_connecting" -State "starting" -Extra @{ tunnel = $tunnelName; remote_port = $remotePort; local_port = $localPort }
        try {
            $sshProc = Start-SshTunnel -RemotePort $remotePort -LocalPort $localPort
            $tunnelProcs[$tunnelName] = @{
                Process = $sshProc
                RemotePort = $remotePort
                LocalPort = $localPort
                Description = $tunnel.Description
                StartTime = [System.Diagnostics.Stopwatch]::StartNew()
                ConsecutiveFailures = 0
            }
            Write-Log -Event "tunnel_started" -State "running" -Extra @{ tunnel = $tunnelName; ssh_pid = $sshProc.Id; remote_port = $remotePort }
        } catch {
            Write-Log -Event "tunnel_start_failed" -State "error" -Extra @{ tunnel = $tunnelName; error = $_.Exception.Message }
        }
    }

    if ($tunnelProcs.Count -eq 0) {
        Write-Log -Event "no_tunnels_running" -State "warning" -Extra @{ message = "No tunnels could be started" }
    }

    # --- Phase 3: Monitor all tunnels ---
    $heartbeat = [System.Diagnostics.Stopwatch]::StartNew()
    $publicProbe = [System.Diagnostics.Stopwatch]::StartNew()
    $publicProbeFailures = 0

    while ($true) {
        Start-Sleep -Seconds 2

        # Monitor each tunnel
        foreach ($tunnelName in @($tunnelProcs.Keys)) {
            $info = $tunnelProcs[$tunnelName]
            $proc = $info.Process

            if ($proc.HasExited) {
                $exitCode = $proc.ExitCode
                $uptimeSeconds = [int]$info.StartTime.Elapsed.TotalSeconds

                if ($uptimeSeconds -ge $StableConnectionSeconds) {
                    $info.ConsecutiveFailures = 1
                } else {
                    $info.ConsecutiveFailures++
                }

                Write-Log -Event "tunnel_exit" -State "down" -Extra @{
                    tunnel = $tunnelName
                    consecutive_failures = $info.ConsecutiveFailures
                    uptime_seconds = $uptimeSeconds
                    exit_code = $exitCode
                    remote_port = $info.RemotePort
                }

                # Backoff and reconnect
                $backoffIndex = [Math]::Min($info.ConsecutiveFailures - 1, $ReconnectBackoffSeconds.Count - 1)
                $delay = $ReconnectBackoffSeconds[$backoffIndex]
                Write-Log -Event "tunnel_reconnect" -State "waiting" -Extra @{ tunnel = $tunnelName; delay_seconds = [int]$delay }
                Start-Sleep -Seconds ([int]$delay)

                # Check if local service is still up
                $localUp = Test-TcpPort -HostName $LocalHost -Port $info.LocalPort
                if (-not $localUp) {
                    Write-Log -Event "tunnel_local_down" -State "skipped" -Extra @{ tunnel = $tunnelName; local_port = $info.LocalPort }
                    $tunnelProcs.Remove($tunnelName)
                    continue
                }

                # Reconnect
                try {
                    $newProc = Start-SshTunnel -RemotePort $info.RemotePort -LocalPort $info.LocalPort
                    $info.Process = $newProc
                    $info.StartTime = [System.Diagnostics.Stopwatch]::StartNew()
                    Write-Log -Event "tunnel_reconnected" -State "running" -Extra @{ tunnel = $tunnelName; ssh_pid = $newProc.Id }
                } catch {
                    Write-Log -Event "tunnel_reconnect_failed" -State "error" -Extra @{ tunnel = $tunnelName; error = $_.Exception.Message }
                    $tunnelProcs.Remove($tunnelName)
                }
            }
        }

        # Heartbeat
        if ($heartbeat.Elapsed.TotalSeconds -ge $HeartbeatSeconds) {
            $status = @{}
            foreach ($tunnelName in $tunnelProcs.Keys) {
                $info = $tunnelProcs[$tunnelName]
                $status["${tunnelName}_ssh"] = if ($info.Process.HasExited) { "down" } else { "up" }
                $status["${tunnelName}_local"] = if (Test-TcpPort -HostName $LocalHost -Port $info.LocalPort) { "up" } else { "down" }
            }
            $status["node_mcp"] = if (Test-TcpPort -HostName $LocalHost -Port $McpPort) { "up" } else { "down" }
            $status["public_endpoint"] = if (Test-PublicHealth) { "up" } else { "down" }

            Write-Log -Event "heartbeat" -State "running" -Extra $status
            $heartbeat.Restart()
        }

        # Public health probe
        if ($publicProbe.Elapsed.TotalSeconds -ge $PublicProbeIntervalSeconds) {
            $publicUp = Test-PublicHealth
            if ($publicUp) {
                if ($publicProbeFailures -gt 0) {
                    Write-Log -Event "public_endpoint_restored" -State "up"
                }
                $publicProbeFailures = 0
            } else {
                $publicProbeFailures++
                Write-Log -Event "public_probe_failed" -State "degraded" -Extra @{ failures = $publicProbeFailures }
                if ($publicProbeFailures -ge $PublicProbeFailureThreshold) {
                    Write-Log -Event "public_health_critical" -State "restarting_all"
                    # Restart all tunnels
                    Stop-AllTunnelProcesses
                    Start-Sleep -Seconds 2
                    foreach ($tunnel in $Tunnels) {
                        $localUp = Test-TcpPort -HostName $LocalHost -Port $tunnel.LocalPort
                        if ($localUp) {
                            try {
                                $newProc = Start-SshTunnel -RemotePort $tunnel.RemotePort -LocalPort $tunnel.LocalPort
                                $tunnelProcs[$tunnel.Name] = @{
                                    Process = $newProc
                                    RemotePort = $tunnel.RemotePort
                                    LocalPort = $tunnel.LocalPort
                                    Description = $tunnel.Description
                                    StartTime = [System.Diagnostics.Stopwatch]::StartNew()
                                    ConsecutiveFailures = 0
                                }
                                Write-Log -Event "tunnel_force_restarted" -State "running" -Extra @{ tunnel = $tunnel.Name; ssh_pid = $newProc.Id }
                            } catch {
                                Write-Log -Event "tunnel_force_restart_failed" -State "error" -Extra @{ tunnel = $tunnel.Name; error = $_.Exception.Message }
                            }
                        }
                    }
                    $publicProbeFailures = 0
                }
            }
            $publicProbe.Restart()
        }

        # If no tunnels running, wait and try again
        if ($tunnelProcs.Count -eq 0) {
            Write-Log -Event "no_tunnels" -State "waiting" -Extra @{ message = "No tunnels running, retrying in 10s" }
            Start-Sleep -Seconds 10

            foreach ($tunnel in $Tunnels) {
                $localUp = Test-TcpPort -HostName $LocalHost -Port $tunnel.LocalPort
                if ($localUp) {
                    try {
                        $newProc = Start-SshTunnel -RemotePort $tunnel.RemotePort -LocalPort $tunnel.LocalPort
                        $tunnelProcs[$tunnel.Name] = @{
                            Process = $newProc
                            RemotePort = $tunnel.RemotePort
                            LocalPort = $tunnel.LocalPort
                            Description = $tunnel.Description
                            StartTime = [System.Diagnostics.Stopwatch]::StartNew()
                            ConsecutiveFailures = 0
                        }
                        Write-Log -Event "tunnel_recovery" -State "running" -Extra @{ tunnel = $tunnel.Name; ssh_pid = $newProc.Id }
                    } catch {
                        Write-Log -Event "tunnel_recovery_failed" -State "error" -Extra @{ tunnel = $tunnel.Name; error = $_.Exception.Message }
                    }
                }
            }
        }
    }
} catch {
    Write-Log -Event "watchdog_fatal" -State "failed" -Extra @{ error = $_.Exception.Message }
    exit 1
} finally {
    Stop-NodeProcesses
    Stop-AllTunnelProcesses
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}
