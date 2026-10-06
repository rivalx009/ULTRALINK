# ULTRALINK — cycling telemetry & comms  (v1.6)

**New in v1.6**
- **Race profiles** (formerly mission profiles) and the new **Training profiles** — two tabs in the planning panel. *Activate mission* is now **▶ ENTER PROFILE**.
- **Training: route type detected on GPX import** — **A → B** (point-to-point) or **A → A** (loop; start/finish within ~150–400 m). For a loop, tick *THIS TRAINING INVOLVES LAPS*, set the number of laps (1–50) and a target time per lap (or one for all). Each lap target is split into sector targets by terrain, or set by hand lap by lap in ⏱ SECTOR TARGET TIMES. Live: sector times and targets per lap (unit pop-up, sector board LAP × SECTOR + LAP TIME, comms log "LAP 2 / 5 in 12:36 (+0:21 vs target)").
- **Comms mode** (third mode on the start page, `comms.html`): intercom only — every device is a single unit, no telemetry or location. **CREATE CHANNEL** gives a 6-digit **Channel ID**; others use **JOIN EXISTING CHANNEL** and type it (or open the shared link). Hold to talk (Space / BT remote), or HANDS-FREE latch. Empty channels close after 30 min.

**New in v1.5.2:** location is required — if the device's location is off or blocked, the loading screen stops with a **LOCATION DISABLED** box (RETRY; it also re-checks every 3 s and continues by itself once location is on). Tap/key skip can't bypass it.

**New in v1.5.1:** the loading screen now greets you first — on the start page, before the mode select (once per session; escort mode opened directly still shows it). The Windows app always opens **full screen** (F11 or Ctrl+Shift+F toggles; Alt+F4 quits).

**New in v1.5**
- **Apps:** Windows desktop app (`ultralink-desktop-setup.exe`) and a new Android app (`ultralink.apk`) — both offer **RIDER and ESCORT mode**, same grey chain-link icon and ULTRALINK wordmark. Download both from the start page.
- **Phone escort layout:** bottom tabs MAP / UNITS / POWER / PROFILE / MORE, bigger touch targets.
- **Appearance:** only **DARK** (original) and **ARCTIC** (light-grey panels, dark-grey text). Loading screen unchanged.
- **↻ REFRESH GPS** (escort top bar, PTT dock, key **G**): asks every rider/escort device for a fresh fix, redraws all markers and zooms to fit everyone.
- **Minimise / maximise** (– / +) button on every widget; state is remembered.
- **Lead-rider power engine:** estimated watts from actual speed + GPX road gradient (+ air density from elevation, acceleration, optional wind). POWER widget: 3 s / 10 s / 30 s / AVG / NP / MAX / kJ, W/kg, %FTP, live 5-min zone-coloured chart and 7-zone time-in-zone histogram (Coggan zones). FTP, rider kg and bike kg are saved per rider callsign.

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

## Apps (Android + Windows)
- **Android:** start page → **DOWNLOAD ANDROID APP** (`public/ultralink.apk`). Package `com.ultralink.app` — *uninstall the old v1.4 rider app first* (different package/signing key). Choose RIDER or ESCORT after login. In rider mode GPS, telemetry and radio keep running with the screen off (notification with TALK / STOP TRACKING; headset button toggles talk).
- **Windows:** start page → **DOWNLOAD WINDOWS DESKTOP APP** (per-user install, no admin). Uses Windows Location for GPS (Settings → Privacy → Location must be ON), keeps the laptop awake, auto-retries when the relay sleeps. Change server: Ctrl+Shift+S.
  - The installer (~84 MB) is too big for the GitHub web uploader, so it is **not in the repo**. Put it in a GitHub Release: repo → *Releases* → *Draft a new release* → tag `v1.5.0` → drag `ultralink-desktop-setup.exe` in → *Publish*. Then edit `desktop-url.txt` (replace `YOUR-NAME/YOUR-REPO`) — the start page button and `/ultralink-desktop-setup.exe` point there. Alternatively set the Render env var `DESKTOP_URL`. (A copy placed in `public/` is served directly instead.)
- iPhone users keep using the link in Safari (Add to Home Screen).
- Sources: `apps/android` (Gradle), `apps/desktop` (Electron), shared setup/offline screens in `apps/shared`. `.github/workflows/build-apps.yml` builds both on GitHub (Actions → *Build apps*). Release signing for Android: repo secrets `ULTRALINK_KEYSTORE_B64`, `ULTRALINK_KEYSTORE_PASSWORD`, `ULTRALINK_KEY_ALIAS`, `ULTRALINK_KEY_PASSWORD` — keep using the same keystore or phones won't accept updates.

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
