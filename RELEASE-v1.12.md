# ULTRALINK v1.12.0 — accounts, rider details, component wind and forecast

## Before deployment: persistent storage is REQUIRED

This release adds real server-side accounts, not a callsign-only browser save.
Every device must open the SAME ULTRALINK server URL and use the same account
callsign/password to access that account's profiles. Separate local servers do
not synchronize with one another.

No hosting changes or purchases have been made. The existing render.yaml still
uses its original free plan; it does NOT silently buy a disk or change plans.
On Render, account operations deliberately return a clear 503 error unless
UL_DATA_DIR is configured. Pointing it at an ephemeral folder is NOT sufficient.

### Existing Render service
1. Back up/export your current race profiles before replacing the release.
2. Choose a Render service configuration that supports a persistent disk.
   Render's persistent disks require a paid service. Review Render's terms/cost
   yourself before making any hosting change.
3. Add a disk mounted at `/var/data` in that service's dashboard.
4. Add environment variable `UL_DATA_DIR=/var/data`.
5. Deploy this source to that SAME service, using HTTPS and one server instance.
6. Confirm account signup, create/save a test profile and wait for ACCOUNT SYNCED.
7. Sign in from another device and verify the profile is present.
8. Restart/redeploy and repeat the check BEFORE relying on this for an event.

Only files under the actual mounted persistent disk survive a redeploy. The app
cannot verify that a directory named /var/data is really a mounted Render disk.
Do not set UL_DATA_DIR without also mounting durable storage there.

If you want to keep a free web service, a separate durable database integration
would be needed; that alternative is not implemented in this file-based release.
The file store is intentionally SINGLE PROCESS / SINGLE INSTANCE. Do not run
multiple workers, replicas or servers against the same account file.

### Local use
Node 18+ supports the server; the Dockerfile retains Node 22. Run `node server.js`
and open http://localhost:8080. No npm packages or build step are needed.
Account data lives in `data/accounts.json` by default locally. Back up this folder
securely. UL_DATA_DIR can point to another persistent local directory. For access
from other computers use HTTPS; account operations reject cleartext remote HTTP.
The existing `--tls` flow remains available with your certificates.

## 1. Accounts
- The original Rider / Escort / Comms mode buttons remain unchanged.
- Choose a mode to open CALLSIGN and PASSWORD. Callsigns are case-insensitive,
  3–24 letters/numbers/hyphens/underscores. Passwords are case-sensitive, 12–128
  characters. Known callsign -> SIGN IN; new callsign -> SIGN UP.
- SIGN UP explicitly creates the account; checking a callsign never creates it.
- Existing authenticated sessions can CONTINUE AS their current callsign.
- Sessions last up to 30 days; up to ten active sessions per account. SIGN OUT
  revokes the current session. Existing WebSocket traffic is rejected after
  revocation/expiry, and idle sockets are checked by the heartbeat.
- Passwords use salted scrypt hashes, never plaintext. Sessions use random
  HttpOnly/SameSite=Strict cookies; Secure over HTTPS. Stored session identifiers
  are hashed. Account writes check Origin; authentication and lookup endpoints
  have process-local rate limits and password hashing has a concurrency cap.
- No account recovery, email verification, MFA, password-change UI or admin
  account management is included. Keep the password safe. Callsign availability
  is intentionally discoverable to meet the requested SIGN IN/SIGN UP workflow.
- This is functional tested application code, not an independent security audit.

### Profile portability and migration
- Full race/training profile objects sync: route/GPX points, sectors/checkpoints,
  notes, schedules, targets, rider codenames/colours, lap settings and lead choice.
- Save locally, then wait for ACCOUNT SYNCED before changing devices. The account
  button shows errors/retry, export and reload options. Network failure keeps the
  account-scoped local copy; do not clear browser storage while it is unsynced.
- New devices load the server copy before the planning application starts.
- Version checks reject stale writes with a conflict instead of silently replacing
  another device's changes. Export the local copy, then reload the account copy.
  Simultaneous offline edits are not automatically merged.
