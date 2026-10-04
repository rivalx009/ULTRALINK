/* ULTRALINK v1.5 feature test: ARCTIC/DARK appearance, widget minimise, live GPS refresh, lead power engine + widget, phone layout.
   node server.js   (other terminal)   then   node test-v15.js        (screenshots -> ./shots) */
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/vercel/sandbox/node_modules/playwright'); }
const BASE = process.env.UL_BASE || 'http://127.0.0.1:8080/', WSU = BASE.replace(/^http/, 'ws');
const EXE = fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const ok = [], bad = []; const check = (n, c, x) => { (c ? ok : bad).push(n); console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x != null ? ' [' + String(x).slice(0, 240) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* route from the demo GPX */
const gpx = fs.readFileSync(path.join(__dirname, 'demo-route.gpx'), 'utf8');
const pts = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">\s*<ele>([-\d.]+)<\/ele>/g)].map(m => [+m[1], +m[2], Math.round(+m[3])]);
const hav = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]); const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
let D = 0; const cum = pts.map((p, i) => (i ? (D += hav(pts[i - 1], p)) : 0));
const at = d => { let i = cum.findIndex(c => c >= d); if (i <= 0) i = 1; const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); const a = pts[i - 1], b = pts[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
function client() {
  const ws = new WebSocket(WSU), h = {}, q = [];
  ws.onmessage = e => { if (typeof e.data !== 'string') return; const m = JSON.parse(e.data); (h[m.t] || []).forEach(f => f(m)); };
  ws.onopen = () => q.splice(0).forEach(m => ws.send(JSON.stringify(m)));
  return { on: (t, f) => (h[t] = h[t] || []).push(f), send: m => ws.readyState === 1 ? ws.send(JSON.stringify(m)) : q.push(m), close: () => ws.close() };
}
(async () => {
  console.log('route', pts.length, 'pts', (D / 1000).toFixed(1), 'km');
  const CODE = 'T15' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const boss = client();
  await new Promise(res => { boss.on('mission.created', res); boss.send({ t: 'mission.create', code: CODE, name: 'V15 TEST', route: pts, distance: D, riders: [{ codename: 'FALCON-1', color: '#7cff5a' }], sectors: [{ name: 'S1', color: '#00e5ff', start: 0 }, { name: 'S2', color: '#ffb000', start: D / 2 }] }); });
  check('mission created over the relay', true, CODE);

  const b = await pw.chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async vp => { const ctx = await b.newContext({ viewport: vp, permissions: ['geolocation', 'microphone'], geolocation: { latitude: pts[0][0], longitude: pts[0][1] }, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
    await ctx.route(u => !/127\.0\.0\.1/.test(u.hostname), r => { const u = r.request().url(); if (/open-meteo/.test(u)) { const n = (new URL(u).searchParams.get('latitude') || '0').split(',').length; return r.fulfill({ json: Array.from({ length: n }, () => ({ current: { wind_speed_10m: 7, wind_direction_10m: 60, wind_gusts_10m: 11 } })) }); } if (/\.(png|jpg)|tile|MapServer/.test(u)) return r.fulfill({ body: PNG, contentType: 'image/png' }); return r.abort(); });
    return ctx; };
  const errs = [];
  const open = async (ctx, tag, lead) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FAILED|net::/.test(m.text())) errs.push(tag + ' console: ' + m.text()); });
    await p.goto(BASE + 'escort.html?noboot=1');
    await p.evaluate(([c, l]) => { localStorage['ulLead:' + c] = l; localStorage.ulPlanHelp = 1; }, [CODE, lead]);
    await p.reload(); await p.waitForSelector('#home', { state: 'visible' });
    await p.evaluate(([c, t]) => UL.Plan.onJoin(c, t), [CODE, tag]);
    await p.waitForSelector('#shell', { state: 'visible', timeout: 15000 });
    return p;
  };
  const desk = await mk({ width: 1600, height: 950 });
  const esc = await open(desk, 'ESCORT-1', 'FALCON-1');
  check('escort joined the live mission', await esc.isVisible('#shell'));
  check('brand wordmark in the top bar', await esc.evaluate(() => !!document.querySelector('#top .wm')));

  /* ---- rider bot: moves along the GPX, flat then climbing, answers gps.refresh with a fresh fix ---- */
  const rider = client(); let d = 200, refreshed = 0, tick = 0;
  rider.send({ t: 'join', code: CODE, role: 'rider', callsign: 'FALCON-1' });
  const send = fresh => { const p = at(d), v = tick < 20 ? 11 : 6; const m = { t: 'telemetry', data: { lat: p[0], lon: p[1], ele: p[2], speed: v, covered: d, remaining: D - d, offRoute: 2, grade: 0, ts: Date.now(), heading: 0 } }; if (fresh) m.fresh = fresh; rider.send(m); };
  rider.on('gps.refresh', m => { refreshed++; setTimeout(() => send(m.rid), 300); });
  const iv = setInterval(() => { tick++; d += tick < 20 ? 11 : 6; send(); }, 1000);
  await sleep(5000);

  /* ---- power widget ---- */
  const pwrTxt = () => esc.evaluate(() => ({ w: document.querySelector('.pw-w').textContent, who: document.querySelector('.pw-who').textContent, zone: document.querySelector('.pw-zone span').textContent, src: document.querySelector('.pw-src').innerText, live: document.querySelector('.pw-live').textContent }));
  let t = await pwrTxt();
  check('power widget follows the ★ lead rider', /FALCON-1/.test(t.who), t.who);
  check('live power estimate shown (W)', /^\d+$/.test(t.w) && +t.w > 50, t.w + ' W · ' + t.live);
  check('model uses rider speed + GPX gradient', /SPEED/.test(t.src) && /GPX GRADE/.test(t.src), t.src);
  check('zones locked until FTP is saved', /ENTER FTP/.test(t.zone), t.zone);
  await esc.fill('.pw-ftp', '280'); await esc.fill('.pw-rk', '68'); await esc.fill('.pw-bk', '7.6'); await esc.click('.pw-save');
  await sleep(4000);
  t = await pwrTxt();
  check('FTP + weights saved per rider', await esc.evaluate(() => JSON.parse(localStorage['ulPwr:FALCON-1'] || '{}').ftp === 280), await esc.evaluate(() => localStorage['ulPwr:FALCON-1']));
  check('current power zone named + coloured', /^Z\d · /.test(t.zone), t.zone);
  const zt = await esc.evaluate(() => [...document.querySelectorAll('.pw-zr')].map(r => r.querySelector('.pw-zn').textContent + ' ' + r.querySelector('.pw-zt').textContent));
  check('time-in-zone histogram with 7 named zones', zt.length === 7 && /Z7 NEUROMUSCULAR/.test(zt[6]), zt.join(' | '));
  check('zone time accumulating', await esc.evaluate(() => __ul.power.engines.get('FALCON-1').zoneSec.some(x => x > 0)));
  await esc.screenshot({ path: path.join(SHOTS, '1-desktop-dark.png') });
  await esc.locator('#pwrBox').screenshot({ path: path.join(SHOTS, '2-power-widget-dark.png') });

  /* ---- live GPS refresh ---- */
  check('GPS refresh buttons present (top bar + map)', await esc.evaluate(() => document.querySelectorAll('.gpsbtn').length === 2));
  await esc.click('#btnGps');
  await sleep(1200);
  check('rider received the refresh request', refreshed === 1, refreshed);
  check('refresh button shows activity', await esc.evaluate(() => document.getElementById('btnGps').classList.contains('busy')));
  await sleep(7000);
  const logTxt = await esc.evaluate(() => document.getElementById('log').innerText);
  check('fresh fix from every unit reported', /FRESH FIX FROM 1\/1 UNITS/.test(logTxt), logTxt.split('\n').filter(l => /GPS/.test(l)).join(' / '));
  check('rider marker redrawn on the map', await esc.evaluate(() => !!__ul.units.values().next().value.marker));
  await esc.keyboard.press('KeyG'); await sleep(800);
  check('keyboard G also refreshes', refreshed === 2, refreshed);

  /* ---- minimise / maximise ---- */
  const ids = ['#pwrBox', '#comms', '#layers', '#mapopts', '#sel', '#gbox', '#left'];
  const cnt = await esc.evaluate(ids => ids.filter(i => document.querySelector(i + ' .wmin-btn')).length, ids);
  check('minimise button on every ops widget', cnt === ids.length, cnt + '/' + ids.length);
  check('unit cards have their own minimise button', await esc.evaluate(() => document.querySelectorAll('.ucard .wmin-btn').length >= 2));
  await esc.click('#pwrBox .pw-h .wmin-btn');
  check('widget collapses on click', await esc.evaluate(() => document.getElementById('pwrBox').classList.contains('wmin') && getComputedStyle(document.querySelector('#pwrBox .pw-b')).display === 'none'));
  await esc.click('#gbox .wmin-btn'); await sleep(300);
  check('graph collapses and bottom panel shrinks', await esc.evaluate(() => document.getElementById('bottom').classList.contains('gmin')));
  await esc.click('.ucard .uh .wmin-btn');
  await esc.screenshot({ path: path.join(SHOTS, '3-desktop-minimised.png') });
  await esc.click('#pwrBox .pw-h .wmin-btn'); await esc.click('#gbox .wmin-btn'); await esc.click('.ucard .uh .wmin-btn');
  check('widget maximises on second click', await esc.evaluate(() => !document.getElementById('pwrBox').classList.contains('wmin')));
  await esc.evaluate(() => __ul.selectUnit([...__ul.units.keys()][0])); await sleep(900);
  check('rider pop-up has a minimise button', await esc.evaluate(() => !!document.querySelector('#riderPop .ph .wmin-btn')));

  /* ---- appearance ---- */
  const opts = await esc.evaluate(() => Object.values(UL.THEMES).map(t => t.label));
  check('appearance options are exactly DARK + ARCTIC', opts.join() === 'DARK,ARCTIC', opts.join());
  await esc.evaluate(() => { UL.cfg.set('theme', 'arctic'); });
  await sleep(500);
  const ar = await esc.evaluate(() => { const cs = getComputedStyle(document.body), card = getComputedStyle(document.querySelector('.ucard')); return { light: document.body.classList.contains('light'), fg: cs.color, card: card.backgroundImage }; });
  check('ARCTIC: dark-grey text', ar.light && /rgb\((5\d|4\d|3\d), (5\d|4\d|3\d|6\d)/.test(ar.fg), ar.fg);
  check('ARCTIC: light-grey widgets', /rgb\(2[0-3]\d, 2[0-3]\d, 2[0-3]\d\)/.test(ar.card), ar.card.slice(0, 120));
  await esc.screenshot({ path: path.join(SHOTS, '4-desktop-arctic.png') });
  await esc.locator('#pwrBox').screenshot({ path: path.join(SHOTS, '5-power-widget-arctic.png') });
  await esc.click('#btnSettings'); await sleep(300);
  await esc.screenshot({ path: path.join(SHOTS, '6-settings-arctic.png') });
  await esc.keyboard.press('Escape');
  await esc.evaluate(() => UL.cfg.set('theme', 'void')); await sleep(200);
  check('DARK restores the original look', await esc.evaluate(() => !document.body.classList.contains('light') && getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#05080a'));

  /* ---- phone layout ---- */
  const phone = await mk({ width: 390, height: 844 });
  const ph = await open(phone, 'ESCORT-2', 'FALCON-1');
  await sleep(2500);
  check('phone: tab bar shown', await ph.isVisible('#mTabs'));
  check('phone: clock bar moved into MORE sheet', await ph.evaluate(() => document.getElementById('clockbar').parentNode.id === 'mMore'));
  await ph.screenshot({ path: path.join(SHOTS, '7-phone-map.png') });
  await ph.click('#mTabs [data-tab=units]'); await sleep(450);
  check('phone: UNITS sheet opens', await ph.evaluate(() => document.body.classList.contains('mt-units') && getComputedStyle(document.getElementById('left')).transform === 'none'));
  await ph.screenshot({ path: path.join(SHOTS, '8-phone-units.png') });
  await ph.click('#mTabs [data-tab=power]'); await sleep(1500);
  check('phone: POWER sheet shows the power widget', await ph.evaluate(() => getComputedStyle(document.getElementById('pwrBox')).display !== 'none' && getComputedStyle(document.getElementById('units')).display === 'none'));
  await ph.screenshot({ path: path.join(SHOTS, '9-phone-power.png') });
  await ph.click('#mTabs [data-tab=profile]'); await sleep(450); await ph.screenshot({ path: path.join(SHOTS, '10-phone-profile.png') });
  await ph.click('#mTabs [data-tab=more]'); await sleep(450); await ph.screenshot({ path: path.join(SHOTS, '11-phone-more.png') });
  await ph.click('#mTabs [data-tab=map]'); await sleep(300);
  await ph.evaluate(() => UL.cfg.set('theme', 'arctic')); await sleep(300);
  await ph.screenshot({ path: path.join(SHOTS, '12-phone-arctic.png') });
  await ph.click('#btnGps'); await sleep(1000);
  check('phone: GPS refresh works too', refreshed === 3, refreshed);

  /* ---- rider screen (phone) ---- */
  const rp = await phone.newPage(); await rp.goto(BASE + 'rider.html'); await sleep(500);
  check('rider login offers escort mode', await rp.isVisible('#toEscort'));
  await rp.screenshot({ path: path.join(SHOTS, '13-rider-login.png') });
  const ip = await desk.newPage(); await ip.goto(BASE); await sleep(400); await ip.screenshot({ path: path.join(SHOTS, '14-start-page.png') });

  clearInterval(iv); rider.close(); boss.close();
  check('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`); if (bad.length) { console.log('FAILED:\n - ' + bad.join('\n - ')); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
