# ULTRALINK v1.12.1 — Neon PostgreSQL account storage

## Start here
Read NEON-SETUP-v1.12.1.txt for the step-by-step Render Free + Neon Free setup.
This replaces v1.12.0's disk-based account backend. No Render disk is required.
Use Node 22+, run `npm ci --omit=dev --ignore-scripts`, set DATABASE_URL privately,
then `npm start`. Docker installs the pinned pg dependency automatically.

Accounts, salted password hashes, rider details, saved race/training profiles,
profile versions and hashed sign-in sessions are stored in PostgreSQL. Tables
are created automatically; no SQL needs to be pasted into the Neon console.
All devices must use the SAME hosted ULTRALINK HTTPS URL and account.
Separate local servers synchronize account data only if pointed at the same DB;
live mission/radio state is still single-server, not multi-instance clustered.

The connection pool has at most three connections and releases idle connections
after ten seconds. Remote database TLS certificates are verified. Queries use
parameters; profile updates use an atomic version check. The service never falls
back to an ephemeral account file if the database is unavailable. SQL error logs
contain error codes, not connection strings or password-bearing error details.
Existing live WebSockets use cached authentication between 20-second database
revalidations, rather than a query for every audio/telemetry frame. A successful
sign-out invalidates the local cached session; other processes detect revocation
at revalidation. A DB failure during revalidation closes that socket fail-closed.

DATABASE_URL is a SECRET. Enter it in Render Environment only. Never commit it,
put it in public JavaScript, paste it in chat or include it in a screenshot.
UL_DATA_DIR is no longer account storage; it only changes the location of legacy
live mission snapshots. On Render Free those snapshots remain ephemeral.
A saved profile in Neon survives a web-server restart. Active live mission state,
incident snapshots, live GPS, PTT, in-memory timers and open mission connections
do NOT become durable or automatically fail over just because Neon is connected.

### Existing data: back up BEFORE replacing v1.12.0
Browser profiles and the old accounts.json are not automatically uploaded.
- If profiles were saved before accounts: on the original browser, sign into
  the Neon-backed deployment, then use IMPORT PROFILES FROM THIS DEVICE.
- If profiles were saved in a v1.12.0 account: EXPORT that account's profiles
  BEFORE deployment. After migration/import, use planning IMPORT and wait for
  ACCOUNT SYNCED. Keep the backup until a second device confirms the data.
- If actual v1.12.0 accounts already exist and you have their private accounts.json:
  an optional migrate-accounts.js utility preserves callsigns, password hashes,
  rider details and profiles. Read MIGRATION-v1.12.1.txt BEFORE new users sign up.
  It never overwrites a duplicate callsign and rolls back the entire batch on a
  collision. Old sessions are deliberately not imported: sign in again.
- A new empty Neon database does not know old file-based passwords/accounts until
  migrated. Do not interpret a fresh SIGN UP prompt as proof the old data is safe.
- If old ephemeral server data has already disappeared, this update cannot recover
  it. Preserve browser exports; do not clear browser storage while unsynced.

### Local development
Set DATABASE_URL in the shell's private environment, install packages with npm ci,
and run npm start from this folder. Loopback HTTP is allowed for development;
remote account operations require HTTPS. There is no longer a zero-dependency
local account backend. The optional Windows launchers require DATABASE_URL too.
Never commit an .env file or a private legacy accounts.json.

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
Account runtime files: accounts.js and postgres-store.js; public account/weather
scripts remain unchanged. pg is installed from package-lock.json during build.
Native Windows/Android installers and APKs have NOT been rebuilt or hardware
verified. The browser/PWA is the tested target. Older native audio-sidecar code
that opens its own WebSocket without the authenticated WebView session cookie
needs a native update; do not assume background native radio will work in this
account-gated release. Browser foreground radio retains its existing path.

## Operational limitations
The source is not deployed. Configure DATABASE_URL and test your own HTTPS
deployment and real rider/escort devices before event use. Maintain private
profile exports and database backups. Never commit account/session data. This release does not replace an
emergency service or safety-critical communications channel.

References:
- https://render.com/docs/free
- https://render.com/docs/configure-environment-variables
- https://neon.com/docs/connect/connect-from-any-app
- https://neon.com/pricing
- https://open-meteo.com/en/docs
