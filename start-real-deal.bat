@echo off
title TE Connectivity M&A Integration Portal (Real-Deal)
cd /d "%~dp0"

REM REAL-DEAL launcher for Windows. Unlike start.bat (the demo showcase
REM launcher), this launcher does NOT set DEMO_OPEN, so the server stays
REM FAIL-CLOSED: every /api request requires a real authenticated session.
REM Use this launcher -- never start.bat -- for any host that will hold real
REM acquisition data (MNPI). See DEPLOYMENT.md.

REM Prefer a bundled Node (.\node\node.exe) if present, else use system Node.
set "NODE_CMD=node"
if exist "%~dp0node\node.exe" set "NODE_CMD=%~dp0node\node.exe"

"%NODE_CMD%" -v >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this machine.
  echo   Install the LTS build from https://nodejs.org/ then run this file again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo.
  echo   First run: installing dependencies ^(one time^)...
  call npm install --omit=dev
)

REM [security] Real-deal mode (D-10-01). MA_MODE=real makes the server use its OWN
REM gitignored data directory (data\real, or MA_DATA_DIR) seeded WITHOUT the
REM published demo accounts, and refuse to ever open the committed data\*.db
REM files. Without this line the server would run in dev mode.
set "MA_MODE=real"
REM [security] IN-C01: the launcher also CLEARS any DEMO_OPEN inherited from the
REM environment (a `setx DEMO_OPEN 1` left over from a demo session). The server
REM refuses MA_MODE=real + DEMO_OPEN=1 at boot (fail-closed), but the browser
REM timer below would still open a dead tab - clearing it here means a real-deal
REM host simply starts, auth mandatory.
set "DEMO_OPEN="

echo.
echo   ----------------------------------------------------------------
echo   REAL-DEAL MODE ^(authentication REQUIRED -- fail-closed^).
echo   Real-deal data lives in data\real ^(or the folder in MA_DATA_DIR^).
echo   First run: create the first admin account with
echo       "%NODE_CMD%" scripts\bootstrap-admin.js
echo   It asks for the password ^(12+ characters^) or reads
echo   MA_BOOTSTRAP_PASSWORD; never type it on the command line.
echo   You will be asked to change it at your first sign-in.
echo   ----------------------------------------------------------------
echo.
echo   Starting the TE Connectivity M^&A Integration Portal ...
echo   Opening http://localhost:3000 in your browser.
echo   Keep this window open; close it to stop the server.
echo.

start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"

REM NOTE: DEMO_OPEN is deliberately NOT set here - it is cleared above (and is
REM refused together with MA_MODE=real). Auth stays mandatory.
"%NODE_CMD%" server.js

echo.
echo   Server stopped. Press any key to close.
pause >nul
