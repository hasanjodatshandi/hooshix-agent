#Requires -Version 5.1
<#
.SYNOPSIS
  Separately enroll the signed-in Windows owner's WSL native file WRITE worker.
.DESCRIPTION
  Manual opt-in ONLY. Does not upgrade an existing read-only file grant,
  change Windows Service identity, or launch an arbitrary WSL shell command.
  The installed Linux ELF must exactly match the reviewed Windows payload.
  To revoke use: hooshix-git-worker.exe -mode wslfs-write-unenroll -root <anchor>.
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
if($identity.User.Value -eq 'S-1-5-18'){throw 'LocalSystem cannot enroll WSL write access'}
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 throw 'Use an ordinary unelevated owner Windows session'
}
if(-not [IO.Path]::IsPathRooted($WindowsOwnerAnchor) -or $WindowsOwnerAnchor.StartsWith('\\')){
 throw 'Absolute local Windows owner anchor required'
}
$anchor=(Resolve-Path -LiteralPath $WindowsOwnerAnchor -ErrorAction Stop).Path
if((Get-Acl -LiteralPath $anchor).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){
 throw 'Windows owner SID mismatch'
}
if($LinuxRoot -match '[\x00"\\]' -or $LinuxRoot.Contains('..') -or $LinuxRoot.StartsWith('//')){
 throw 'Unsafe Linux workspace root'
}
$worker=Join-Path $InstallRoot 'bin\hooshix-git-worker.exe'
$linuxBinary=Join-Path $InstallRoot 'bin\hooshix-wsl-fs-broker-linux-amd64'
foreach($file in @($worker,$linuxBinary)){
 if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing reviewed component: $file"}
}
$wslArgs=@('--distribution',$Distro,'--exec')
$wslHome=(& wsl.exe @wslArgs /usr/bin/printenv HOME).Trim()
if($LASTEXITCODE -ne 0 -or -not $wslHome.StartsWith('/') -or $wslHome.Contains('..')){
 throw 'Cannot resolve WSL owner home'
}
$linuxTarget=$wslHome.TrimEnd('/')+'/.local/share/hooshix/bin/hooshix-wsl-fs-broker'
$canonical=(& wsl.exe @wslArgs /usr/bin/realpath -e -- $LinuxRoot).Trim()
if($LASTEXITCODE -ne 0 -or $canonical -cne $LinuxRoot){
 throw 'Linux root is unavailable or not canonical'
}
$windowsSHA=(Get-FileHash -LiteralPath $linuxBinary -Algorithm SHA256).Hash.ToLowerInvariant()
$linuxSHA=((& wsl.exe @wslArgs /usr/bin/sha256sum -- $linuxTarget) -split '\s+')[0].ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $windowsSHA -ne $linuxSHA){
 throw 'Linux broker digest mismatch. Install the reviewed ELF first with enroll-wsl-files.ps1'
}
& $worker -mode wslfs-write-enroll -root $anchor -distro $Distro -linux-root $LinuxRoot -fs-broker $linuxTarget
if($LASTEXITCODE -ne 0){throw 'Owner-session WSL write enrollment failed'}
Write-Output ('WSLFS_WRITE_ENROLLED='+$identity.Name)
Write-Output ('WSLFS_LINUX_ROOT='+$LinuxRoot)
Write-Output 'WSLFS write enrollment is independent of read-only enrollment.'
Write-Output ('Revoke: & "'+$worker+'" -mode wslfs-write-unenroll -root "'+$anchor+'"')
