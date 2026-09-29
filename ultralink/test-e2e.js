/* end-to-end: boot → planning home → profile (route, sectors, targets) → activate → riders → wind/draft popup → graph zoom → sector timing */
const { chromium } = require('/vercel/sandbox/node_modules/playwright');
const BASE = 'http://127.0.0.1:8080/';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ok = [], bad = [];
const check = (n, c, extra) => { (c ? ok : bad).push(n + (extra ? ' [' + extra + ']' : '')); console.log((c ? '  PASS  ' : '  FAIL  ') + n + (extra ? ' [' + extra + ']' : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, permissions: ['geolocation', 'microphone'], geolocation: { latitude: -20.3484, longitude: 57.5522 } });
  await ctx.route(u => !/127\.0\.0\.1/.test(u.hostname), r => {
    const u = r.request().url();
    if (/open-meteo/.test(u)) { const n = (new URL(u).searchParams.get('latitude') || '0').split(',').length; return r.fulfill({ json: Array.from({ length: n }, () => ({ current: { wind_speed_10m: 7, wind_direction_10m: 60, wind_gusts_10m: 11 } })) }); }
    if (/\.(png|jpg|jpeg)|tile|MapServer|basemaps/.test(u)) return r.fulfill({ body: PNG, contentType: 'image/png' });
    return r.abort();
  });
  const errs = [];
  const esc = await ctx.newPage();
  esc.on('console', m => { if (m.type() === 'error') errs.push('ESCORT: ' + m.text()); });
  esc.on('pageerror', e => errs.push('ESCORT-EX: ' + e.message));
  await esc.goto(BASE + 'escort.html');

  /* ---- boot ---- */
  await esc.waitForTimeout(1600); await esc.screenshot({ path: 'shot-boot1.png' });
  await esc.waitForTimeout(2600); await esc.screenshot({ path: 'shot-boot2.png' });
  const bootTxt = await esc.evaluate(() => document.getElementById('boot')?.innerText.replace(/\n+/g, ' | ').slice(0, 400));
  check('boot screen shows ULTRALINK LOADING + checks', /ULTRALINK/.test(bootTxt || '') && /SATELLITE|CORE/.test(bootTxt || ''), (bootTxt || '').slice(0, 120));
  await esc.waitForSelector('#home', { state: 'visible', timeout: 30000 });
  await esc.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 8000 });
  check('boot hands over to home screen', true);
  await esc.waitForTimeout(1200);
  const hs = await esc.evaluate(() => ({ marker: !!document.querySelector('#homeMap .leaflet-marker-icon'), gps: document.getElementById('hGps').textContent, list: document.getElementById('profList').innerText.slice(0, 60) }));
  check('home map shows my position + empty profile list', hs.marker && /No mission profiles/.test(hs.list), JSON.stringify(hs));
  await esc.evaluate(() => document.getElementById('dlgHelp').close());
  await esc.screenshot({ path: 'shot-home.png' });

  /* ---- create profile ---- */
  await esc.click('#pNew');
  await esc.waitForSelector('#detPanel.open');
  await esc.fill('#fName', 'OP NORTHWIND'); await esc.fill('#fEsc', 'ESCORT-1');
  const soon = new Date(Date.now() + 45000); const pad = n => String(n).padStart(2, '0');
  await esc.fill('#fDate', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
  await esc.fill('#fTime', `${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  await esc.setInputFiles('#fGpx', '/data/ultralink/demo-route.gpx');
  await esc.waitForFunction(() => /ROUTE LOCKED/.test(document.getElementById('fRouteInfo').textContent));
  // two checkpoints close together near 12.8 km and 13.4 km
  const box = await esc.locator('#setupProf').boundingBox();
  await esc.mouse.click(box.x + box.width * 0.335, box.y + 40);
  await esc.mouse.click(box.x + box.width * 0.352, box.y + 40);
  await esc.waitForTimeout(300);
  const secs = await esc.locator('#secList .secrow').count();
  check('clicking the profile adds checkpoints (3 sectors)', secs === 3, 'rows=' + secs);
  await esc.click('#fSecT'); await esc.waitForSelector('#dlgSecT[open]');
  await esc.click('#stFill'); await esc.waitForTimeout(150);
  const tot = await esc.textContent('#stTotal');
  check('sector target popup fills targets', /\d/.test(tot), tot);
  await esc.click('#stOk');
  await esc.fill('[data-rn="0"]', 'FALCON-1'); await esc.fill('[data-rn="1"]', 'VIPER-2');
  await esc.fill('#fTarget', '1:20:00');
  await esc.click('#dSave');
  await esc.waitForTimeout(400);
  await esc.screenshot({ path: 'shot-plan.png' });
  const stored = await esc.evaluate(() => JSON.parse(localStorage.ulProfiles || '[]').map(p => ({ n: p.name, s: p.sectors.length, r: p.route && p.route.pts.length, t: p.targetSec })));
  check('profile saved with route + sectors + target', stored.length === 1 && stored[0].s === 3 && stored[0].r > 100 && stored[0].t === 4800, JSON.stringify(stored));
  // create + delete a second profile
  await esc.click('#pNew'); await esc.waitForTimeout(300);
  check('second profile listed', (await esc.locator('.pitem').count()) === 2);
  await esc.click('.pitem.sel [data-del]'); await esc.waitForSelector('dialog[open] [data-y]'); await esc.click('dialog[open] [data-y]'); await esc.waitForTimeout(400);
  check('profile deleted', (await esc.locator('.pitem').count()) === 1);
  await esc.click('.pitem'); await esc.waitForSelector('#detPanel.open');
  check('clicking a profile opens the details panel with saved values', (await esc.inputValue('#fName')) === 'OP NORTHWIND' && (await esc.locator('#secList .secrow').count()) === 3);

  /* ---- activate ---- */
  const code = await esc.inputValue('#fCode');
  await esc.click('#dGo');
  await esc.waitForSelector('#shell', { state: 'visible', timeout: 8000 });
  await esc.waitForTimeout(1200);
  const cd = await esc.textContent('#mStart');
  check('departure countdown running in ops', /^T-/.test(cd), cd);

  /* ---- riders ---- */
  const mk = async (cs, off, spd) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('SIM-EX: ' + e.message));
    await p.goto(BASE + 'sim.html');
    await p.fill('#code', code); await p.fill('#cs', cs);
    await p.$eval('#off', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, String(off));
    await p.$eval('#spd', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, String(spd));
    await p.click('#go'); return p;
  };
  await mk('FALCON-1', 32, 58); await mk('VIPER-2', 20, 34);
  const rider = await ctx.newPage();
  rider.on('pageerror', e => errs.push('RIDER-EX: ' + e.message));
  rider.on('console', m => { if (m.type() === 'error') errs.push('RIDER: ' + m.text()); });
  await rider.setViewportSize({ width: 412, height: 915 });
  await rider.goto(BASE + 'rider.html');
  await rider.fill('#code', code); await rider.fill('#callsign', 'HAWK-3'); await rider.click('#go');
  await rider.waitForSelector('#app', { state: 'visible', timeout: 8000 });
  await esc.waitForTimeout(4500);
  const st = await esc.evaluate(() => ({
    cards: document.querySelectorAll('.ucard').length, gauges: document.querySelectorAll('.ucard .gauge').length,
    riderMk: document.querySelectorAll('.leaflet-marker-icon.mk svg polygon[points^="11,1"]').length,
    escMk: document.querySelectorAll('.leaflet-marker-icon.mk svg polygon[points^="2,3"]').length,
    icons: window.__ul.G.icons.length, units: window.__ul.units.size, windTag: document.getElementById('windTag').textContent,
    weather: !!document.getElementById('wx')
  }));
  check('unit cards with speed gauges rendered', st.cards >= 3 && st.gauges >= 3, JSON.stringify(st));
  check('rider = rhombus, escort = inverted triangle on map', st.riderMk >= 2 && st.escMk >= 1, `rhombus=${st.riderMk} tri=${st.escMk}`);
  check('all icons appear on the elevation graph', st.icons >= 3, 'icons=' + st.icons);
  check('weather widget removed, wind system online', !st.weather && /WIND/.test(st.windTag) && /MODEL/.test(st.windTag), st.windTag);

  /* ---- select rider: map + graph home in, pop-up with wind + drafting ---- */
  await esc.bringToFront();
  const before = await esc.evaluate(() => ({ z: window.__map.getZoom(), span: window.__ul.G.v1 - window.__ul.G.v0 }));
  await esc.evaluate(() => { const m = [...document.querySelectorAll('.leaflet-marker-icon.mk')].find(e => /FALCON-1/.test(e.innerText)); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await esc.waitForTimeout(1800);
  const after = await esc.evaluate(() => ({ z: window.__map.getZoom(), span: window.__ul.G.v1 - window.__ul.G.v0, zoomed: window.__ul.G.zoomed, sel: window.__ul.sel,
    pop: document.getElementById('riderPop').innerText.replace(/\n+/g, ' | ').slice(0, 700), popShown: document.getElementById('riderPop').classList.contains('in') }));
  check('map zoomed in on pressed rider', after.z >= 17 && after.z > before.z, `${before.z}→${after.z}`);
  check('graph homed in on pressed rider', after.zoomed && after.span < before.span * 0.5, `${Math.round(before.span)}m→${Math.round(after.span)}m`);
  check('pop-up shows wind speed/direction + drafting advice', after.popShown && /HITTING FROM/.test(after.pop) && /DRAFTING ADVICE/.test(after.pop) && /SHELTER/.test(after.pop), after.pop.slice(0, 260));
  await esc.screenshot({ path: 'shot-ops.png' });
  // click a graph icon (viper) → selection changes
  const target = await esc.evaluate(() => { const i = window.__ul.G.icons; const c = document.getElementById('graph').getBoundingClientRect(); return { n: i.length, ids: i.map(x => x.id), rect: { x: c.x, y: c.y } }; });
  await esc.waitForTimeout(300);
  const viper = await esc.evaluate(() => { const u = [...window.__ul.units.values()].find(u => u.callsign === 'VIPER-2'); return u && u.id; });
  await esc.evaluate(id => window.__ul.selectUnit(id), viper);
  await esc.waitForTimeout(1200);
  const g2 = await esc.evaluate(() => ({ sel: window.__ul.sel, span: window.__ul.G.v1 - window.__ul.G.v0 }));
  check('graph re-homes when another icon is pressed', g2.sel === viper && g2.span < 6000, JSON.stringify(g2));
  const hit = await esc.evaluate(() => { const i = window.__ul.G.icons.find(x => x.id !== window.__ul.sel); if (!i) return null; const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.x + i.x, y: r.y + i.y, id: i.id }; });
  if (hit) { await esc.mouse.click(hit.x, hit.y); await esc.waitForTimeout(500); check('clicking an icon ON the graph selects it', (await esc.evaluate(() => window.__ul.sel)) === hit.id); } else check('graph has a second icon in window', false);

  /* ---- PTT + sounds ---- */
  await esc.keyboard.down('1'); await esc.waitForTimeout(500);
  const tx = await esc.evaluate(() => document.getElementById('txbanner').textContent + '|' + getComputedStyle(document.getElementById('txbanner')).display);
  await esc.keyboard.up('1');
  check('PTT key opens TX banner', /TX/.test(tx) && /block/.test(tx), tx);
  const audio = await esc.evaluate(() => { try { UL.fx.pttOpen(); UL.fx.pttClose(); UL.fx.checkpoint(); UL.fx.sectorDone(); UL.fx.go(); return UL.fx.state.enabled; } catch (e) { return 'ERR ' + e.message; } });
  check('sound effects run without error', audio === true, String(audio));

  /* ---- scheduled auto start + sector timing (wait) ---- */
  await esc.waitForFunction(() => /RUNNING|\d/.test(document.getElementById('mClock').textContent) && document.getElementById('btnClock').textContent === 'STOP', null, { timeout: 60000 });
  check('mission clock auto-started at departure time', true);
  await esc.waitForFunction(() => { const u = [...window.__ul.units.values()].find(u => u.callsign === 'FALCON-1'); return u && u.data && u.data.covered > 12000; }, null, { timeout: 90000 }).catch(() => {});
  await esc.waitForTimeout(3000);
  const secState = await esc.evaluate(() => { const s = []; document.querySelectorAll('#log div').forEach(d => { if (/CP|SEC/.test(d.innerText)) s.push(d.innerText); }); return s; });
  check('checkpoint pass logged for a rider', secState.some(x => /passed/.test(x)), secState.slice(0, 2).join(' / '));
  await esc.waitForFunction(() => [...document.querySelectorAll('#log div')].some(d => /finished SECTOR/.test(d.innerText)), null, { timeout: 150000 }).catch(() => {});
  const fin = await esc.evaluate(() => [...document.querySelectorAll('#log div')].map(d => d.innerText).filter(t => /finished SECTOR/.test(t)));
  check('sector stopwatch stopped and time shown', fin.length > 0, fin[0]);
  await esc.click('#btnSectors'); await esc.waitForSelector('#dlgBoard[open]');
  const board = await esc.textContent('#dlgBoard');
  check('sector board lists rider sector times', /FALCON-1/.test(board) && /\d:\d\d/.test(board));
  await esc.screenshot({ path: 'shot-board.png' }); await esc.keyboard.press('Escape');
  await esc.click('#btnSettings'); await esc.click('[data-t="audio"]'); await esc.screenshot({ path: 'shot-settings.png' }); await esc.keyboard.press('Escape');
  await rider.screenshot({ path: 'shot-rider.png' });
  const rc = await rider.evaluate(() => document.getElementById('secChip').textContent + ' | ' + document.getElementById('rClock').textContent);
  check('rider phone shows sector + clock', /SECTOR|✓|CHECK|AWAIT/.test(rc), rc);

  /* ---- manual wind ---- */
  await esc.click('#btnWind'); await esc.fill('#wS', '30'); await esc.fill('#wD', '90'); await esc.click('#wApply'); await esc.waitForTimeout(700);
  check('manual wind override applied', /MANUAL/.test(await esc.textContent('#windTag')), await esc.textContent('#windTag'));

  /* ---- abort ---- */
  await esc.click('#btnAbort'); await esc.click('#abClose'); await esc.waitForTimeout(800);
  const ended = await rider.evaluate(() => document.getElementById('dlgEnd').open);
  check('close mission notifies rider', ended);

  const real = errs.filter(e => !/Failed to load resource|net::ERR|ERR_FAILED/.test(e));
  check('no console errors', real.length === 0, real.slice(0, 4).join(' || '));
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  await b.close(); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
