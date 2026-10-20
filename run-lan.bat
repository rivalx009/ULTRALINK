@echo off
cd /d "%~dp0"
if not defined DATABASE_URL (
  echo [X] Set DATABASE_URL privately in this terminal before starting ULTRALINK.
  echo Read NEON-SETUP-v1.12.1.txt. Do not paste credentials into chat or GitHub.
  pause
  exit /b 1
)
if not exist "node_modules\pg\package.json" (
  call npm ci --omit=dev --ignore-scripts
  if errorlevel 1 exit /b 1
)
title ULTRALINK LAN (HTTPS)
cd /d "%~dp0"
where node >nul 2>&1 || (echo [X] Node.js not found. Install the LTS from https://nodejs.org & pause & exit /b)
echo Starting HTTPS relay on your local network. On the phone open the "network:" address it prints
echo and accept the certificate warning (Advanced ^> Proceed).
node server.js --tls
pause
