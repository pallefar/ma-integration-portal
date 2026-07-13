@echo off
title TE Connectivity M&A Integration Portal
cd /d "%~dp0"

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

echo.
echo   Starting the TE Connectivity M^&A Integration Portal ...
echo   Opening http://localhost:3000 in your browser.
echo   Keep this window open; close it to stop the server.
echo.

REM Open the browser a few seconds after the server begins booting.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"

REM Run the server in this window (blocks until the window is closed).
"%NODE_CMD%" server.js

echo.
echo   Server stopped. Press any key to close.
pause >nul
