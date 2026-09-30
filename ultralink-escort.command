#!/bin/bash
# ULTRALINK launcher for macOS — double-click in Finder.
#   ./ultralink-escort.command          escort console
#   ./ultralink-escort.command rider    rider mode on a Mac
#   ./ultralink-escort.command reset    forget the saved relay address
cd "$(dirname "$0")"
PAGE="escort.html"
for a in "$@"; do
  [ "$a" = "reset" ] && rm -f relay.txt
  [ "$a" = "rider" ] && PAGE="rider.html"
done
echo "========================================================"
echo "   U L T R A L I N K   -   CONSOLE LAUNCHER (macOS)"
echo "========================================================"
RELAY=""
[ -f relay.txt ] && RELAY="$(head -n1 relay.txt | tr -d '\r\n ')"
if [ -z "$RELAY" ]; then
  echo "FIRST RUN SETUP"
  echo "Paste your hosted relay address, e.g. https://ultralink.onrender.com"
  read -r -p "or press ENTER to run the relay on this Mac: " RELAY
  [ -z "$RELAY" ] && RELAY="LOCAL"
  echo "$RELAY" > relay.txt
fi
if [ "$RELAY" = "LOCAL" ]; then
  if ! command -v node >/dev/null 2>&1; then echo "[X] Node.js is not installed. Get the LTS from https://nodejs.org and run this again."; read -r -p "Press ENTER to close"; exit 1; fi
  if ! curl -fs --max-time 2 http://localhost:8080/health >/dev/null; then
    echo "Starting local relay..."
    nohup node server.js > relay.log 2>&1 &
    for i in $(seq 1 15); do curl -fs --max-time 1 http://localhost:8080/health >/dev/null && break; sleep 1; done
  fi
  TARGET="http://localhost:8080/$PAGE"
else
  TARGET="${RELAY%/}/$PAGE"
fi
echo "Opening: $TARGET"
echo "Tips: allow Location + Microphone when the browser asks (System Settings > Privacy & Security)."
for APP in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if [ -d "/Applications/$APP.app" ] || [ -d "$HOME/Applications/$APP.app" ]; then
    open -na "$APP" --args --app="$TARGET" --autoplay-policy=no-user-gesture-required --user-data-dir="$HOME/Library/Application Support/Ultralink/profile" --no-first-run --no-default-browser-check
    exit 0
  fi
done
open "$TARGET"   # Safari fallback (works; Chrome/Edge recommended for BLE sensors)
