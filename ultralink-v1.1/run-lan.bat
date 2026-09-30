@echo off
title ULTRALINK LAN (HTTPS)
cd /d "%~dp0"
where node >nul 2>&1 || (echo [X] Node.js not found. Install the LTS from https://nodejs.org & pause & exit /b)
echo Starting HTTPS relay on your local network. On the phone open the "network:" address it prints
echo and accept the certificate warning (Advanced ^> Proceed).
node server.js --tls
pause
