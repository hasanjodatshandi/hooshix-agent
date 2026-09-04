# HooshiX MCP Token Manager
# Usage:
#   .\mcp-token.ps1              # Show current token
#   .\mcp-token.ps1 show         # Show current token
#   .\mcp-token.ps1 set TOKEN    # Set a specific token
#   .\mcp-token.ps1 reset        # Generate a new random token
#   .\mcp-token.ps1 copy         # Copy current token to clipboard

param(
    [Parameter(Position=0)]
    [ValidateSet("show", "set", "reset", "copy", "help")]
    [string]$Action = "show",

    [Parameter(Position=1)]
    [string]$Value
)

$TokenFile = Join-Path $PSScriptRoot "..\.token"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TokenFile = Join-Path $ProjectRoot ".token"

function Show-Token {
    if (Test-Path $TokenFile) {
        $token = Get-Content $TokenFile -Raw
        $token = $token.Trim()
        Write-Host ""
        Write-Host "  Access Token: $token" -ForegroundColor Green
        Write-Host "  Token File:   $TokenFile" -ForegroundColor DarkGray
        Write-Host "  Length:        $($token.Length) chars" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  Use in ChatGPT:" -ForegroundColor Yellow
        Write-Host "  1. Go to Settings > Connectors" -ForegroundColor White
        Write-Host "  2. Create connector with URL: https://agent.hooshix.com/mcp" -ForegroundColor White
        Write-Host "  3. When prompted, enter this token as PIN" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "  No token found. Run: .\mcp-token.ps1 reset" -ForegroundColor Red
        Write-Host ""
    }
}

function Set-Token {
    param([string]$NewToken)

    if (-not $NewToken) {
        Write-Host "  Error: Provide a token value" -ForegroundColor Red
        Write-Host "  Usage: .\mcp-token.ps1 set YOUR_TOKEN_HERE" -ForegroundColor Yellow
        return
    }

    # Validate token
    if ($NewToken.Length -lt 16) {
        Write-Host "  Warning: Token is very short ($($NewToken.Length) chars). Consider using 24+ chars." -ForegroundColor Yellow
    }

    $NewToken | Out-File -FilePath $TokenFile -Encoding utf8 -NoNewline
    Write-Host ""
    Write-Host "  Token saved!" -ForegroundColor Green
    Write-Host "  Token: $NewToken" -ForegroundColor White
    Write-Host "  File:  $TokenFile" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Restart the MCP server for the change to take effect." -ForegroundColor Yellow
    Write-Host ""
}

function Reset-Token {
    $newToken = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })

    $newToken | Out-File -FilePath $TokenFile -Encoding utf8 -NoNewline
    Write-Host ""
    Write-Host "  New token generated!" -ForegroundColor Green
    Write-Host "  Token: $newToken" -ForegroundColor White
    Write-Host "  File:  $TokenFile" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Restart the MCP server for the change to take effect." -ForegroundColor Yellow
    Write-Host ""
}

function Copy-Token {
    if (Test-Path $TokenFile) {
        $token = (Get-Content $TokenFile -Raw).Trim()
        $token | Set-Clipboard
        Write-Host ""
        Write-Host "  Token copied to clipboard!" -ForegroundColor Green
        Write-Host "  Paste it in ChatGPT's OAuth PIN field." -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "  No token found. Run: .\mcp-token.ps1 reset" -ForegroundColor Red
    }
}

function Show-Help {
    Write-Host ""
    Write-Host "  HooshiX MCP Token Manager" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor White
    Write-Host "    show              Show current token (default)"
    Write-Host "    set <TOKEN>       Set a specific token"
    Write-Host "    reset             Generate a new random token"
    Write-Host "    copy              Copy token to clipboard"
    Write-Host ""
    Write-Host "  Token file: $TokenFile" -ForegroundColor DarkGray
    Write-Host ""
}

switch ($Action) {
    "show"  { Show-Token }
    "set"   { Set-Token -NewToken $Value }
    "reset" { Reset-Token }
    "copy"  { Copy-Token }
    "help"  { Show-Help }
    default { Show-Token }
}
