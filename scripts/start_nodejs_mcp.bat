@echo off
echo ============================================
echo  HooshiX Node.js MCP Server
echo ============================================
echo.

REM Start the Node.js MCP HTTP server
echo Starting Node.js MCP server on port 3001...
cd /d D:\workspace\hooshix-agent
set MCP_PORT=3001
node dist\index-http.js

echo.
echo MCP Server: http://localhost:3001/mcp
echo Token: scripts\mcp-token.ps1 show
echo.
pause
