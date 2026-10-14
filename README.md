# ULTRALINK — cycling telemetry & comms  (v1.7)

This release preserves the exact v1.10 file paths. Hardware PTT code and styles are integrated into the existing `public/ul.js` and `public/ul.css`; no additional runtime files or dependencies are required.

**New in v1.11.1 — laptop Bluetooth / USB microphone selection and physical PTT**

In **Escort → Settings → Audio**, scroll to **BLUETOOTH / USB AUDIO & PHYSICAL PTT**.

1. Pair the microphone and PTT accessory in Windows/macOS Bluetooth settings first, or connect its USB receiver. ULTRALINK does not perform Bluetooth pairing or open proprietary radio protocols.
2. Press **ALLOW MIC ACCESS / REFRESH DEVICES**, then select the desired **Audio input**. A saved explicit device is requested with an exact microphone constraint; the app will not silently substitute the laptop's microphone if that device is missing. Selecting a new mic releases local PTT, replaces the audio track and cleans up the previous capture pipeline.
3. Use **TEST MIC LEVEL** to check incoming signal locally. No audio is transmitted during this test. Playback output still follows the operating system/browser output choice; there is no speaker-output selector in this release.
4. Press **LEARN PTT BUTTON**, then press and release the physical button. Learning does not transmit. **TEST BUTTON — NO TX** checks press/release recognition without opening the radio. Escape cancels learning; a timeout reports when no usable key event arrives.
5. Choose **Hold to talk** for buttons that provide both press and release events, or **Toggle** for discrete button pulses (press to open, press again to close). Browser-readable media keys default to Toggle when learned. Clear the learned button to restore the ordinary Space/on-screen workflow; RESET ALL also resets the hardware profile and mic selection.
6. Close Settings, keep the ULTRALINK window focused, and test with a connected rider. The learned physical button broadcasts to **all units**. It overrides any shortcut with the same key code; configure an unused key where possible. Normal per-unit keyboard PTT controls remain available when not overridden.

**Safety and scope**

- Physical PTT closes on window blur/page hiding, link loss, selected-mic loss, or the 60-second watchdog. Reconnection can reacquire the same saved microphone, but never reopens transmission automatically. Hardware PTT is paused in Emergency Frequency mode and cannot start from a typing field or open dialog.
- Supported accessories must expose a standard microphone/audio input and/or an OS keyboard/HID interface whose key events reach the browser. A radio-only accessory, proprietary GATT/PTT button, microphone-mute-only button, or OS-intercepted media control is **not automatically supported**. No global/background keyboard hook or universal Bluetooth SDK is claimed. Microphone selection does not prove that the button is supported; test them separately.
- Device IDs and hardware mappings are local to this browser/profile/site origin, not the mission. Permission changes, browser resets or a different site URL may require selecting/learning again. Browser microphone access requires the existing secure-context/permission setup.
- The new hardware setup panel targets the **laptop escort console**. Existing rider/COMMS controls are retained; native Android Bluetooth audio routing is not replaced by this laptop panel.

**Deploy:** update the repository files (especially `ul.js`, `ul.css`, `escort.js`, `escort.html` and `sw.js`), redeploy, then reload the laptop console. Existing desktop shells loading the hosted web UI do not need rebuilding for these web controls. The previous Android native emergency-speech fallback still requires its APK build as documented below; no new installer/APK is built here.

**Hardware QA:** A separate development-only test suite (not included in this v1.10-layout package) covers exact mic constraints, switching/cleanup, persistence, local mic testing, learning, dry tests, hold/toggle/pulse input, disconnection/reconnection, explicit default fallback, focus/mode guards and the watchdog. Hardware inventory and button events are simulated; microphone streams use Chromium's fake audio device. No physical Bluetooth accessory has been paired or tested in this environment. Check the actual device, PTT release behavior and audio with riders before an event.


**New in v1.10 — revised effects and Emergency Frequency**

