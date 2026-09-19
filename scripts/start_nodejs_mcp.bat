@echo off
echo ============================================
echo  HooshiX Node.js MCP Server
echo ============================================
echo.

cd /d D:\workspace\hooshix-agent

REM --- Already-running check: a second start must fail gracefully, not EADDRINUSE ---
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
  echo A server is ALREADY LISTENING on port 3001.
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do echo   PID: %%P
  echo.
  echo   Health check : curl "http://localhost:3001/health"
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
set MCP_PUBLIC_BASE_URL=https://agent.hooshix.com
node dist\index-http.js

echo.
echo MCP Server: http://localhost:3001/mcp
echo Token: scripts\mcp-token.ps1 show
echo.
pause
