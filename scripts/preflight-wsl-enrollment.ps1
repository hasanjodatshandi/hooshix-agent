#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only readiness check before enrolling a WSL workspace in HooshiX MCP.
.DESCRIPTION
  Does NOT enroll workers, add a workspace root, write to WSL, change ACLs,
  change HKCU, install binaries, stop services, or request elevation.
  Run in a normal signed-in Windows user session before explicit enrollment.
  Output is machine-readable JSON and a nonzero exit when a blocker exists.
.EXAMPLE
  .\preflight-wsl-enrollment.ps1 -Distro Ubuntu -LinuxRoot '/home/coder/workspace/Hooshix' -WindowsOwnerAnchor 'D:\workspace'
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')][string]$Distro,
 [Parameter(Mandatory=$true)][string]$LinuxRoot,
 [Parameter(Mandatory=$true)][string]$WindowsOwnerAnchor,
 [string]$InstallRoot='C:\Program Files\HooshiX MCP'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$blockers=New-Object System.Collections.Generic.List[string]
$warnings=New-Object System.Collections.Generic.List[string]
$details=[ordered]@{
 distro=$Distro
 linuxRoot=$LinuxRoot
 workspaceUri=('wsl://'+$Distro+$LinuxRoot)
 ownerSid=$null
 anchorOwnerSid=$null
 ownerWindowsRoot=$null
 windowsMcpService=$null
 windowsMcpServiceAccount=$null
 installedWorker=$false
 installedLinuxPayload=$false
 wslReachable=$false
 wslUser=$null
 linuxRootCanonical=$false
 installedLinuxBroker=$false
 payloadDigestMatchesInstalledLinuxBroker=$false
}
function Check-WSLCommand([string[]]$Arguments){
 try{
  # Missing optional broker targets can write stderr. Under PowerShell 5.1,
  # NativeCommandError must not abort the entire read-only readiness scan.
  $ErrorActionPreference="Continue"
  $output=@(& wsl.exe --distribution $Distro --exec @Arguments 2>$null)
  if($LASTEXITCODE -ne 0){return $null}
  return (($output -join [Environment]::NewLine).Trim())
 }catch{return $null}
}
try{
 $windowsIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $details.ownerSid=$windowsIdentity.User.Value
 if($details.ownerSid -eq 'S-1-5-18'){$blockers.Add('LOCAL_SYSTEM_NOT_ALLOWED')}
 $currentPrincipal=New-Object Security.Principal.WindowsPrincipal($windowsIdentity)
 if($currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  $blockers.Add('RUN_UNELEVATED_OWNER_SESSION')
 }
 if(-not $LinuxRoot.StartsWith('/') -or $LinuxRoot.StartsWith('//') -or
   $LinuxRoot.Contains('\\') -or $LinuxRoot.Contains([char]0) -or
   $LinuxRoot.Contains([char]10) -or $LinuxRoot.Contains([char]13) -or
   $LinuxRoot.Contains('"') -or $LinuxRoot.Contains('%') -or
   $LinuxRoot.Split('/') -contains '..' -or $LinuxRoot.Split('/') -contains '.' -or
   $LinuxRoot.Length -gt 2048){
  $blockers.Add('INVALID_LINUX_ROOT')
 }else{
  $actualRoot=Check-WSLCommand @('/usr/bin/realpath','-e','--',$LinuxRoot)
  if($actualRoot -ceq $LinuxRoot){$details.linuxRootCanonical=$true}
  else{$blockers.Add('LINUX_ROOT_NOT_CANONICAL_OR_UNAVAILABLE')}
 }
 if(-not [IO.Path]::IsPathRooted($WindowsOwnerAnchor) -or
   $WindowsOwnerAnchor.StartsWith('\\') -or
   $WindowsOwnerAnchor.Contains([char]0)){
  $blockers.Add('OWNER_ANCHOR_MUST_BE_LOCAL_ABSOLUTE_WINDOWS_PATH')
 }else{
  try{
   $resolved=(Resolve-Path -LiteralPath $WindowsOwnerAnchor -ErrorAction Stop).Path
   $details.ownerWindowsRoot=$resolved
   $details.anchorOwnerSid=(Get-Acl -LiteralPath $resolved).GetOwner(
       [Security.Principal.SecurityIdentifier]).Value
   if($details.anchorOwnerSid -ne $details.ownerSid){
    $blockers.Add('OWNER_ANCHOR_SID_MISMATCH')
   }
  }catch{$blockers.Add('OWNER_ANCHOR_MISSING_OR_UNREADABLE')}
 }
 $service=Get-CimInstance Win32_Service -Filter "Name='HooshiXMCP'" -ErrorAction SilentlyContinue
 if($null -eq $service){
  $blockers.Add('MCP_SERVICE_NOT_INSTALLED')
 }else{
  $details.windowsMcpService=$service.State
  $details.windowsMcpServiceAccount=$service.StartName
  if($service.State -ne 'Running'){$blockers.Add('MCP_SERVICE_NOT_RUNNING')}
  if($service.StartName -match 'LocalSystem|LocalService|NetworkService|^NT AUTHORITY\\'){
   $blockers.Add('MCP_SERVICE_IDENTITY_CANNOT_BRIDGE_OWNER_WSL')
  }
 }
 $worker=Join-Path $InstallRoot 'bin\hooshix-git-worker.exe'
 $linuxPayload=Join-Path $InstallRoot 'bin\hooshix-wsl-fs-broker-linux-amd64'
 $details.installedWorker=Test-Path -LiteralPath $worker -PathType Leaf
 $details.installedLinuxPayload=Test-Path -LiteralPath $linuxPayload -PathType Leaf
 if(-not $details.installedWorker){$blockers.Add('WINDOWS_WORKER_PAYLOAD_MISSING')}
 if(-not $details.installedLinuxPayload){$blockers.Add('LINUX_BROKER_PAYLOAD_MISSING_INSTALL_REVIEWED_RELEASE')}
 $username=Check-WSLCommand @('/usr/bin/id','-un')
 if([string]::IsNullOrWhiteSpace($username)){
  $blockers.Add('WSL_OWNER_SESSION_UNREACHABLE')
 }else{
  $details.wslReachable=$true
  $details.wslUser=$username
 }
 $wslHome=Check-WSLCommand @('/usr/bin/printenv','HOME')
 if(-not [string]::IsNullOrWhiteSpace($wslHome) -and $wslHome.StartsWith('/') -and
   $wslHome -notmatch '[\\\r\n]' -and $wslHome -notmatch '/\.\.(?:/|$)'){
  $installedLinux=$wslHome.TrimEnd('/')+'/.local/share/hooshix/bin/hooshix-wsl-fs-broker'
  # GNU coreutils test treats `--` after unary -f as an extra operand.
  # $installedLinux is verified absolute and cannot be interpreted as an option.
  $linuxExists=Check-WSLCommand @('/usr/bin/test','-f',$installedLinux)
  $linuxDigest=$null
  if($null -ne $linuxExists){
    $linuxDigest=Check-WSLCommand @('/usr/bin/sha256sum','--',$installedLinux)
  }
  if($null -ne $linuxDigest -and $linuxDigest -match '^([a-fA-F0-9]{64})\s'){
   $details.installedLinuxBroker=$true
   if($details.installedLinuxPayload){
    $windowsDigest=(Get-FileHash -LiteralPath $linuxPayload -Algorithm SHA256).Hash
    $details.payloadDigestMatchesInstalledLinuxBroker=(
      $windowsDigest -ieq $Matches[1]
    )
    if(-not $details.payloadDigestMatchesInstalledLinuxBroker){
     $blockers.Add('INSTALLED_LINUX_BROKER_DIGEST_MISMATCH')
    }
   }
  }else{
   $warnings.Add('LINUX_BROKER_NOT_YET_ENROLLED_BOOTSTRAP_REQUIRED')
  }
 }else{
  $blockers.Add('WSL_HOME_NOT_VERIFIED')
 }
}catch{
 $blockers.Add('READ_ONLY_PREFLIGHT_ERROR')
 $warnings.Add($_.Exception.GetType().Name + ': ' + $_.Exception.Message)
}
$result=[ordered]@{
 kind='hooshix_wsl_owner_enrollment_preflight'
 verdict=$(if($blockers.Count -eq 0){'READY_FOR_EXPLICIT_OWNER_ENROLLMENT'}else{'NO_GO'})
 readOnly=$true
 ownerEnrollmentPerformed=$false
 installedServiceChanged=$false
 details=$details
 blockers=@($blockers)
 warnings=@($warnings)
}
$result|ConvertTo-Json -Depth 5 -Compress
if($blockers.Count -gt 0){exit 1}