- OFF COURSE and MECHANICAL now use the supplied `fa_18_rwr_combat.mp3` sound effect under their existing voice phrases. RIDER DOWN is unchanged.
- Escort mode includes a small red **EMERGENCY FREQUENCY** button. It asks **“Switch to emergency frequency ?”** before activation; Cancel/Escape leaves normal operation unchanged.
- After activation, a keyboard text bar sends the exact entered text (up to 500 characters) to **all currently connected riders in the same mission**, who play it using text-to-speech. No escort microphone is needed. Press Enter or **SEND VOICE**.
- **YES**, **NO**, and **UNDERSTOOD** send prerecorded voice clips. These clips do not require an installed text-to-speech voice.
- **RETURN TO NORMAL** restores this escort's normal microphone PTT controls. It does not repair a faulty microphone. Incoming radio, GPS tracking and safety warnings remain active throughout; this is a software communication mode, not a real RF-frequency change.
- Relay receipt and rider playback status are separate. The escort sees connected recipient count, software playback completion and blocked/muted/unavailable speech reports. Completion is not proof that a person heard or understood the message.
- Riders see the exact message with replay and dismiss controls. Typed announcements play sequentially, without clipping previous announcements. If speech is unavailable or blocked, the app reports that explicitly instead of claiming playback.
- Offline sends are not queued for later broadcast: the draft remains and the escort must resend after reconnecting. This avoids stale emergency instructions being spoken unexpectedly. Riders disconnected at send time do not receive that broadcast.

**Speech compatibility and deployment**

1. Deploy the updated server, web files, three preset MP3 files, both revised warning MP3s and service worker; then reload rider/escort pages. Browser typed speech needs an available English system voice, allowed audio playback and audible device volume. Keep rider screens active for this mode; background delivery/playback has not been certified.
2. An **Android native TTS fallback** is included in the app source for WebViews without browser speech support. **It requires building and installing the new APK.** The existing APK is not rebuilt in this archive. Install/enable an English Android TTS voice. The native fallback follows sound mute/volume settings.
3. The repository's existing **Build apps** GitHub workflow runs manually (`workflow_dispatch`) or on a `v*` tag push. Use it to build the updated APK, then install it on riders' phones. This environment has no Android SDK/JDK/Gradle, so the Android changes have not been compiled or tested on a physical phone here.
4. Test one typed message and all three preset clips on every actual rider device before an event, including muted/blocked-audio and reconnect cases. This remains a data-connection-dependent aid, not an emergency-services or certified safety system.

**Testing:** `node test-v110.js` covers confirmation, microphone failure, exact text, preset playback, ordering, replay, offline reporting, return to normal, permissions and mission isolation. Browser speech and Android callbacks are simulated in this test; preset MP3s are decoded/played through a real browser AudioContext. Physical speaker output and the APK build remain device/deployment checks. Existing alert, navigation and training/comms suites are retained.


**New in v1.9 — rider assistance alerts**

- Rider mode has one-tap **RIDER DOWN** (red) and **MECHANICAL** (amber) buttons beside the existing push-to-talk workflow. These are manual rider reports, not automatic crash detection.
- RIDER DOWN loops the supplied missile-jettison effect beneath: “WARNING. RIDER DOWN. WARNING. RIDER DOWN. RIDER DOWN.”
- MECHANICAL loops the supplied F/A-18 RWR effect beneath: “MECHANICAL. MECHANICAL. MECHANICAL.” The existing OFF COURSE audio remains unchanged.
- Escort consoles automatically select and zoom to the reporting rider's actual GPS fix, without snapping an emergency position to the course. If no fix is available, the warning still appears and shows that GPS is unavailable; the map focuses when a fix arrives.
- Each warning widget identifies the rider, shows continuously updated **straight-line distance from this escort to the rider**, GPS-fix age and a **MASTER ALERT** button. Distances are not driving directions or road distances.
- The widget's MASTER ALERT silences/dismisses that incident after relay confirmation. **M**, the existing global master shortcut, acknowledges all current incident warnings and existing off-course warnings. Incident acknowledgement synchronizes across escorts and is reported back to the rider. It does not certify that the rider is safe or the problem repaired.
- Simultaneous audio uses one channel: RIDER DOWN takes precedence over MECHANICAL, then OFF COURSE. Other widgets remain visible; after the higher-priority incident is acknowledged, the next warning sounds.
- Pending rider reports are kept in session storage and retried on reconnect. The phone distinguishes “not sent / waiting for connection,” relay receipt, and escort acknowledgement. Duplicate taps/retries do not create duplicate active incidents.
- Active incident warnings and acknowledgements are stored with mission state in `missions.json`, subject to the same storage persistence as existing missions. Alerts retain their last GPS fix if a rider disconnects and are supplied to escorts joining/rejoining the mission.
- Alerts require a working connection to reach an escort. No cellular/internet connection means no instant delivery. GPS, browser audio permissions and the console's sound/volume settings still apply. This is not a replacement for an emergency-services call or a certified safety system.

