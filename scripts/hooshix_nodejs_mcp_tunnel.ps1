# HooshiX Node.js MCP v2 - SSH Tunnel Script
# Run this alongside the existing Python MCP tunnel

$VpsHost = "188.240.196.151"
$VpsPort = 2222
$RemoteBind = "127.0.0.1"
$RemotePort = 18898  # Different from Python MCP (18899)
$LocalHost = "127.0.0.1"
$LocalPort = 3001    # Node.js MCP server port
$KeyPath = Join-Path $env:USERPROFILE ".ssh\hooshix_tunnel_windows_ed25519"
$SshPath = "$env:WINDIR\System32\OpenSSH\ssh.exe"

Write-Host "Starting SSH tunnel: VPS:$RemotePort -> localhost:$LocalPort" -ForegroundColor Cyan

$sshArgs = @(
    "-NT",
    "-p", "$VpsPort",
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=5",
    "-o", "ServerAliveCountMax=3",
    "-i", $KeyPath,
    "-R", "$RemoteBind`:$RemotePort`:$LocalHost`:$LocalPort",
    "hooshixtunnel@$VpsHost"
)

Write-Host "SSH command: ssh $($sshArgs -join ' ')" -ForegroundColor DarkGray
& $SshPath @sshArgs
