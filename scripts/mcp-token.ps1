# HooshiX MCP Bootstrap Secret Manager
#
# Manages the operator bootstrap secret (`.token`), used ONLY for:
#   - POST /operator/login (operator web console)
#   - Approving the OAuth consent page (the PIN field)
#
# SECURITY MODEL (docs/SECURITY.md):
#   The bootstrap secret is an OPERATOR credential, never a client credential.
#   It is never accepted as a Bearer token for /mcp, and it is never a
#   connector "Access Token". Remote clients authenticate exclusively through
#   the OAuth authorization code + PKCE flow.
#
# Usage:
#   .\mcp-token.ps1              Show current bootstrap secret
#   .\mcp-token.ps1 show         Show current bootstrap secret
#   .\mcp-token.ps1 set SECRET   Set a specific secret (>=32 bytes required)
#   .\mcp-token.ps1 reset        Generate a new random secret
#   .\mcp-token.ps1 copy         Copy current secret to clipboard

param(
    [Parameter(Position=0)]
    [ValidateSet("show", "set", "reset", "copy", "help")]
    [string]$Action = "show",

    [Parameter(Position=1)]
    [string]$Value
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TokenFile = Join-Path $ProjectRoot ".token"
$MIN_BYTES = 32

function Test-SecretLength {
    param([string]$Secret)
    # base64url of 32 random bytes is 43 chars; enforce the byte-equivalent floor.
    if ($Secret.Length -lt $MIN_BYTES) {
        Write-Host ""
        Write-Host "  ERROR: Secret too short ($($Secret.Length) chars)." -ForegroundColor Red
        Write-Host "  The server rejects any bootstrap secret below $MIN_BYTES bytes." -ForegroundColor Red
        Write-Host "  Use '.\mcp-token.ps1 reset' to generate a compliant secret." -ForegroundColor Yellow
        Write-Host ""
        return $false
    }
    return $true
}

function Write-SecretFile {
    param([string]$Secret)
    # Exclusive-create only: refuse to silently clobber an existing secret, and
    # restrict the new file to owner-only access. matches the server's own
    # crypto.randomBytes(32) + { flag: "wx", mode: 0o600 } behaviour.
    if (Test-Path $TokenFile) {
        Write-Host ""
        Write-Host "  ERROR: A bootstrap secret already exists at:" -ForegroundColor Red
        Write-Host "  $TokenFile" -ForegroundColor DarkGray
        Write-Host "  Delete it first if you really intend to replace it." -ForegroundColor Yellow
        Write-Host ""
        return $false
    }
    [System.IO.File]::WriteAllText($TokenFile, $Secret, [System.Text.UTF8Encoding]::new($false))
    return $true
}

function Show-Secret {
    if (Test-Path $TokenFile) {
        $secret = (Get-Content $TokenFile -Raw).Trim()
        Write-Host ""
        Write-Host "  Bootstrap secret: $secret" -ForegroundColor Green
        Write-Host "  File:             $TokenFile" -ForegroundColor DarkGray
        Write-Host "  Length:           $($secret.Length) chars" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  OPERATOR USE ONLY (docs/SECURITY.md):" -ForegroundColor Yellow
        Write-Host "  - Sign into the operator console:  POST /operator/login" -ForegroundColor White
        Write-Host "  - Or paste it in the OAuth consent PIN field" -ForegroundColor White
        Write-Host "  It is NEVER a Bearer token for /mcp and NEVER a connector access token." -ForegroundColor DarkGray
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "  No bootstrap secret found. Run: .\mcp-token.ps1 reset" -ForegroundColor Red
        Write-Host ""
    }
}

function Set-Secret {
    param([string]$NewSecret)

    if (-not $NewSecret) {
        Write-Host "  Error: Provide a secret value" -ForegroundColor Red
        Write-Host "  Usage: .\mcp-token.ps1 set YOUR_SECRET_HERE" -ForegroundColor Yellow
        return
    }
    if (-not (Test-SecretLength -Secret $NewSecret)) { return }
    if (Write-SecretFile -Secret $NewSecret) {
        Write-Host ""
        Write-Host "  Bootstrap secret saved!" -ForegroundColor Green
        Write-Host "  File:  $TokenFile" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  Restart the MCP server for the change to take effect." -ForegroundColor Yellow
        Write-Host ""
    }
}

function Reset-Secret {
    # 32 cryptographically random bytes, base64url-encoded (43 chars), matching
    # the server's own generation in src/mcp/http-server.ts.
    $bytes = New-Object byte[] 32
    ([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    if (Write-SecretFile -Secret $secret) {
        Write-Host ""
        Write-Host "  New bootstrap secret generated!" -ForegroundColor Green
        Write-Host "  Secret: $secret" -ForegroundColor White
        Write-Host "  File:   $TokenFile" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  Restart the MCP server for the change to take effect." -ForegroundColor Yellow
        Write-Host ""
    }
}

function Copy-Secret {
    if (Test-Path $TokenFile) {
        $secret = (Get-Content $TokenFile -Raw).Trim()
        $secret | Set-Clipboard
        Write-Host ""
        Write-Host "  Bootstrap secret copied to clipboard!" -ForegroundColor Green
        Write-Host "  Paste it in the operator login or the OAuth consent PIN field." -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "  No bootstrap secret found. Run: .\mcp-token.ps1 reset" -ForegroundColor Red
    }
}

function Show-Help {
    Write-Host ""
    Write-Host "  HooshiX MCP Bootstrap Secret Manager" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor White
    Write-Host "    show              Show current bootstrap secret (default)"
    Write-Host "    set <SECRET>      Set a specific secret (>= 32 bytes)"
    Write-Host "    reset             Generate a new random secret"
    Write-Host "    copy              Copy secret to clipboard"
    Write-Host ""
    Write-Host "  Remember: the bootstrap secret is an OPERATOR credential." -ForegroundColor Yellow
    Write-Host "  Remote MCP clients authenticate only via OAuth (PKCE)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Secret file: $TokenFile" -ForegroundColor DarkGray
    Write-Host ""
}

switch ($Action) {
    "show"  { Show-Secret }
    "set"   { Set-Secret -NewSecret $Value }
    "reset" { Reset-Secret }
    "copy"  { Copy-Secret }
    "help"  { Show-Help }
    default { Show-Secret }
}
