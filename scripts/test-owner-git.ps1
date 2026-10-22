#Requires -Version 5.1
<#
.SYNOPSIS
  Non-admin owner-session Git worker smoke against a disposable repository.
.DESCRIPTION
  Validates Git IPC and opt-in/revocation without modifying user repositories,
  global Git trust, the MCP service, or installed software.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) {
  throw 'Use ordinary Windows PowerShell, not Linux or WSL.'
}
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($userSid -eq 'S-1-5-18') { throw 'Do not test a user-owned Git worker as LocalSystem.' }

$repo = Split-Path -Parent $PSScriptRoot
$goModule = Join-Path $repo 'deploy\windows'
$worker = Join-Path $goModule 'build\bin\hooshix-git-worker-owner-smoke.exe'
$anchor = Join-Path ([IO.Path]::GetTempPath()) ('hooshix-git-owner-smoke-' + [Guid]::NewGuid().ToString('N'))
$enrolled = $false
try {
  New-Item -ItemType Directory -Path $anchor -ErrorAction Stop | Out-Null
  $ownerSid = (Get-Acl -LiteralPath $anchor).GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $userSid) { throw 'The disposable repository is not owned by this signed-in user.' }
  New-Item -ItemType Directory -Path (Split-Path -Parent $worker) -Force | Out-Null
  Push-Location $goModule
  try {
    & go build -buildvcs=false -trimpath -o $worker './cmd/hooshix-git-worker'
    if ($LASTEXITCODE -ne 0) { throw 'Building the Git worker failed.' }
  } finally { Pop-Location }

  & git -C $anchor init -b main | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot initialize disposable Git repository.' }
  & git -C $anchor config --local user.name 'HooshiX Disposable Test'
  & git -C $anchor config --local user.email 'hooshix-disposable@example.invalid'
  Set-Content -LiteralPath (Join-Path $anchor 'probe.txt') -Value 'owner-git-worker-probe' -Encoding Ascii

  & $worker -mode enroll -root $anchor | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Git worker enrollment failed.' }
  $enrolled = $true

  function Invoke-OwnerGit([string]$toolName,[string[]]$gitArgs) {
    $result = $null
    for ($attempt=0; $attempt -lt 25; $attempt++) {
      $json = & $worker -mode proxy -root $anchor -tool $toolName -- @gitArgs
      if ($LASTEXITCODE -ne 0 -or -not $json) { throw 'Owner Git proxy transport failed.' }
      $result = $json | ConvertFrom-Json
      if ($result.exitCode -eq 0) { return $result }
      if ($result.exitCode -ne 126) { throw ('Git worker failed: '+$toolName+' '+$result.stderr) }
      Start-Sleep -Milliseconds 200
    }
    throw ('Owner Git worker was not reachable: '+$toolName+' '+$result.stderr)
  }

  $status = Invoke-OwnerGit 'git_status' @('status','--porcelain=v1','--branch')
  if (-not $status.stdout.Contains('probe.txt')) { throw 'Git status omitted the disposable file.' }
  $null = Invoke-OwnerGit 'git_add' @('add','--','probe.txt')
  $null = Invoke-OwnerGit 'git_commit' @('commit','-m','Disposable Git worker smoke')
  $history = Invoke-OwnerGit 'git_log' @('log','--max-count=1','--oneline','--decorate')
  if (-not $history.stdout.Contains('Disposable Git worker smoke')) { throw 'Owner Git log was incorrect.' }

  # This must fail before executing anything on the host.
  $invalid = & $worker -mode proxy -root $anchor -tool 'git_add' -- add -- '..\outside'
  $denied = $invalid | ConvertFrom-Json
  if ($denied.exitCode -ne 126) { throw 'Traversal operation was not rejected.' }
  Write-Output ('GIT_OWNER_BRIDGE_OK user='+([Security.Principal.WindowsIdentity]::GetCurrent().Name))
} finally {
  if ($enrolled) {
    & $worker -mode unenroll -root $anchor | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Git worker revocation failed; review only its HKCU Run entry.' }
  }
  if (Test-Path -LiteralPath $anchor) { Remove-Item -LiteralPath $anchor -Recurse -Force }
}
