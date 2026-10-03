/* ULTRALINK end-to-end test (Playwright + Chromium, fake mic).
   node server.js   (in another terminal)   then   node test-e2e.js
   Covers: boot → earth-view planning → map checkpoints / designations / sector card + notes → auto sector targets → lead rider →
   activate → riders → lead follow-up / return-to-rider → ops sector card → off-route master alert → PTT voice (P2P + relay) → sectors → close */
const path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/vercel/sandbox/node_modules/playwright'); }
const { chromium } = pw;
const BASE = process.env.UL_BASE || 'http://127.0.0.1:8080/';
const GPX = path.join(__dirname, 'demo-route.gpx');
const EXE = process.env.CHROMIUM || (require('fs').existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ok = [], bad = [];
const check = (n, c, extra) => { (c ? ok : bad).push(n); console.log((c ? '  PASS  ' : '  FAIL  ') + n + (extra ? ' [' + String(extra).slice(0, 300) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const mkCtx = async (vp) => {
    const ctx = await b.newContext({ viewport: vp || { width: 1600, height: 950 }, permissions: ['geolocation', 'microphone'], geolocation: { latitude: -20.3484, longitude: 57.5522 } });
    await ctx.route(u => !/127\.0\.0\.1/.test(u.hostname), r => {
      const u = r.request().url();
      if (/open-meteo/.test(u)) { const n = (new URL(u).searchParams.get('latitude') || '0').split(',').length; return r.fulfill({ json: Array.from({ length: n }, () => ({ current: { wind_speed_10m: 7, wind_direction_10m: 60, wind_gusts_10m: 11 } })) }); }
      if (/\.(png|jpg|jpeg)|tile|MapServer|basemaps/.test(u)) return r.fulfill({ body: PNG, contentType: 'image/png' });
      return r.abort();
    });
    return ctx;
  };
  const ctx = await mkCtx();
  const errs = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errs.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errs.push(tag + '-EX: ' + e.message)); };
  const esc = await ctx.newPage(); watch(esc, 'ESCORT');
  await esc.goto(BASE + 'escort.html');

  /* ---------------- boot (escort only, short) ---------------- */
  await sleep(500);
  const bootTxt = await esc.evaluate(() => document.getElementById('boot')?.innerText.replace(/\n+/g, ' | ').slice(0, 400));
  check('escort boot: simple loader with checklist', /ULTRALINK/.test(bootTxt || '') && /SATELLITE|CORE/.test(bootTxt || ''), bootTxt);
  const t0 = Date.now();
  await esc.waitForSelector('#home', { state: 'visible', timeout: 20000 });
  await esc.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 10000 });
  check('boot finishes quickly (< 8 s)', Date.now() - t0 < 8000, (Date.now() - t0) + ' ms');
  await sleep(1200);
  await esc.evaluate(() => document.getElementById('dlgHelp').open && document.getElementById('dlgHelp').close());

  /* ---------------- earth view, no own location ---------------- */
  const hs = await esc.evaluate(() => ({ z: window.__hmap.getZoom(), markers: document.querySelectorAll('#homeMap .leaflet-marker-icon:not(.mpin)').length, gps: !!document.getElementById('hGps'), list: document.getElementById('profList').innerText.slice(0, 60) }));
  check('planning opens on the earth view, no escort position shown', hs.z <= 3 && hs.markers === 0 && !hs.gps, JSON.stringify(hs));
  await esc.screenshot({ path: 'shot-home.png' });

  /* ---------------- create profile ---------------- */
  await esc.click('#pNew'); await esc.waitForSelector('#detPanel.open');
  await esc.fill('#fName', 'OP NORTHWIND'); await esc.fill('#fEsc', 'ESCORT-1');
  const soon = new Date(Date.now() + 80000); const pad = n => String(n).padStart(2, '0');
  await esc.fill('#fDate', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
  await esc.fill('#fTime', `${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  await esc.setInputFiles('#fGpx', GPX);
  await esc.waitForFunction(() => /ROUTE LOCKED/.test(document.getElementById('fRouteInfo').textContent));
  await sleep(4500);
  const zr = await esc.evaluate(() => window.__hmap.getZoom());
  check('importing the GPX flies down to the route', zr >= 9, 'zoom ' + zr);

  /* click a route point for real: pan it to the free middle of the map, then click */
  const routePt = async frac => esc.evaluate(f => { const B = UL.Plan._debug.built, d = B.distance * f, p = UL.routeAt(B, d); return [p.lat, p.lon]; }, frac);
  const clickLatLng = async (page, mapVar, ll) => {
    const xy = await page.evaluate(([mv, ll]) => {
      const m = window[mv]; m.panTo(ll, { animate: false });
      const r = m.getContainer().getBoundingClientRect(), p = m.latLngToContainerPoint(ll);
      return { x: r.left + p.x, y: r.top + p.y };
    }, [mapVar, ll]);
    await sleep(250); await page.mouse.move(xy.x + 3, xy.y + 3); await page.mouse.move(xy.x, xy.y); await sleep(80); await page.mouse.click(xy.x, xy.y); await sleep(350);
  };
  await esc.click('#tAdd');
  await clickLatLng(esc, '__hmap', await routePt(0.335));
  await clickLatLng(esc, '__hmap', await routePt(0.36));
  const secs = await esc.locator('#secList .secrow').count();
  const dots = await esc.locator('#homeMap .cpdot').count();
  check('checkpoints added by clicking the route on the map (3 sectors)', secs === 3, 'rows=' + secs);
  check('checkpoints drawn as small dots (start, 2 CPs, finish)', dots >= 4, 'dots=' + dots);

  /* designation */
  await esc.click('#tSel');
  await esc.evaluate(() => { const d = [...document.querySelectorAll('#homeMap .cpdot')].find(e => /CP1/.test(e.innerText)); d.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await esc.waitForSelector('.cppop input', { timeout: 3000 });
  await esc.fill('.cppop input', 'feed zone'); await esc.click('.cppop [data-ok]'); await sleep(300);
  const cpName = await esc.evaluate(() => ({ cp: UL.Plan._debug.cur.sectors[1].cp, lbl: [...document.querySelectorAll('#homeMap .cpdot')].map(e => e.innerText).join(',') }));
  check('checkpoint designation assigned from the dot', cpName.cp === 'FEED ZONE' && /FEED ZONE/.test(cpName.lbl), JSON.stringify(cpName));

  /* sector card from a map click */
  const zBefore = await esc.evaluate(() => window.__hmap.getZoom());
  await clickLatLng(esc, '__hmap', await routePt(0.6));
  await sleep(1800);
  const card = await esc.evaluate(() => ({ in: document.getElementById('pSecCard').classList.contains('in'), cv: !!document.querySelector('#pSecCard canvas'), txt: document.getElementById('pSecCard').innerText.slice(0, 200), idx: UL.Plan._debug.secIdx, z: window.__hmap.getZoom() }));
  check('clicking a sector opens the gradient/elevation card and zooms to it', card.in && card.cv && card.idx === 2 && /GRADE|GAIN|ELEV/i.test(card.txt), JSON.stringify(card) + ' z0=' + zBefore);
  await esc.fill('#pSecCard .sc-notes', 'Climb to the radar — keep the lead car 50 m back.'); await sleep(200);
  const notes = await esc.evaluate(() => UL.Plan._debug.cur.sectors[2].notes);
  check('escort notes saved on the sector', /radar/.test(notes || ''), notes);
  await esc.screenshot({ path: 'shot-plan-card.png' });

  /* auto sector targets */
  await esc.fill('#fTarget', '1:20:00');
  await esc.check('#fAutoT'); await sleep(300);
  const auto = await esc.evaluate(() => UL.Plan._debug.cur.sectors.map(s => s.target));
  const sum = auto.reduce((a, x) => a + (x || 0), 0);
  check('sector targets auto-calculated from the overall target', auto.every(x => x > 0) && Math.abs(sum - 4800) <= 1, JSON.stringify(auto) + ' sum=' + sum);
  await esc.click('#fSecT'); await esc.waitForSelector('#dlgSecT[open]');
  const stTot = await esc.textContent('#stTotal');
  check('sector target dialog shows the totals', /1:20:00/.test(stTot), stTot);
  await esc.click('#stOk');

  /* riders + lead */
  await esc.fill('[data-rn="0"]', 'FALCON-1'); await esc.fill('[data-rn="1"]', 'VIPER-2');
  await esc.selectOption('#fLead', 'FALCON-1');
  await esc.click('#dSave'); await sleep(400);
  await esc.screenshot({ path: 'shot-plan.png' });
  const stored = await esc.evaluate(() => JSON.parse(localStorage.ulProfiles || '[]').map(p => ({ n: p.name, s: p.sectors.length, cp: p.sectors[1].cp, notes: !!p.sectors[2].notes, t: p.targetSec, lead: p.lead, auto: p.autoT })));
  check('profile saved with checkpoints, notes, auto targets, lead', stored.length === 1 && stored[0].s === 3 && stored[0].cp === 'FEED ZONE' && stored[0].notes && stored[0].t === 4800 && stored[0].lead === 'FALCON-1' && stored[0].auto, JSON.stringify(stored));

  /* close → back to earth, pick → fly in */
  await esc.click('#dClose'); await sleep(2800);
  const ze = await esc.evaluate(() => ({ z: window.__hmap.getZoom(), pins: document.querySelectorAll('#homeMap .mpin').length }));
  check('closing a profile returns to the earth view with mission pins', ze.z <= 4 && ze.pins === 1, JSON.stringify(ze));
  await esc.click('.pitem'); await esc.waitForSelector('#detPanel.open'); await sleep(4200);
  const zi = await esc.evaluate(() => window.__hmap.getZoom());
  check('selecting a mission zooms from the globe to its route', zi >= 9, 'zoom ' + zi);

  /* ---------------- activate ---------------- */
  const code = await esc.inputValue('#fCode');
  await esc.click('#dGo');
  await esc.waitForSelector('#shell', { state: 'visible', timeout: 8000 });
  await sleep(1200);
  check('departure countdown running in ops', /^T-/.test(await esc.textContent('#mStart')));
  const opsDots = await esc.locator('#map .cpdot').count();
  check('ops map shows checkpoints as dots', opsDots >= 4, 'dots=' + opsDots);

  /* ---------------- riders ---------------- */
  const mk = async (cs, off, spd, dev) => {
    const p = await ctx.newPage(); watch(p, 'SIM');
    await p.goto(BASE + 'sim.html');
    await p.fill('#code', code); await p.fill('#cs', cs);
    await p.$eval('#off', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, String(off));
    await p.$eval('#spd', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, String(spd));
    if (dev) await p.check('#dev');
    await p.click('#go'); return p;
  };
  await mk('FALCON-1', 32, 58); await mk('VIPER-2', 20, 34);
  const rider = await ctx.newPage(); watch(rider, 'RIDER');
  await rider.setViewportSize({ width: 412, height: 915 });
  await rider.goto(BASE + 'rider.html');
  await rider.fill('#code', code); await rider.fill('#callsign', 'HAWK-3'); await rider.click('#go');
  await rider.waitForSelector('#app', { state: 'visible', timeout: 8000 });
  await sleep(4500);
  await esc.bringToFront(); await esc.click('#gFull'); await sleep(1600);
  const st = await esc.evaluate(() => ({
    cards: document.querySelectorAll('.ucard').length, gauges: document.querySelectorAll('.ucard .gauge').length,
    riderMk: document.querySelectorAll('.leaflet-marker-icon.mk svg polygon[points^="11,1"]').length,
    escMk: document.querySelectorAll('.leaflet-marker-icon.mk svg polygon[points^="2,3"]').length,
    icons: window.__ul.G.icons.length, windTag: document.getElementById('windTag').textContent
  }));
  check('unit cards with speed gauges rendered', st.cards >= 4 && st.gauges >= 4, JSON.stringify(st));
  check('rider = rhombus, escort = inverted triangle on map', st.riderMk >= 2 && st.escMk >= 1, `rhombus=${st.riderMk} tri=${st.escMk}`);
  check('all icons appear on the elevation graph', st.icons >= 3, 'icons=' + st.icons + ' ' + (await esc.evaluate(() => JSON.stringify([...window.__ul.units.values()].map(u => [u.callsign, u.data && u.data.covered, u.data && Math.round(u.data.offRoute)])) + ' G=' + window.__ul.G.zoomed + ' ' + Math.round(window.__ul.G.v0) + '-' + Math.round(window.__ul.G.v1))));
  check('wind system online', /WIND/.test(st.windTag) && /MODEL/.test(st.windTag), st.windTag);

  /* ---------------- lead rider ---------------- */
  const ids = await esc.evaluate(() => Object.fromEntries([...window.__ul.units.values()].map(u => [u.callsign, u.id])));
  const lead = await esc.evaluate(() => ({ lead: window.__ul.lead, sel: window.__ul.sel, first: document.querySelector('#units .ucard:nth-child(2) .cs')?.textContent, star: !!document.querySelector('.ucard.leadcard .lead.on'), z: window.__map.getZoom() }));
  check('lead rider (from profile) is the main follow-up: selected, followed, first card', lead.lead === 'FALCON-1' && lead.sel === ids['FALCON-1'] && /FALCON-1/.test(lead.first || '') && lead.star && lead.z >= 15, JSON.stringify(lead));

  /* ---------------- select rider: map + graph home in + pop-up ---------------- */
  await esc.evaluate(id => window.__ul.selectUnit(id), ids['VIPER-2']); await sleep(400);
  const before = await esc.evaluate(() => ({ span: window.__ul.G.v1 - window.__ul.G.v0 }));
  await esc.evaluate(() => { const m = [...document.querySelectorAll('.leaflet-marker-icon.mk')].find(e => /FALCON-1/.test(e.innerText)); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await sleep(1800);
  const after = await esc.evaluate(() => ({ z: window.__map.getZoom(), span: window.__ul.G.v1 - window.__ul.G.v0, zoomed: window.__ul.G.zoomed, sel: window.__ul.sel,
    pop: document.getElementById('riderPop').innerText.replace(/\n+/g, ' | ').slice(0, 700), popShown: document.getElementById('riderPop').classList.contains('in') }));
  check('map zoomed in on pressed rider', after.z >= 17 && after.sel === ids['FALCON-1'], 'z=' + after.z);
  check('pop-up shows wind + drafting advice + lead/return buttons', after.popShown && /HITTING FROM/.test(after.pop) && /DRAFTING ADVICE/.test(after.pop) && /LEAD RIDER/.test(after.pop) && /RETURN TO RIDER/.test(after.pop), after.pop.slice(0, 200));
  await esc.screenshot({ path: 'shot-ops.png' });
  const hit = await esc.evaluate(() => { const i = window.__ul.G.icons.find(x => x.id !== window.__ul.sel); if (!i) return null; const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.x + i.x, y: r.y + i.y, id: i.id }; });
  if (hit) { await esc.mouse.click(hit.x, hit.y); await sleep(500); check('clicking an icon ON the graph selects it', (await esc.evaluate(() => window.__ul.sel)) === hit.id); }

  /* ---------------- return to rider ---------------- */
  await esc.evaluate(() => { window.__map.setView([-20.0, 57.2], 10, { animate: false }); }); await esc.click('#btnFollow'); await sleep(1200);
  const rb = await esc.evaluate(() => ({ show: document.getElementById('btnReturn').classList.contains('show'), txt: document.getElementById('btnReturn').textContent, follow: window.__ul.follow }));
  check('RETURN TO RIDER button appears when looking elsewhere', rb.show && /FALCON-1/.test(rb.txt), JSON.stringify(rb));
  await esc.click('#btnReturn'); await sleep(1800);
  const rt = await esc.evaluate(id => { const u = window.__ul.units.get(id), c = window.__map.getCenter(); return { sel: window.__ul.sel, follow: window.__ul.follow, dist: Math.round(window.__map.distance(c, [u.data.lat, u.data.lon])), z: window.__map.getZoom() }; }, ids['FALCON-1']);
  check('return homes the map onto the lead rider and follows', rt.sel === ids['FALCON-1'] && rt.follow && rt.dist < 250 && rt.z >= 15, JSON.stringify(rt));
  await esc.evaluate(() => window.__map.setView([-20.0, 57.2], 10, { animate: false })); await esc.keyboard.press('r'); await sleep(1600);
  const rk = await esc.evaluate(id => { const u = window.__ul.units.get(id); return Math.round(window.__map.distance(window.__map.getCenter(), [u.data.lat, u.data.lon])); }, ids['FALCON-1']);
  check('R key returns to the lead rider', rk < 250, rk + ' m');

  /* ---------------- sector card on the ops map ---------------- */
  const opsCard = await (async () => {
    if (await esc.evaluate(() => window.__ul.follow)) await esc.click('#btnFollow');
    const pt = await esc.evaluate(() => { const r = window.__ul.route; const s = window.__ul.sectors[2]; const p = UL.routeAt(r, (s.start + s.end) / 2 + 700); return [p.lat, p.lon]; });
    await clickLatLng(esc, '__map', pt); await sleep(1700);
    return esc.evaluate(() => ({ in: document.getElementById('opsSecCard').classList.contains('in'), idx: window.__ul.opsSec, txt: document.getElementById('opsSecCard').innerText.slice(0, 400), cv: !!document.querySelector('#opsSecCard canvas'), follow: window.__ul.follow }));
  })();
  check('clicking a sector on the ops map zooms to it and opens its card with profile + notes', opsCard.in && opsCard.idx === 2 && opsCard.cv && /radar/.test(opsCard.txt) && !opsCard.follow, JSON.stringify(opsCard).slice(0, 260));
  await esc.screenshot({ path: 'shot-ops-sector.png' });
  await esc.keyboard.press('Escape'); await sleep(300);

  /* ---------------- overlays + checkpoint toggle ---------------- */
  await esc.click('#mapopts [data-ov="overlayRoads"]'); await esc.click('#mapopts [data-ov="overlayPlaces"]'); await sleep(1200);
  const ov = await esc.evaluate(() => ({ tiles: (() => { let n = 0; window.__map.eachLayer(l => { if (l.options && l.options.pane === 'refPane' && /World_Transportation|World_Boundaries/.test(l._url || '')) n++; }); return n; })(),
    pane: !!window.__map.getPane('refPane'), on: [...document.querySelectorAll('#mapopts [data-ov].on')].map(b => b.dataset.ov) }));
  check('roads + place-name overlays can be switched on', ov.pane && ov.tiles > 0 && ov.on.includes('overlayRoads') && ov.on.includes('overlayPlaces'), JSON.stringify(ov));
  await esc.click('#mapopts [data-ov="showCps"]'); await sleep(300);
  const cpHidden = await esc.evaluate(() => [...document.querySelectorAll('#map .cpdot')].every(e => getComputedStyle(e).display === 'none'));
  await esc.click('#mapopts [data-ov="showCps"]'); await sleep(300);
  const cpShown = await esc.evaluate(() => [...document.querySelectorAll('#map .cpdot')].some(e => getComputedStyle(e).display !== 'none'));
  check('checkpoint dots can be hidden and shown', cpHidden && cpShown);
  await esc.click('#mapopts [data-ov="overlayRoads"]'); await esc.click('#mapopts [data-ov="overlayPlaces"]');
  check('rider phone has no off-route alert', await rider.evaluate(() => !document.getElementById('offBar') && !/OFF ROUTE/.test(document.body.innerText)));

  /* ---------------- off-route master alert ---------------- */
  const ghost = await mk('GHOST-9', 50, 30, true);
  await esc.bringToFront();
  await esc.waitForFunction(() => document.getElementById('offAlert').classList.contains('show'), null, { timeout: 12000 }).catch(() => {});
  const oa = await esc.evaluate(() => ({ show: document.getElementById('offAlert').classList.contains('show'), txt: document.getElementById('offAlert').innerText, card: !!document.querySelector('.ucard.off') }));
  check('rider off route → red alert widget centre-top', oa.show && /GHOST-9/.test(oa.txt) && /OFF/.test(oa.txt) && oa.card, JSON.stringify(oa));
  await esc.screenshot({ path: 'shot-offroute.png' });
  await sleep(3000);
  check('alert stays up while the rider is still off course', await esc.evaluate(() => document.getElementById('offAlert').classList.contains('show')));
  await esc.click('#btnMaster'); await sleep(2500);
  const acked = await esc.evaluate(() => ({ show: document.getElementById('offAlert').classList.contains('show'), still: [...window.__ul.alerts.values()].some(s => s.on) }));
  check('MASTER ALERT acknowledges and hides the widget (rider still flagged)', !acked.show && acked.still, JSON.stringify(acked));
  await ghost.uncheck('#dev'); await sleep(4000);
  const back = await esc.evaluate(() => [...window.__ul.alerts.values()].every(s => !s.on));
  check('alert clears by itself when the rider is back on course', back);
  await ghost.check('#dev');
  await esc.waitForFunction(() => document.getElementById('offAlert').classList.contains('show'), null, { timeout: 12000 }).catch(() => {});
  check('a new deviation raises the alert again', await esc.evaluate(() => document.getElementById('offAlert').classList.contains('show')));
  await ghost.uncheck('#dev');
  await esc.waitForFunction(() => !document.getElementById('offAlert').classList.contains('show'), null, { timeout: 12000 }).catch(() => {});
  check('…and it disappears when back on course (no button press)', !(await esc.evaluate(() => document.getElementById('offAlert').classList.contains('show'))));

  /* ---------------- PTT voice: P2P + relay, targeting ---------------- */
  const ctx2 = await mkCtx({ width: 1280, height: 800 });
  await ctx2.addInitScript(() => { try { localStorage.ulVoice = 'relay'; } catch (e) {} });
  const esc2 = await ctx2.newPage(); watch(esc2, 'ESCORT2');
  await esc2.goto(BASE + 'escort.html?noboot=1');
  await esc2.waitForSelector('#home', { state: 'visible' }); await sleep(2500); await esc2.evaluate(() => document.getElementById('dlgHelp').open && document.getElementById('dlgHelp').close());
  await esc2.click('#pJoin'); await esc2.fill('#jcode', code); await esc2.fill('#jcall', 'ESCORT-2'); await esc2.click('#jgo');
  await esc2.waitForSelector('#shell', { state: 'visible', timeout: 8000 });
  await sleep(6000);
  const escId = await esc.evaluate(() => window.__ul.me), riderId = await rider.evaluate(() => window.__rider.me), esc2Id = await esc2.evaluate(() => window.__ul.me);
  const bytesFrom = (page, hook, from) => page.evaluate(async ([hook, from]) => {
    const v = hook === 'rider' ? window.__rider.voice : window.__ul.voice, p = v.peers.get(from); if (!p) return -1;
    const s = await p.rtc.getStats(); let n = 0; s.forEach(r => { if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) n += r.bytesReceived || 0; }); return n;
  }, [hook, from]);
  const relayRx = page => page.evaluate(() => window.__ul.voice.stats.relayRx);
  const vs = await esc.evaluate(() => window.__ul.voice.summary());
  const vr = await rider.evaluate(() => { const v = window.__rider.voice; return v.summary(); });
  check('voice: escort ⇄ rider direct P2P link up, relay-only escort uses the relay', vs.p2p >= 1 && vr.p2p >= 1, JSON.stringify({ vs, vr }));

  // escort-1 → ALL with the on-screen PTT button
  let r0 = await bytesFrom(rider, 'rider', escId), e20 = await relayRx(esc2);
  const pb = await esc.locator('#pttBtn').boundingBox();
  await esc.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await esc.mouse.down(); await sleep(2500);
  const onAir = await esc.evaluate(() => document.getElementById('pttBtn').classList.contains('on'));
  await esc.mouse.up(); await sleep(800);
  let r1 = await bytesFrom(rider, 'rider', escId), e21 = await relayRx(esc2);
  check('PTT to ALL: voice reaches the rider (P2P audio bytes flowing)', onAir && r1 - r0 > 4000, `rider +${r1 - r0} B`);
  check('PTT to ALL: voice reaches the relay-only escort (relay audio)', e21 - e20 > 4000, `escort-2 +${e21 - e20} B`);
  await sleep(1500);
  // escort-1 → HAWK-3 only (unit slot key)
  const slot = await esc.evaluate(id => { const k = [...document.querySelectorAll('.ucard')].find(c => c.dataset.id === id)?.querySelector('.ptt')?.textContent; return k; }, riderId);
  const key = (slot || '').replace('PTT ', '').trim();
  r0 = await bytesFrom(rider, 'rider', escId); e20 = await relayRx(esc2);
  await esc.keyboard.down(key); await sleep(2500); await esc.keyboard.up(key); await sleep(800);
  r1 = await bytesFrom(rider, 'rider', escId); e21 = await relayRx(esc2);
  check('targeted PTT (unit key ' + key + '): only the selected rider hears it', r1 - r0 > 4000 && e21 - e20 === 0, `rider +${r1 - r0} B · escort-2 +${e21 - e20} B`);
  await sleep(1500);
  // rider → all (hold the big PTT)
  let a0 = await bytesFrom(esc, 'escort', riderId); e20 = await relayRx(esc2);
  const rb2 = await rider.locator('#ptt').boundingBox();
  await rider.mouse.move(rb2.x + rb2.width / 2, rb2.y + rb2.height / 2); await rider.mouse.down(); await sleep(2500);
  const banner = await esc.evaluate(() => document.getElementById('txbanner').textContent);
  await rider.mouse.up(); await sleep(800);
  let a1 = await bytesFrom(esc, 'escort', riderId); e21 = await relayRx(esc2);
  check('rider PTT reaches escort-1 (P2P) and escort-2 (relay), banner shown', a1 - a0 > 4000 && e21 - e20 > 4000 && /HAWK-3/.test(banner), `esc1 +${a1 - a0} B · esc2 +${e21 - e20} B · ${banner}`);
  const vchip = await rider.textContent('#vmode');
  check('rider shows the voice path chip', /VOICE (P2P|RELAY)/.test(vchip), vchip);

  /* ---------------- scheduled start + sector timing ---------------- */
  await esc.waitForFunction(() => document.getElementById('btnClock').textContent === 'STOP', null, { timeout: 90000 }).catch(() => {});
  check('mission clock auto-started at departure time', (await esc.textContent('#btnClock')) === 'STOP');
  await esc.waitForFunction(() => [...document.querySelectorAll('#log div')].some(d => /passed/.test(d.innerText)), null, { timeout: 60000 }).catch(() => {});
  check('checkpoint pass logged for a rider (with designation)', await esc.evaluate(() => [...document.querySelectorAll('#log div')].some(d => /passed/.test(d.innerText))));
  await esc.waitForFunction(() => [...document.querySelectorAll('#log div')].some(d => /finished/.test(d.innerText)), null, { timeout: 150000 }).catch(() => {});
  const fin = await esc.evaluate(() => [...document.querySelectorAll('#log div')].map(d => d.innerText).filter(t => /finished/.test(t)));
  check('sector stopwatch stopped and time shown', fin.length > 0, fin[0]);
  await esc.click('#btnSectors'); await esc.waitForSelector('#dlgBoard[open]');
  const board = await esc.textContent('#dlgBoard');
  check('sector board lists rider sector times', /FALCON-1/.test(board) && /\d:\d\d/.test(board));
  await esc.screenshot({ path: 'shot-board.png' }); await esc.keyboard.press('Escape');
  await esc.click('#btnSettings'); await esc.click('[data-t="audio"]'); await sleep(200);
  const au = await esc.textContent('#setBody');
  check('audio settings: interface sounds off by default + voice path', /Interface sounds/.test(au) && /VOICE PATH/.test(au) && !(await esc.isChecked('[data-s="uiSounds"]')), '');
  await esc.screenshot({ path: 'shot-settings.png' }); await esc.keyboard.press('Escape');
  await rider.screenshot({ path: 'shot-rider.png' });
  const rc = await rider.evaluate(() => document.getElementById('secChip').textContent + ' | ' + document.getElementById('rClock').textContent);
  check('rider phone shows sector + clock', /SECTOR|✓|CHECK|AWAIT|FEED|\d/.test(rc), rc);

  /* ---------------- mobile layout ---------------- */
  const mob = await ctx.newPage(); watch(mob, 'MOBILE-ESC');
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(BASE + 'escort.html?noboot=1'); await mob.waitForSelector('#home', { state: 'visible' }); await sleep(2500);
  await mob.evaluate(() => document.getElementById('dlgHelp').open && document.getElementById('dlgHelp').close());
  const ml = await mob.evaluate(() => { const p = document.getElementById('profPanel').getBoundingClientRect(); return { w: Math.round(p.width), fits: p.right <= innerWidth + 1 }; });
  check('escort planning fits a phone screen', ml.fits && ml.w > 300, JSON.stringify(ml));
  await mob.screenshot({ path: 'shot-mobile-home.png' }); await mob.close();

  /* ---------------- manual wind + close ---------------- */
  await esc.click('#btnWind'); await esc.fill('#wS', '30'); await esc.fill('#wD', '90'); await esc.click('#wApply'); await sleep(700);
  check('manual wind override applied', /MANUAL/.test(await esc.textContent('#windTag')));
  await esc.click('#btnAbort'); await esc.click('#abClose'); await sleep(900);
  check('close mission notifies rider + second escort', await rider.evaluate(() => document.getElementById('dlgEnd').open) && await esc2.evaluate(() => document.getElementById('dlgEnded').open));

  const real = errs.filter(e => !/Failed to load resource|net::ERR|ERR_FAILED/.test(e));
  check('no console errors', real.length === 0, real.slice(0, 5).join(' || '));
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (bad.length) console.log('FAILED:\n - ' + bad.join('\n - '));
  await b.close(); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
