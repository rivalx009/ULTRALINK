/* ULTRALINK v1.6 feature test: RACE / TRAINING profiles, A→B / A→A detection, laps with per-lap sector targets,
   lap-by-lap sector board, COMMS MODE channels (create / join by Channel ID / push-to-talk).
   node server.js   (other terminal)   then   node test-v16.js        (screenshots -> ./shots) */
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/vercel/sandbox/node_modules/playwright'); }
const BASE = process.env.UL_BASE || 'http://127.0.0.1:8080/', WSU = BASE.replace(/^http/, 'ws');
const EXE = fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined;
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const ok = [], bad = []; const check = (n, c, x) => { (c ? ok : bad).push(n); console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x != null ? ' [' + String(x).slice(0, 240) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/* loop GPX: ~5 km circle that finishes at its start, with a hill on one side */
const C = [-20.30, 57.50], R = 800, N = 240;
const loop = Array.from({ length: N + 1 }, (_, i) => { const a = i / N * 2 * Math.PI; return [C[0] + R / 110540 * Math.cos(a), C[1] + R / (111320 * Math.cos(C[0] * Math.PI / 180)) * Math.sin(a), Math.round(40 + 30 * Math.sin(a))]; });
const gpxOf = (name, P) => `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>${name}</name><trkseg>${P.map(p => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><ele>${p[2]}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
const demo = fs.readFileSync(path.join(__dirname, 'demo-route.gpx'));
function client() {
  const ws = new WebSocket(WSU), h = {}, q = [];
  ws.onmessage = e => { if (typeof e.data !== 'string') return; const m = JSON.parse(e.data); (h[m.t] || []).forEach(f => f(m)); };
  ws.onopen = () => q.splice(0).forEach(m => ws.send(JSON.stringify(m)));
  return { on: (t, f) => (h[t] = h[t] || []).push(f), send: m => ws.readyState === 1 ? ws.send(JSON.stringify(m)) : q.push(m), close: () => ws.close() };
}
(async () => {
  const b = await pw.chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async vp => { const ctx = await b.newContext({ viewport: vp, permissions: ['geolocation', 'microphone'], geolocation: { latitude: C[0], longitude: C[1] + 0.02 }, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
    await ctx.route(u => !/127\.0\.0\.1/.test(u.hostname), r => /open-meteo/.test(r.request().url()) ? r.fulfill({ status: 503, body: '' }) : r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    return ctx; };
  const errs = [];
  const watch = (p, tag) => { p.on('pageerror', e => errs.push(tag + ': ' + e.message)); return p; };

  /* ================= planning: renames + race/training tabs ================= */
  const desk = await mk({ width: 1600, height: 950 });
  const e = watch(await desk.newPage(), 'ESC');
  await e.goto(BASE + 'escort.html?noboot=1'); await e.evaluate(() => { localStorage.ulPlanHelp = 1; localStorage.removeItem('ulProfiles'); localStorage.ulPlanTab = 'race'; }); await e.reload();
  await e.waitForSelector('#home', { state: 'visible' });
  check('profile panel titled RACE PROFILES', (await e.textContent('#pTitle')) === 'RACE PROFILES');
  check('race tab: ＋ NEW RACE PROFILE', /NEW RACE PROFILE/.test(await e.textContent('#pNew')));
  check('"ENTER PROFILE" replaces "ACTIVATE MISSION"', /ENTER PROFILE/.test(await e.textContent('#dGo')) && !/ACTIVATE MISSION/.test(await e.content()));
  await e.click('#tabTrain');
  check('training tab: ＋ NEW TRAINING PROFILE', /NEW TRAINING PROFILE/.test(await e.textContent('#pNew')) && (await e.textContent('#pTitle')) === 'TRAINING PROFILES');

  /* ---- A → B training route ---- */
  await e.click('#pNew'); await e.waitForSelector('#detPanel.open');
  check('detail panel says TRAINING PROFILE', (await e.textContent('#dTitle')) === 'TRAINING PROFILE');
  await e.setInputFiles('#fGpx', { name: 'demo.gpx', mimeType: 'application/gpx+xml', buffer: demo });
  await e.waitForSelector('.rtype');
  check('A → B detected immediately after the GPX import', await e.isVisible('.rtype.ab'), await e.textContent('.rtype'));
  check('no lap option on a point-to-point route', !(await e.$('#fLapsOn')));
  await e.click('#dSave');

  /* ---- A → A loop with laps ---- */
  await e.click('#pNew'); await e.waitForSelector('#detPanel.open');
  await e.fill('#fName', 'LOOP TRAINING'); await e.fill('#fEsc', 'COACH-1');
  await e.setInputFiles('#fGpx', { name: 'loop.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxOf('LOOP', loop)) });
  await e.waitForSelector('.rtype');
  check('A → A loop detected immediately', await e.isVisible('.rtype.aa'), await e.textContent('.rtype'));
  await e.check('#fLapsOn'); await e.waitForSelector('#fLaps');
  await e.fill('#fLaps', '3'); await e.dispatchEvent('#fLaps', 'change');
  await e.waitForSelector('[data-lt="2"]');
  check('lap target inputs for 3 laps', (await e.$$('[data-lt]')).length === 3);
  await e.fill('[data-lt="0"]', '9:00'); await e.fill('[data-lt="1"]', '9:30'); await e.fill('[data-lt="2"]', '8:45');
  const ft = await e.inputValue('#fTarget');
  check('overall target = sum of lap targets (27:15)', ft === '27:15', ft);
  await e.fill('#fSplitN', '2'); await e.click('#fSplit');
  await e.click('#fSecT'); await e.waitForSelector('#dlgSecT .laptabs');
  const tabs = await e.$$eval('#dlgSecT [data-lap]', x => x.map(b => b.textContent));
  check('sector targets shown lap by lap (3 lap tabs)', tabs.length === 3, tabs.join(' | '));
  const l2 = await e.$$eval('#dlgSecT [data-t]', x => x.map(i => i.value));
  check('lap 1 sector targets split from the lap target', l2.length === 2 && l2.every(Boolean), l2.join(','));
  await e.click('#dlgSecT [data-lap="1"]');
  await e.fill('#dlgSecT [data-t="0"]', '5:00'); await e.dispatchEvent('#dlgSecT [data-t="0"]', 'change');
  await e.screenshot({ path: path.join(SHOTS, '20-lap-sector-targets.png') });
  await e.click('#stOk');
  await e.click('#dSave');
  await e.evaluate(() => document.getElementById('lapBox').scrollIntoView());
  await e.screenshot({ path: path.join(SHOTS, '19-training-laps.png') });
  const cur = await e.evaluate(() => UL.Plan._debug.cur);
  check('lap 2 sector 1 target kept by hand (5:00)', cur.lapSec && cur.lapSec[1][0] === 300, JSON.stringify(cur.lapSec));
  const listTxt = await e.textContent('#profList');
  check('training list shows A→A · 3 LAPS', /A→A · 3 LAPS/.test(listTxt) && /A→B/.test(listTxt), listTxt.replace(/\s+/g, ' ').slice(0, 160));

  /* ---- enter the profile ---- */
  await e.click('#dGo'); await e.waitForSelector('#shell', { state: 'visible', timeout: 15000 });
  const code = (await e.textContent('#tCode')).replace('CODE ', '');
  check('live session shows TRAINING · 3 LAPS', /TRAINING · 3 LAPS/.test(await e.textContent('#tMis')), await e.textContent('#tMis'));
  /* rider bot rides the loop 3 times (covered distance along the unrolled route) */
  const L = await e.evaluate(() => { const r = window.__ul && window.__ul.route; return null; });
  const rider = client(); rider.send({ t: 'join', code, role: 'rider', callsign: 'FALCON-1' });
  const mis = await new Promise(r => rider.on('joined', m => r(m.mission)));
  check('relay mission carries 3 laps + 6 lap sectors', mis.laps === 3 && mis.sectors.length === 6 && mis.sectors[3].name.startsWith('LAP 2'), mis.laps + ' / ' + mis.sectors.map(s => s.name).join(','));
  check('lap 2 sector 1 target travels to the live mission (5:00)', mis.sectors[2].target === 300, mis.sectors[2].target);
  const total = mis.distance; let d = 0, ts = Date.now();
  await sleep(800);
  while (d < total) { d = Math.min(total, d + 60); ts += 9000; rider.send({ t: 'telemetry', data: { lat: C[0], lon: C[1], speed: 7, covered: d, remaining: total - d, ts, grade: 0, offRoute: 3 } }); await sleep(12); }
  await sleep(1500);
  const logTxt = await e.textContent('#log');
  check('lap times logged (LAP 1 / 3 … LAP 3 / 3)', /LAP 1 \/ 3 in/.test(logTxt) && /LAP 3 \/ 3 in/.test(logTxt), (logTxt.match(/LAP \d \/ 3 in [^)]*\)?/g) || []).join(' | '));
  check('session finish logged', /FINISHED THE SESSION \(3 LAPS\)/.test(logTxt));
  await e.click('#btnSectors'); await e.waitForSelector('#dlgBoard[open]');
  const board = await e.textContent('#dlgBoard');
  check('sector board lap by lap', /SECTOR BOARD · 3 LAPS/.test(board) && /LAP 1/.test(board) && /LAP 3/.test(board) && /LAP TIME/.test(board), board.replace(/\s+/g, ' ').slice(0, 200));
  await e.screenshot({ path: path.join(SHOTS, '21-lap-sector-board.png') });
  await e.evaluate(() => document.getElementById('dlgBoard').close());
  rider.close();

  /* ================= COMMS MODE ================= */
  const pa = watch(await (await mk({ width: 390, height: 800 })).newPage(), 'CA'), pb = watch(await (await mk({ width: 390, height: 800 })).newPage(), 'CB');
  await pa.goto(BASE + 'comms.html'); await pb.goto(BASE + 'comms.html');
  await pa.fill('#call', 'ALPHA'); await pa.click('#create');
  await pa.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  const cid = (await pa.textContent('#cid')).replace(/\s/g, '');
  check('create channel → 6-digit Channel ID', /^\d{6}$/.test(cid), cid);
  await pb.fill('#call', 'BRAVO'); await pb.click('#joinT'); await pb.fill('#chId', '999999'); await pb.click('#join');
  await pb.waitForFunction(() => /NOT FOUND/.test(document.getElementById('err').textContent), null, { timeout: 5000 }).catch(() => {});
  check('unknown Channel ID refused', /NOT FOUND/.test(await pb.textContent('#err')));
  await pb.fill('#chId', cid); await pb.click('#join');
  await pb.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await pa.waitForFunction(() => document.getElementById('ucount').textContent === '2', null, { timeout: 6000 }).catch(() => {});
  check('both units on the channel', (await pa.textContent('#ucount')) === '2' && (await pb.textContent('#ucount')) === '2');
  check('no telemetry/location in comms mode', !(await pa.evaluate(() => !!window.__rider || /covered|GPS/.test(document.getElementById('app').textContent))));
  const r = client(); let rerr = null; r.on('error', m => rerr = m.code); r.send({ t: 'join', code: cid, role: 'rider', callsign: 'X' }); await sleep(600); r.close();
  check('rider cannot join a comms channel', rerr === 'NO_MISSION', rerr);
  const pbox = await pa.$('#ptt'); const bb = await pbox.boundingBox();
  await pa.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pa.mouse.down();
  await pb.waitForSelector('#rx', { state: 'visible', timeout: 4000 }).catch(() => {});
  check('push-to-talk reaches the other unit', /ALPHA/.test(await pb.textContent('#rx')) && await pb.isVisible('#rx'));
  check('talking unit highlighted', await pb.evaluate(() => !!document.querySelector('.unit.tx')));
  await pb.screenshot({ path: path.join(SHOTS, '22-comms-channel.png') });
  await pa.mouse.up(); await sleep(500);
  check('line closes on release', !(await pb.isVisible('#rx')));
  await pb.click('#latch'); await pb.click('#ptt'); await sleep(400);
  check('hands-free latch keeps the line open', /ALPHA|BRAVO/.test(await pa.textContent('#rx')) && await pa.isVisible('#rx'));
  await pb.click('#ptt'); await sleep(300);
  await pa.screenshot({ path: path.join(SHOTS, '23-comms-alpha.png') });
  const sp = watch(await (await mk({ width: 390, height: 800 })).newPage(), 'CS'); await sp.goto(BASE + 'comms.html'); await sp.screenshot({ path: path.join(SHOTS, '24-comms-start.png') });
  const idx = await (await mk({ width: 1200, height: 900 })).newPage(); await idx.goto(BASE + 'index.html?noboot=1');
  check('mode select offers COMMS MODE', /COMMS MODE/.test(await idx.textContent('body')));
  await idx.screenshot({ path: path.join(SHOTS, '25-mode-select.png') });

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  await b.close(); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
