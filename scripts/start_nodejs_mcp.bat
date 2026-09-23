@echo off
echo ============================================
echo  HooshiX Node.js MCP Server
echo ============================================
echo.

cd /d "%~dp0.."

REM --- Require the same major Node and exact pnpm contract as CI before launching.
node -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 (
  echo ERROR: HooshiX requires Node.js 24 from the configured service environment.
  exit /b 1
)
set "HOOSHIX_PNPM_VERSION="
for /f "delims=" %%V in ('pnpm --version') do set "HOOSHIX_PNPM_VERSION=%%V"
if not "%HOOSHIX_PNPM_VERSION%"=="11.24.0" (
  echo ERROR: HooshiX requires pnpm 11.24.0.
  exit /b 1
)
REM --- Already-running check: a second start must fail gracefully, not EADDRINUSE ---
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
  echo A server is ALREADY LISTENING on port 3001.
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do echo   PID: %%P
  echo.
  echo   Health check : curl "http://localhost:3001/health/live"
  echo   Existing listener ownership is unknown; this script will NOT terminate it.
  echo   Verify the process identity and stop the intended HooshiX instance manually.
  echo   Refusing to start a competing server on port 3001.
  exit /b 1
)

REM Start the Node.js MCP HTTP server
echo Starting Node.js MCP server on port 3001...
set MCP_PORT=3001
REM Public base URL so OAuth discovery advertises the tunnel host (required
REM for ChatGPT connector registration; localhost issuer breaks RFC 7591 flow).
REM MCP_PUBLIC_BASE_URL is supplied by the operator environment for an approved HTTPS edge.
node dist\index-http.js

echo.
echo MCP Server: http://localhost:3001/mcp
echo Authentication: OAuth via the server discovery endpoints
echo.
pause
