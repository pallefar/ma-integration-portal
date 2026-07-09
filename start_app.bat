@echo off
REM TE Connectivity Post-Merger Integration Portal - Windows Startup Runner
REM Fired up with pair-programming care.

echo ==========================================================
echo    TE Connectivity Post-Merger Integration IMO System     
echo ==========================================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js is not installed. Attempting a fully automated local installation...
    
    if not exist bin mkdir bin
    
    echo --> Downloading precompiled Node.js binary (node-v20.11.1-win-x64)...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile 'bin\node.zip'"
    
    if exist bin\node.zip (
        echo --> Extracting Node.js binary...
        powershell -Command "Expand-Archive -Path 'bin\node.zip' -DestinationPath 'bin' -Force"
        del bin\node.zip
        
        if exist bin\node-v20.11.1-win-x64 (
            echo --> Local Node.js extracted successfully.
            set "PATH=%CD%\bin\node-v20.11.1-win-x64;%PATH%"
            echo --> Added local Node.js to session PATH.
        )
    ) else (
        echo --> Automated download failed. Attempting winget fallback...
        where winget >nul 2>nul
        if %errorlevel% equ 0 (
            echo Winget detected. Installing Node.js...
            winget install --id OpenJS.NodeJS -e --accept-source-agreements --accept-package-agreements
            echo ==========================================================
            echo Node.js has been installed via winget! Please RESTART this
            echo terminal window and run start_app.bat again for changes to take effect.
            echo ==========================================================
            pause
            exit /b 0
        ) else (
            echo Winget not found. Downloading official Node.js MSI installer...
            powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi' -OutFile 'bin\node_installer.msi'"
            echo Opening Node.js MSI Installer...
            start "" "bin\node_installer.msi"
            echo ==========================================================
            echo Please complete the Node.js installation wizard and then
            echo RESTART this terminal window and run start_app.bat again.
            echo ==========================================================
            pause
            exit /b 0
        )
    )
)

echo --> Synchronizing Node.js dependencies...
call npm install --no-audit --no-fund

echo --> Initializing local Express server...
start /b node server.js

echo --> Waiting 2 seconds for server to bind to port 3000...
timeout /t 2 /nobreak >nul 2>&1 || ping 127.0.0.1 -n 3 >nul

echo --> Opening portal in default browser...
start "" "http://localhost:3000"

echo.
echo Portal is now running live at http://localhost:3000!
echo To terminate the server, close this command prompt or press [Ctrl + C].
echo ==========================================================

:loop
pause
goto loop
