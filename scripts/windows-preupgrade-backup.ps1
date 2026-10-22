#Requires -Version 5.1
<#
.SYNOPSIS
  Creates a consistent, ACL-protected snapshot of the installed HooshiX MCP
  service before a separate administrator-run installer upgrade.
.DESCRIPTION
  This script NEVER installs, uninstalls, changes the service account, or
  deletes a service. It briefly stops HooshiXMCP for an offline database copy,
  snapshots the installed executable tree and ProgramData, then always attempts
  to restart the original service in a finally block.
  Run in an INDEPENDENT elevated Windows PowerShell window, not via MCP exec.
#>
[CmdletBinding()]
param(
  [string] $BackupRoot = 'C:\ProgramData\HooshiXMCP-Recovery'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$serviceName = 'HooshiXMCP'
$install = 'C:\Program Files\HooshiX MCP'
$data = 'C:\ProgramData\HooshiXMCP'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Start an independent Windows PowerShell as Administrator; never launch this through the MCP service.'
}
foreach ($p in @($install, $data)) {
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { throw "Missing existing installation directory: $p" }
}
$svc = Get-Service -Name $serviceName -ErrorAction Stop
$serviceAccount = (Get-CimInstance Win32_Service -Filter "Name='HooshiXMCP'" -ErrorAction Stop).StartName
if ([string]::IsNullOrWhiteSpace($serviceAccount)) { throw 'Service logon identity unavailable; no backup or service change.' }
if ($svc.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
  throw "Expected a running $serviceName service; currently $($svc.Status). No action taken."
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $BackupRoot $stamp
if (Test-Path -LiteralPath $destination) { throw "Refusing overwrite: $destination" }

# These backups include credentials and private application data. Constrain
# access BEFORE copying anything and fail closed if DACL cannot be secured.
New-Item -ItemType Directory -Path $destination -Force | Out-Null
& icacls.exe $destination '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot set protected backup directory ACL; no service changes performed.' }
foreach ($access in (Get-Acl -LiteralPath $destination).Access) {
  if ($access.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
  $sid = $access.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($sid -notin @('S-1-5-18','S-1-5-32-544')) {
    throw "Unexpected backup directory ACL principal $sid; no service changes performed."
  }
}
$meta = Join-Path $destination 'service-preflight'
New-Item -ItemType Directory -Path $meta | Out-Null
& sc.exe qc $serviceName | Out-File -LiteralPath (Join-Path $meta 'service-config.txt') -Encoding UTF8
& sc.exe qfailure $serviceName | Out-File -LiteralPath (Join-Path $meta 'service-failure-policy.txt') -Encoding UTF8
$exe = Join-Path $install 'bin\hooshix-mcp-service.exe'
$originalHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash

function Copy-TreeSafely([string]$source,[string]$target) {
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  & robocopy.exe $source $target /E /XJ /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Robocopy failed with code $LASTEXITCODE while backing up $source" }
}

$stopped = $false
$copySucceeded = $false
try {
  Stop-Service -Name $serviceName -ErrorAction Stop
  $stopped = $true
  (Get-Service -Name $serviceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(60))
  Copy-TreeSafely $install (Join-Path $destination 'installed-program-files')
  Copy-TreeSafely $data (Join-Path $destination 'installed-program-data')
  $copySucceeded = $true
} finally {
  if ($stopped) {
    # The original deployment must come back even if a backup fails.
    try {
      Start-Service -Name $serviceName -ErrorAction Stop
      (Get-Service -Name $serviceName).WaitForStatus(
        [ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(60))
    } catch {
      Write-Error "CRITICAL: Backup stage could not restart $serviceName. Restore service from independent console. $($_.Exception.Message)"
      throw
    }
  }
}
if (-not $copySucceeded) { throw 'Backup did not complete; do not run installer.' }
$record = [ordered]@{
  service = $serviceName
  serviceAccount = $serviceAccount
  capturedAt = (Get-Date).ToString('o')
  backupPath = $destination
  originalBinarySha256 = $originalHash
  sourceProgramFiles = $install
  sourceProgramData = $data
  consistentOfflineCopy = $true
  serviceRestoredToRunning = ((Get-Service $serviceName).Status -eq 'Running')
}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $meta 'snapshot-manifest.json') -Encoding UTF8
Write-Output "HOOSHIX_BACKUP_OK=$destination"
Write-Output "ORIGINAL_BINARY_SHA256=$originalHash"
Write-Output "SERVICE_RESTARTED=$($record.serviceRestoredToRunning)"
Write-Output 'This is only a backup. It has NOT upgraded the service.'