**Deploying this update:** replace the repository files from the archive, including `server.js`, the changed web files, both new alert MP3s and `sw.js`; commit to the branch used by your existing deployment. A server redeploy is required, not only a frontend refresh. Reload/reopen rider and escort screens after deployment. Existing app shells that load this hosted web UI do not need rebuilding for these web controls.

**Alert tests:** with the local server running, `node test-v19.js` exercises alert delivery, audio selection, GPS focus, distance, acknowledgements, reconnects, missing GPS and mission isolation. Like the existing browser tests, it requires Playwright and Chromium. Screenshots default to `shots/`; override with `UL_SHOTS` if needed.

**New in v1.8 — escort ops & pacing (web only, no APK rebuild needed)**
- **Escort telemetry removed** — escorts now share their position only. Escort cards and the selected-unit panel show position / distance / who they follow; the map marker stays.
- **Off-course voice alarm** — a rider leaving the route triggers a looping cockpit-style voice ("WARNING. OFF COURSE. OFF COURSE. WARNING.", `public/off-course-alert.mp3`). The F/A-18 RWR warning tone plays underneath the voice (the tone dips while the words are spoken, so they stay clear). It repeats until MASTER ALERT (or the M key) is pressed, and also stops when the rider is back on course.
- **Sector finish vs target** — when a rider finishes a sector (or a lap) that has a target, a big pop-up shows e.g. **+12 seconds** (red, behind) or **-12 seconds** (green, ahead). The rider phone shows it too. Every result is recorded per mission (stored on the escort device), and you can see it in the sector board ("RESULTS VS TARGET"), the sector card on the map, and the log. Results are cleared when the clock is reset.
- **Advised speed (lead rider)** — once the clock is running with an overall target, the escort works out the speed the ★ lead rider should ride to finish exactly on target. It uses the same constant-effort physics as the auto sector targets, so it is higher on descents and lower on climbs over the next 300 m. It is shown in the top bar, on the lead card, in the rider pop-up and in the selected-unit panel. Green = on pace, red = too slow, "TARGET OUT OF REACH" / "TARGET TIME PASSED" when the target can no longer be met.

**New in v1.7 — native radio in the Android app (rider mode)**
- Push-to-talk now runs inside the app's background service instead of the web page, so the radio keeps working with the **screen off and battery saver on** (fixes PTT going silent until the app was reopened).
- The app opens its own audio-only link to the relay for the rider's unit (it never shows as an extra unit). Voice uses the existing relay format (12 kHz mu-law), so escorts need no update.
- Bluetooth / headset button, the notification TALK button and the on-screen PTT all key the native radio. Line-open sound = `radio_open.mp3`; if the radio is not linked when you press, you hear an error tone + double vibration.
- Rider screen voice tag shows **RADIO READY / LINKING / WAITING / MIC ERROR**.
- Older apps, iPhone and browser riders keep the previous web radio (WebRTC + relay).


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
