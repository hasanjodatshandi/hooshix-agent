#Requires -Version 5.1
<#
.SYNOPSIS
  Emergency rollback to an offline HooshiX MCP snapshot.
.DESCRIPTION
  Run ONLY from an independent elevated Windows PowerShell window.
  Overwrites installed binaries, database and settings with a VERIFIED
  snapshot made by windows-preupgrade-backup.ps1. Never launched by MCP.
  Re-registers the original service using the saved service executable,
  including HooshiX's defined service recovery and interactive-user ACLs.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BackupPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this recovery script independently as Administrator.'
}
$root=[IO.Path]::GetFullPath('C:\ProgramData\HooshiXMCP-Recovery').TrimEnd('\')
$backup=[IO.Path]::GetFullPath($BackupPath).TrimEnd('\')
if (-not $backup.StartsWith(($root+'\'),[StringComparison]::OrdinalIgnoreCase)) {
  throw 'BackupPath is not beneath the protected HooshiX recovery directory.'
}
$manifestFile=Join-Path $backup 'service-preflight\snapshot-manifest.json'
if (-not (Test-Path -LiteralPath $manifestFile)) { throw 'Recovery manifest missing.' }
$manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if ($manifest.service -ne 'HooshiXMCP' -or -not $manifest.consistentOfflineCopy -or
    -not $manifest.serviceRestoredToRunning -or $manifest.backupPath -ne $backup) {
  throw 'Recovery manifest failed consistency or service verification.'
}
$install='C:\Program Files\HooshiX MCP'
$data='C:\ProgramData\HooshiXMCP'
$sourceInstall=Join-Path $backup 'installed-program-files'
$sourceData=Join-Path $backup 'installed-program-data'
$oldExe=Join-Path $sourceInstall 'bin\hooshix-mcp-service.exe'
if (-not (Test-Path -LiteralPath $oldExe -PathType Leaf) -or
    -not (Test-Path -LiteralPath $sourceData -PathType Container)) {
  throw 'Recovery snapshot missing old service binary or data.'
}
$hash=(Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash
if ($hash -ne $manifest.originalBinarySha256) { throw 'Recovery service binary SHA-256 mismatch.' }
function Copy-Tree([string]$source,[string]$dest,[bool]$mirror) {
  $args = @($source,$dest)
  if ($mirror) { $args += '/MIR' } else { $args += '/E' }
  $args += @('/XJ','/COPY:DAT','/DCOPY:DAT','/R:1','/W:1','/NFL','/NDL','/NP')
  & robocopy.exe @args | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Robocopy rollback failed: $LASTEXITCODE from $source" }
}
Write-Warning "ROLLBACK: This overwrites the installed service AND database/settings from $backup."
# Existing SCM service may be absent after a failed update; either is allowed.
$svc=Get-Service HooshiXMCP -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
  Stop-Service HooshiXMCP -ErrorAction Stop
  (Get-Service HooshiXMCP).WaitForStatus(
     [ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(60))
}
Copy-Tree $sourceInstall $install $true
Copy-Tree $sourceData $data $false
$restoredExe=Join-Path $install 'bin\hooshix-mcp-service.exe'
if ((Get-FileHash $restoredExe -Algorithm SHA256).Hash -ne $manifest.originalBinarySha256) {
  throw 'Restored binary failed SHA-256 check.'
}
& $restoredExe service install
if ($LASTEXITCODE -ne 0) { throw 'Old SCM service registration failed; inspect independent console.' }
& $restoredExe service start
if ($LASTEXITCODE -ne 0) { throw 'Old SCM service start failed; inspect independent console.' }
(Get-Service HooshiXMCP).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running,
   [TimeSpan]::FromSeconds(60))
Write-Output "HOOSHIX_ROLLBACK_SERVICE_RUNNING=True"
Write-Output 'Program Files and application data restored; inspect HTTP health and Programs registration separately.'
