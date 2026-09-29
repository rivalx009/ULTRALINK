@echo off
setlocal EnableDelayedExpansion
title ULTRALINK LAUNCHER
cd /d "%~dp0"
color 0B
echo.
echo   ========================================================
echo     U L T R A L I N K   -   ESCORT CONSOLE LAUNCHER
echo   ========================================================
echo.

rem ---- optional: "ultralink-escort.bat reset" forgets the saved relay ----
if /I "%~1"=="reset" del "%~dp0relay.txt" >nul 2>&1

rem ---- which relay do we use? saved in relay.txt (a URL, or LOCAL) ----
set "RELAY="
if exist "%~dp0relay.txt" set /p RELAY=<"%~dp0relay.txt"
if "!RELAY!"=="" (
  echo   FIRST RUN SETUP
  echo   Paste your hosted relay address, e.g.  https://ultralink.onrender.com
  echo   or press ENTER to run the relay on this laptop instead.
  echo.
  set /p RELAY=  Relay URL ^(blank = this laptop^): 
  if "!RELAY!"=="" set "RELAY=LOCAL"
  >"%~dp0relay.txt" echo !RELAY!
  echo.
)

if /I "!RELAY!"=="LOCAL" (
  set "TARGET=http://localhost:8080/escort.html"
  where node >nul 2>&1 || (echo   [X] Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
  echo   Relay mode : LOCAL ^(this laptop^)
  powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://localhost:8080/health -TimeoutSec 2).StatusCode}catch{exit 1}" >nul 2>&1
  if errorlevel 1 (
    echo   Starting local relay...
    start "ULTRALINK RELAY" /min cmd /c node "%~dp0server.js"
    for /L %%i in (1,1,15) do (
      powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://localhost:8080/health -TimeoutSec 1).StatusCode}catch{exit 1}" >nul 2>&1 && goto :relay_up
      timeout /t 1 >nul
    )
    echo   [X] The local relay did not start. Run  node server.js  to see the error.
    pause & exit /b 1
  )
) else (
  set "TARGET=!RELAY!"
  if "!TARGET:~-1!"=="/" set "TARGET=!TARGET:~0,-1!"
  set "TARGET=!TARGET!/escort.html"
  echo   Relay mode : HOSTED  !RELAY!
)
:relay_up

rem ---- find Edge (preferred) or Chrome ----
set "BROWSER="
for %%P in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if not defined BROWSER if exist %%P set "BROWSER=%%~P"
)
if not defined BROWSER (echo   [X] Microsoft Edge or Google Chrome was not found. & pause & exit /b 1)

echo   Opening    : !TARGET!
echo.
echo   Tips: F11 = leave/enter fullscreen  -  Alt+F4 = close the console
echo         Windows Settings ^> Privacy ^> Location must be ON for GPS.
echo         To change the relay later run:  ultralink-escort.bat reset
echo.
start "" "!BROWSER!" --app="!TARGET!" --start-fullscreen --autoplay-policy=no-user-gesture-required --user-data-dir="%LocalAppData%\Ultralink\profile" --no-first-run --no-default-browser-check --disable-features=Translate
timeout /t 3 >nul
exit /b 0