- Existing v1.11.2 `ulProfiles` are NOT automatically assigned to whoever signs in
  on a shared computer. In Escort planning use IMPORT PROFILES FROM THIS DEVICE,
  confirm ownership, then wait for ACCOUNT SYNCED. Originals are retained.
- Existing JSON profile IMPORT/EXPORT remains available. The account export makes
  an array backup; planning IMPORT accepts either an individual profile or this
  full collection. Retain both originals and regular backups.
- Microphone device IDs, Bluetooth/HID bindings and visual preferences stay
  device-local. Live GPS, active PTT, elapsed in-memory sector timers, comms logs
  and a running browser session do NOT transfer automatically to a new laptop.
  Saved planning profiles are portable; full live-console failover is not claimed.
- New missions are account-owned for create/update/clock/end controls. Knowing a
  mission code still allows authenticated rider/escort joins under the existing
  mission-code collaboration model; accounts do not add invitation management.

## 2. Rider details
Rider name and weight in kilograms (10–350 kg) are required for Rider Mode.
They can be entered at rider signup or on first Rider Mode use by an existing
account, and edited via ACCOUNT. They are saved on the server and included in the
mission roster so the escort can see them. Rejoin after editing roster details.
The separate rider/bike power-estimate settings are not silently overwritten.

## 3. Any selected rider's wind
Click any rider's map icon or unit card. Its own position and heading resolve the
wind panel; the rider need NOT be lead. Unknown heading shows an explicit message
rather than assuming north. Route bearing is used where available as before.
Two distinct flow arrows show the along-course (head/tailwind) and crosswind
components relative to travel (up). Crosswind indicates the side it comes FROM.
The largest adverse component is red (ties both red), weaker components are
amber/yellow, near-zero neutral, and tailwind green. Labels accompany all colours.
This is a WIND-COMPONENT STRENGTH proxy, not a measured aerodynamic drag ranking:
a strong sidewind is not physically equivalent to the same-speed headwind.
Existing apparent-wind and estimated wind-cost figures remain separate.
Wind is Open-Meteo model data, scaled to approximate rider height as before;
manual override remains available. Cached/stale model wind is labelled.

## 4. Minimizable weather
The weather header is docked above the live map area, initially minimized.
Expand with +, minimize with −, refresh with the refresh button. The state is
remembered locally. In planning it follows the opened profile's route start.
During operations it follows the selected rider's GPS (not just the lead), or
the escort/route start when no rider is selected. Missing rider GPS does not
silently substitute another rider. Stale rider fixes are labelled.
Current model conditions: temperature, feels-like, humidity, precipitation,
wind, gusts and direction. Forecast: next six hourly temperatures/rain chances.
Model valid time, fetch time, location timezone, coordinates and provider are
shown. Refresh every ten minutes; errors preserve explicitly labelled cached
conditions and retry after a backoff. A position change cancels obsolete requests.
The six-hour forecast is scrollable in compact layouts.
This is live-updating MODEL weather, not real-time local sensor observations or
an official severe-weather warning service. Internet/provider availability is
required. Coordinates are sent to Open-Meteo. Review the provider's current
usage/licensing rules before commercial deployment; the default keyless endpoint
is not a promise of licensed commercial access.

## Preservation / app scope
This release retains the existing server/public layout, warnings, rider-down and
mechanical controls, Emergency Frequency text-to-speech, maps, profile planning,
radio, Bluetooth input selection and physical keyboard/HID PTT. No node_modules,
compiler, ESP32 firmware, screenshot files or test account database is deployed.
Added runtime files: accounts.js, public/ul-account.js, public/ul-weather.js.
Native Windows/Android installers and APKs have NOT been rebuilt or hardware
verified. The browser/PWA is the tested target. Older native audio-sidecar code
that opens its own WebSocket without the authenticated WebView session cookie
needs a native update; do not assume background native radio will work in this
account-gated release. Browser foreground radio retains its existing path.

## Operational limitations
The source is not deployed. Configure durable storage and test on your own
HTTPS deployment and real rider/escort devices before event use. Maintain backups
of the private data folder, never commit it. This release does not replace an
emergency service or safety-critical communications channel.

References:
- https://render.com/docs/disks
- https://open-meteo.com/en/docs
