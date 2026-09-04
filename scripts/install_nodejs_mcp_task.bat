@echo off
echo ========================================
echo  HooshiX MCP - Scheduled Task Installer
echo ========================================
echo.
echo This will install a Windows scheduled task that:
echo   - Starts the Node.js MCP server on login
echo   - Starts SSH tunnels to VPS (ports 18898, 18899)
echo   - Auto-restarts on failure
echo   - Monitors health and reconnects
echo.
echo Required: Run as Administrator
echo.

:: Check admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click and select "Run as administrator".
    pause
    exit /b 1
)

echo Installing scheduled task...
echo.

powershell.exe -ExecutionPolicy Bypass -File "%~dp0install_nodejs_mcp_task.ps1"

if %errorLevel% equ 0 (
    echo.
    echo ========================================
    echo  Installation complete!
    echo ========================================
    echo.
    echo The task will start automatically on next login.
    echo To start it now, run:
    echo   Start-ScheduledTask -TaskName "HooshiX Node.js MCP v2"
    echo.
) else (
    echo.
    echo ERROR: Installation failed.
)

pause
