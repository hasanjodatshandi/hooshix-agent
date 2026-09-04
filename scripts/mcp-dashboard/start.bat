@echo off
echo ============================================
echo  HooshiX MCP Dashboard
echo ============================================
echo.
echo Dashboard URL: http://localhost:3002
echo.
echo Monitoring:
echo  - Python MCP:   http://localhost:8899
echo  - Node.js MCP:  http://localhost:3001
echo.
echo Press Ctrl+C to stop
echo.
node "%~dp0serve.js"
