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
title ULTRALINK RELAY
echo ============================================
echo   ULTRALINK - starting relay + public tunnel
echo ============================================
where node >nul 2>&1 || (echo [X] Node.js not found. Install from https://nodejs.org ^(LTS^) and rerun. & pause & exit /b)
start "ULTRALINK RELAY" cmd /k node "%~dp0server.js"
timeout /t 2 >nul
if exist "%~dp0cloudflared.exe" (
  echo Opening HTTPS tunnel - copy the trycloudflare.com URL into the phone browser.
  "%~dp0cloudflared.exe" tunnel --url http://localhost:8080
) else (
  echo.
  echo cloudflared.exe not found next to this script.
  echo Download: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  echo Rename it to cloudflared.exe, drop it in this folder, rerun this file.
  echo.
  echo Meanwhile open http://localhost:8080 on this laptop ^(escort mode^).
  pause
)
