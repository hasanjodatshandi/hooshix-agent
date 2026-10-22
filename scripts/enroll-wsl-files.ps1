#Requires -Version 5.1
<#
.SYNOPSIS
  Explicitly provision a native, root-scoped WSL file broker under the user's
  Windows/WSL identities. Never run this as Administrator or LocalSystem.
.DESCRIPTION
  Requires a reviewed HooshiX installer payload. Installs its Linux ELF into
  the user's WSL home and enrolls a separate read-only Windows owner worker.
  Does not change Windows Service identity, Git trust, or workspace grants.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')][string]$Distro,
 [Parameter(Mandatory=$true)][ValidatePattern('^/[^\r\n]*$')][string]$LinuxRoot,
 [Parameter(Mandatory=$true)][string]$WindowsOwnerAnchor,
 [string]$InstallRoot='C:\Program Files\HooshiX MCP'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -eq 'S-1-5-18'){throw 'LocalSystem cannot enroll WSL files'}
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 throw 'Run in an ordinary unelevated Windows PowerShell user session'
}
if(-not [IO.Path]::IsPathRooted($WindowsOwnerAnchor)){throw 'Absolute WindowsOwnerAnchor required'}
$anchor=(Resolve-Path -LiteralPath $WindowsOwnerAnchor -ErrorAction Stop).Path
if((Get-Acl -LiteralPath $anchor).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){
 throw 'WindowsOwnerAnchor must be owned by this signed-in Windows user'
}
$worker=Join-Path $InstallRoot 'bin\hooshix-git-worker.exe'
$linuxBinary=Join-Path $InstallRoot 'bin\hooshix-wsl-fs-broker-linux-amd64'
foreach($file in @($worker,$linuxBinary)){
 if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing verified installed component: $file"}
}
if($LinuxRoot -match '[\x00"\\]' -or $LinuxRoot.Contains('..') -or $LinuxRoot.StartsWith('//')){
 throw 'Unsafe LinuxRoot'
}
$wslArgs=@('--distribution',$Distro,'--exec')
$wslHome=(& wsl.exe @wslArgs /usr/bin/printenv HOME).Trim()
if($LASTEXITCODE -ne 0 -or -not $wslHome.StartsWith('/') -or $wslHome.Contains('\')){
 throw 'Cannot resolve the signed-in WSL users HOME'
}
$linuxDir=$wslHome.TrimEnd('/')+'/.local/share/hooshix/bin'
$linuxTarget=$linuxDir+'/hooshix-wsl-fs-broker'
$linuxSource=(& wsl.exe @wslArgs /usr/bin/wslpath -u -a $linuxBinary).Trim()
if($LASTEXITCODE -ne 0 -or -not $linuxSource.StartsWith('/')){
 throw 'Cannot map the installed ELF path into WSL'
}
& wsl.exe @wslArgs /usr/bin/mkdir -p -- $linuxDir
if($LASTEXITCODE -ne 0){throw 'Failed to create user-owned WSL broker directory'}
& wsl.exe @wslArgs /usr/bin/install -m 0700 -- $linuxSource $linuxTarget
if($LASTEXITCODE -ne 0){throw 'Failed to install reviewed ELF in the WSL user home'}
$winSha=(Get-FileHash -LiteralPath $linuxBinary -Algorithm SHA256).Hash.ToLowerInvariant()
$linuxDigest=((& wsl.exe @wslArgs /usr/bin/sha256sum -- $linuxTarget) -split '\s+')[0].ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $winSha -ne $linuxDigest){
 throw 'WSL broker digest differs from verified Installer payload; refuse enrollment'
}
& $worker -mode wslfs-enroll -root $anchor -distro $Distro -linux-root $LinuxRoot -fs-broker $linuxTarget
if($LASTEXITCODE -ne 0){throw 'WSLFS enrollment was rejected; review distro and Linux root'}
Write-Output ('WSLFS_USER_ENROLLED='+$identity.Name)
Write-Output ('WSLFS_DISTRO='+$Distro)
Write-Output ('WSLFS_LINUX_ROOT='+$LinuxRoot)
Write-Output ('WSLFS_OWNER_ANCHOR='+$anchor)
Write-Output 'This enrollment is read-only and separate from unrestricted WSL exec.'
Write-Output ('Revocation: & "'+$worker+'" -mode wslfs-unenroll -root "'+$anchor+'"')
