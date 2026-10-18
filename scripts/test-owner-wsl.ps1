#Requires -Version 5.1
<#
.SYNOPSIS
  Checks owner-session WSL IPC without restarting or installing the MCP service.
.DESCRIPTION
  Compiles the source worker, enrolls a disposable Windows anchor owned by
  the signed-in caller, executes a bounded Linux smoke command, then revokes
  the temporary HKCU startup entry even on failure. No elevated rights needed.
.EXAMPLE
  .\scripts\test-owner-wsl.ps1 -Distro 'Ubuntu' -LinuxRoot '/home/coder/workspace/Hooshix'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')][string]$Distro,
  [Parameter(Mandatory=$true)][ValidatePattern('^/[^\r\n]*$')][string]$LinuxRoot
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
  throw 'This smoke test runs in Windows PowerShell, not WSL/bash.'
}
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($userSid -eq 'S-1-5-18') { throw 'Do not run WSL smoke tests under LocalSystem.' }
$repo = Split-Path -Parent $PSScriptRoot
$goModule = Join-Path $repo 'deploy\windows'
$buildPath = Join-Path $goModule 'build\bin\hooshix-git-worker-wsl-check.exe'
$anchor = Join-Path ([IO.Path]::GetTempPath()) ('hooshix-wsl-owner-smoke-' + [Guid]::NewGuid().ToString('N'))
$enrolled = $false
try {
  New-Item -ItemType Directory -Path $anchor -ErrorAction Stop | Out-Null
  $ownerSid = (Get-Acl -LiteralPath $anchor).GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $userSid) { throw 'Temporary Windows anchor is not owned by the signed-in user.' }
  New-Item -ItemType Directory -Path (Split-Path -Parent $buildPath) -Force | Out-Null
  Push-Location $goModule
  try {
    & go build -buildvcs=false -trimpath -o $buildPath './cmd/hooshix-git-worker'
    if ($LASTEXITCODE -ne 0) { throw 'Owner worker Go build failed.' }
  } finally { Pop-Location }
  & $buildPath -mode wsl-enroll -root $anchor -distro $Distro -linux-root $LinuxRoot
  if ($LASTEXITCODE -ne 0) { throw 'Owner WSL enrollment failed. Check distro and Linux directory.' }
  $enrolled = $true
  $ok = $false
  for ($n=0; $n -lt 25; $n++) {
    $json = & $buildPath -mode wsl-proxy -root $anchor -wsl-command 'printf WSL_BRIDGE_OK; id -un; pwd'
    if ($LASTEXITCODE -eq 0 -and $json) {
      $response = $json | ConvertFrom-Json
      if ($response.exitCode -eq 0 -and $response.stdout.Contains('WSL_BRIDGE_OK')) {
        Write-Output ('WSL_VALIDATED=' + $response.stdout.Trim())
        $ok = $true
        break
      }
      if ($response.exitCode -ne 126) {
        throw ('WSL process failed: code=' + $response.exitCode + ' stderr=' + $response.stderr)
      }
    }
    Start-Sleep -Milliseconds 200
  }
  if (-not $ok) { throw 'Owner WSL worker never completed the IPC handshake.' }
} finally {
  if ($enrolled) {
    & $buildPath -mode wsl-unenroll -root $anchor | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning 'WSL worker revoke failed; inspect the matching HKCU Run entry.' }
  }
  if (Test-Path -LiteralPath $anchor) { Remove-Item -LiteralPath $anchor -Recurse -Force }
}