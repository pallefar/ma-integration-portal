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

echo.
echo   ----------------------------------------------------------------
echo   REAL-DEAL MODE ^(authentication REQUIRED -- fail-closed^).
echo   Before the first login, set a private admin password:
echo       "%NODE_CMD%" scripts\set-admin-password.js
echo   Do NOT use the published demo password on a real-deal host.
echo   ----------------------------------------------------------------
echo.
echo   Starting the TE Connectivity M^&A Integration Portal ...
echo   Opening http://localhost:3000 in your browser.
echo   Keep this window open; close it to stop the server.
echo.

start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"

REM NOTE: DEMO_OPEN is deliberately NOT set here. Auth stays mandatory.
"%NODE_CMD%" server.js

echo.
echo   Server stopped. Press any key to close.
pause >nul
