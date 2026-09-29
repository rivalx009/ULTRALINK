# ULTRALINK — cycling telemetry & comms

Rider (Android phone, Chrome) ⇄ relay (Node, zero dependencies) ⇄ Escort (Windows laptop).

## Escort laptop (easy way)
Double-click **ultralink-escort.bat**.
- First run asks for your hosted relay URL (e.g. https://your-app.onrender.com) or type LOCAL to run a relay on this PC. Saved in relay.txt. Run `ultralink-escort.bat reset` to change it.
- Opens Edge/Chrome as a fullscreen app window (F11 to exit fullscreen). Sound autoplay is enabled by the launcher.

## Flow
1. Boot screen → home map at your location.
2. **New mission profile**: name, code, date, departure time, import GPX, click the elevation profile to add checkpoints (sectors), colours, sector target times, riders/callsigns. Save / export / import / delete.
3. Click a profile → details widget on the right. **Activate** → countdown runs everywhere, mission clock auto-starts at zero.
4. Riders join on their phone with the mission code (rider.html).
5. Ops screen: gauge cards per unit (rider = rhombus, escort = inverted triangle), map + elevation graph with all icons. Click any icon → map and graph home in, widget shows live telemetry, wind on the rider and drafting advice.
6. Sectors: a rider passing a checkpoint starts a stopwatch; it stops at the next one; times are logged and shown on the Sector Board.

## Notes
- Profiles are stored in the browser (localStorage) per address: hosted URL and localhost do not share them. Use Export/Import to move them.
- Wind comes from Open-Meteo (needs internet); use WIND → manual override when offline. Drafting advice is an estimate, not a substitute for judgment. Following vehicles must not shelter riders in races.
- PTT voice is WebRTC peer-to-peer (STUN). Hold the PTT key (see PTT KEYMAP).
- Rider phones need the updated files: redeploy the relay (git push) so rider.js updates; the service worker refreshes on next open.
- run-lan.bat: HTTPS on the local network with the self-signed certs in certs/.
- Dockerfile / render.yaml: hosted relay deploy.
