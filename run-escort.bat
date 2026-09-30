@echo off
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
