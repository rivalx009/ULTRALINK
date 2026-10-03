# ULTRALINK — cycling telemetry & comms  (v1.4)

**New in v1.4:** map SHOW toggles — ROADS (roads & infrastructure), PLACE NAMES (towns/labels) and CHECKPOINTS (show/hide checkpoint dots). On the live map they are in the OVERLAY panel (top-left); on the planning map in the layer panel (bottom-right). Riders no longer get an off-route alert; escorts still do.

Rider ⇄ relay (Node, zero dependencies) ⇄ Escort.  
**Both modes run in any modern browser on Windows, macOS, Android and iPhone/iPad** (Chrome, Edge, Safari, Firefox).

| | Rider mode | Escort mode |
|---|---|---|
| Android phone | ✅ GPS + BLE sensors (Chrome) | ✅ touch layout |
| iPhone / iPad | ✅ GPS (Safari has no Web Bluetooth → no BLE sensors) | ✅ touch layout |
| Windows laptop | ✅ GPS/Wi-Fi location, BLE (Chrome/Edge), hold **Space** to talk | ✅ full console |
| Mac | ✅ same as Windows (Chrome/Edge for BLE) | ✅ full console |

GPS, the microphone and "install app" need **HTTPS** (the Render URL is HTTPS; `localhost` also works).

## Start
- **Hosted (recommended):** deploy to Render (`render.yaml` / `Dockerfile`), then open `https://<your-app>.onrender.com` on every device.
- **Windows:** double-click `ultralink-escort.bat` (escort) or `ultralink-rider.bat` (rider on a laptop).
- **macOS:** double-click `ultralink-escort.command` or `ultralink-rider.command` (first time: right-click → Open).  
  Both launchers ask once for the relay URL (saved in `relay.txt`; blank = run the relay on this computer). Add `reset` to change it.
- **Phones:** open the URL, then *Add to Home Screen* (Safari → Share, or Chrome menu ⋮) for a full-screen app.

## Android rider app (screen-off tracking)
- Riders on Android tap **DOWNLOAD ANDROID RIDER APP** on the start page (file `public/ultralink.apk`), install it, enter the web address once.
- GPS, telemetry and radio keep running with the screen off (notification "ULTRALINK active" with TALK / STOP TRACKING buttons; a Bluetooth/headset button toggles talk).
- iPhone riders keep using the link in Safari with the screen on. After a call or app switch the page now reconnects, restores the mic and sends its position automatically.
- The app source + signing key are kept separately (not in this repo).

## Planning (escort)
1. Opens on an **earth view** (your own location is no longer shown). Saved missions appear as pins.
2. Select a mission → the map flies from the globe down to its route (Google-Earth-style), sectors coloured.
3. **✚ ADD CHECKPOINT** (map toolbar): click on the route to drop a checkpoint; drag a dot to move it; click a dot to give it a **designation** (e.g. FEED ZONE) or delete it. Clicking the elevation profile still works too.
4. **◎ SELECT SECTOR**: click a sector on the map → it zooms to that sector and a card (top-right) shows length, ascent, grades, a **gradient-coloured elevation graph** and the **notes** you write for it.
5. **Overall target time + "Auto-calculate sector targets"**: splits the target over the sectors by terrain (constant-effort physics — climbs get more time) or by distance. Manual targets are still possible in *Sector target times…*.
6. **★ Lead rider**: the main follow-up for this escort (can be changed live).

## Operations (escort)
- **Lead rider**: ★ on a card or in the rider pop-up. The lead is sorted first, gets PTT slot 1 and is auto-followed when it connects. Other escorts see who you are following.
- **◎ RETURN TO RIDER** (button bottom-centre, or **R**): homes the map back on the lead (or selected) rider wherever you are looking.
- **Sectors on the map**: click a sector or checkpoint dot → zoom + read-only card with the gradient graph and the planning notes.
- **Off-route alert**: a rider more than *Settings → Map → Off-route distance* (default 60 m) from the course for two fixes raises a red widget top-centre with a repeating alert tone. It disappears only when **MASTER ALERT** (or **M**) is pressed or the rider is back on course. The rider's phone vibrates and shows a banner too.
- **PTT**: keyboard (Space = all, 1–9 = one unit) or the on-screen PTT button (TO: ALL / SELECTED) for touch screens.
- Sounds: only radio, checkpoint and alert tones by default. Interface sounds can be enabled in *Settings → Audio*.

## Voice (PTT) — how it works now
- Direct WebRTC peer-to-peer audio between every pair of units, with a robust handshake (no offer collisions, ICE candidates queued, reconnects re-negotiate).
- If a direct link cannot be made (mobile networks / strict firewalls) the audio automatically goes **through the relay** (WebSocket, 12 kHz). Force this with *Settings → Audio → Voice path → Relay only*.
- Targeted PTT reaches only the selected unit.
- Optional TURN server for more P2P success: set `TURN_URLS` (comma separated, e.g. `turn:turn.example.com:3478`), `TURN_USERNAME`, `TURN_CREDENTIAL` as environment variables on Render.
- iPhone: if the browser blocks audio playback a yellow "TAP TO ENABLE RADIO AUDIO" button appears — tap it once.

## Notes
- Profiles are stored in the browser (localStorage) per address. Use Export/Import to move them between computers.
- If the relay restarts (Render free tier sleeps / redeploys) the escort re-creates the running mission automatically and riders re-join by themselves.
- Wind comes from Open-Meteo (internet); use WIND → manual when offline. Drafting advice is an estimate.
- `sim.html` injects virtual riders for testing (tick *Deviate* to test the off-route alert).
- `run-lan.bat`: HTTPS on the local network, needs `certs/cert.pem` + `certs/key.pem` (self-signed).
- Tests: `npm start` in one terminal, `npm test` in another (needs `npm i playwright`).
