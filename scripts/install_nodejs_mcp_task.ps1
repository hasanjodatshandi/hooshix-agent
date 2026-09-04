#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$TaskName = "HooshiX Node.js MCP v2"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WatchdogPath = Join-Path $ScriptDir "hooshix_nodejs_mcp_watchdog.ps1"
$TaskUser = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path -LiteralPath $WatchdogPath)) {
    throw "Watchdog script not found: $WatchdogPath"
}

# Use PowerShell directly (no external launcher needed)
$psExe = "powershell.exe"
$psArgs = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchdogPath`""

$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument $psArgs

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $TaskUser

$principal = New-ScheduledTaskPrincipal `
    -UserId $TaskUser `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Maintains HooshiX MCP servers: Node.js (port 3001) + SSH tunnels (VPS:18898->3001, VPS:18899->8899) with auto-reconnect and health monitoring."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName
$registered | Select-Object TaskName, State | Format-Table -Auto
Write-Host "TASK_INSTALL=PASS"
Write-Host ""
Write-Host "Task '$TaskName' installed successfully."
Write-Host "  - Starts on login"
Write-Host "  - Auto-restarts on failure"
Write-Host "  - Runs both SSH tunnels + Node.js MCP server"
Write-Host ""
Write-Host "To start now: Start-ScheduledTask -TaskName '$TaskName'"
