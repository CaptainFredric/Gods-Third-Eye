@echo off
title Panopticon Earth
echo ===================================================
echo Starting Panopticon Earth...
echo ===================================================
echo.

node -v >nul 2>&1
if errorlevel 1 goto install_node

:continue_setup
if not exist node_modules\ (
    echo First time setup: Installing dependencies...
    call npm install
    echo.
)

echo Launching the Vite development server.
echo Open http://localhost:5173 once the server is ready.
echo Press Ctrl+C and type Y to stop the server.
echo.
call npm run dev
pause
exit /b

:install_node
echo [INFO] Node.js is not installed or not in your PATH.
echo [INFO] Panopticon Earth requires Node.js to run the Vite dev server.
echo.
echo Attempting automatic installation with winget...
echo.
winget install -e --id OpenJS.NodeJS --accept-package-agreements --accept-source-agreements

if errorlevel 1 (
    echo.
    echo [ERROR] Automatic Node.js installation failed.
    echo Please install Node.js manually from https://nodejs.org/
    pause
    exit /b
)

echo.
echo [SUCCESS] Node.js should now be installed.
echo Close this window and run Alpha Launch.bat again.
pause
exit /b
