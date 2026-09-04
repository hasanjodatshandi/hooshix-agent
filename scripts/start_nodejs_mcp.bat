@echo off
echo ============================================
echo  HooshiX Node.js MCP v2 - Full Stack
echo ============================================
echo.

REM Start the Node.js MCP HTTP server
echo [1/2] Starting Node.js MCP server on port 3001...
start "HooshiX Node.js MCP" cmd /k "cd /d D:\workspace\hooshix-agent && set MCP_PORT=3001 && set MCP_API_KEY=hooshix-v2-secret && npm run dev:http"

REM Wait for server to start
timeout /t 3 /nobreak >nul

REM Start SSH tunnel
echo [2/2] Starting SSH tunnel (VPS:18898 -> localhost:3001)...
start "HooshiX MCP v2 Tunnel" cmd /k "powershell.exe -ExecutionPolicy Bypass -File D:\MCP\hooshix_nodejs_mcp_tunnel.ps1"

echo.
echo ============================================
echo  Both services started!
echo  MCP Server: http://localhost:3001/mcp
echo  Tunnel:     VPS:18898 -> localhost:3001
echo ============================================
echo.
echo Next steps:
echo  1. Configure Caddy on VPS to route agent.hooshix.com -> 127.0.0.1:18898
echo  2. Add connector in ChatGPT: https://agent.hooshix.com/mcp
echo.
pause
