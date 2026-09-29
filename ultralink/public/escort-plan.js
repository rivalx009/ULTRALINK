/* ULTRALINK — ESCORT home: live-location map + mission profile manager (save / delete / schedule / sectors) */
(() => {
  const $ = id => document.getElementById(id);
  const cfg = UL.cfg = new UL.Settings(); cfg.apply();
  const fx = UL.fx, esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ------------------------------------------------ shared map helpers */
  UL.LAYERS = {
    'SAT': () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }),
    'DARK': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: 'CARTO · OSM' }),
    'VECTOR': () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'OSM' }),
    'TERRAIN': () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }),
    'RELIEF': () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' })
  };
  UL.makeGrid = () => {
    const g = L.gridLayer({ className: 'ul-grid' });
    g.createTile = function (coords) {
      const t = document.createElement('canvas'); t.width = t.height = 256;
      const x = t.getContext('2d');
      x.strokeStyle = 'rgba(0,229,255,.16)'; x.lineWidth = 1; x.strokeRect(.5, .5, 255, 255);
      x.strokeStyle = 'rgba(0,229,255,.07)';
      for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
      x.fillStyle = 'rgba(0,229,255,.32)'; x.font = '9px monospace'; x.fillText(coords.z + '/' + coords.x + '/' + coords.y, 5, 13);
      return t;
    };
    return g;
  };
  /** map icons: rider = rhombus, escort = inverted triangle */
  UL.unitSvg = (role, c, heading, size) => {
    size = size || 22;
    const tick = `<line x1="11" y1="11" x2="11" y2="-1" stroke="${c}" stroke-width="1.6" transform="rotate(${heading || 0} 11 11)" opacity=".9"/>`;
    return role === 'rider'
      ? `<svg width="${size}" height="${size}" viewBox="-2 -2 26 26" style="overflow:visible">${tick}<polygon points="11,1 19,11 11,21 3,11" fill="${c}" stroke="#03090c" stroke-width="1.3"/></svg>`
      : `<svg width="${size}" height="${size}" viewBox="-2 -2 26 26" style="overflow:visible">${tick}<polygon points="2,3 20,3 11,20" fill="${c}" stroke="#03090c" stroke-width="1.3"/></svg>`;
  };

  /* ------------------------------------------------------- persistence */
  const KEY = 'ulProfiles';
  let profiles = [];
  try { profiles = JSON.parse(localStorage[KEY] || '[]'); } catch (e) { profiles = []; }
  const persist = () => { try { localStorage[KEY] = JSON.stringify(profiles); return true; } catch (e) { UL.toast('STORAGE FULL — export your profiles', 'bad'); return false; } };
  const code6 = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = n => String(n).padStart(2, '0');

  function startMs(p) {
    if (!p || !p.date || !p.time) return null;
    const t = new Date(p.date + 'T' + p.time).getTime();
    return isFinite(t) ? t : null;
  }
  function cdInfo(p) {
    const t = startMs(p); if (t == null) return { t: 'NO DATE', c: 'past' };
    let s = Math.floor((t - Date.now()) / 1000);
    if (s < 0) return { t: 'PAST', c: 'past' };
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return { t: 'T-' + (d ? d + 'd ' : '') + pad(h) + ':' + pad(m) + ':' + pad(x), c: (t - Date.now()) < 3600e3 ? 'soon' : '' };
  }

  /* --------------------------------------------------------- home map */
  let hmap = null, hLayer = null, hGrid = null, hSelf = null, hAcc = null, routeGroup = null, hFirstFix = false, watchId = null, lastPos = null;
  const selfIcon = () => L.divIcon({ className: 'mk', iconSize: [22, 22], iconAnchor: [11, 11],
    html: `<div style="color:${cfg.v.accent}">${UL.unitSvg('escort', cfg.v.accent, 0)}<span class="lbl">YOU · CURRENT POSITION</span></div>` });

  function initHomeMap() {
    hmap = L.map('homeMap', { zoomControl: false, attributionControl: true, preferCanvas: true });
    L.control.zoom({ position: 'bottomright' }).addTo(hmap);
    setHomeLayer(cfg.v.mapLayer || 'SAT');
    hGrid = UL.makeGrid().addTo(hmap); hGrid.setOpacity(cfg.v.gridOverlay ? 1 : 0);
    const gp = UL.bootState && UL.bootState.gps;
    let last = null; try { last = JSON.parse(localStorage.ulLastPos || 'null'); } catch (e) {}
    const c = gp || last || { lat: -20.3484, lon: 57.5522 };
    hmap.setView([c.lat, c.lon], gp ? 15 : 12);
    if (gp) { hFirstFix = true; placeSelf(gp.lat, gp.lon, gp.acc); }
    $('hLayers').innerHTML = '<div style="margin-bottom:5px">MAP LAYER</div>' + Object.keys(UL.LAYERS).map(k => `<button data-l="${k}">${k}</button>`).join('') +
      '<div style="margin:6px 0 4px">VIEW</div><button id="hLocate">⌖ MY POSITION</button><button id="hFitRoute">⤢ FIT ROUTE</button>';
    $('hLayers').querySelectorAll('[data-l]').forEach(b => b.onclick = () => setHomeLayer(b.dataset.l));
    $('hLocate').onclick = () => { if (lastPos) hmap.flyTo([lastPos.lat, lastPos.lon], 16, { duration: .8 }); else UL.toast('NO GPS FIX YET', 'warn'); };
    $('hFitRoute').onclick = () => fitRoute();
    if (navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => {
      const c = p.coords; lastPos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy };
      try { localStorage.ulLastPos = JSON.stringify(lastPos); } catch (e) {}
      placeSelf(c.latitude, c.longitude, c.accuracy);
      $('hGps').textContent = 'GPS ±' + Math.round(c.accuracy) + 'm'; $('hGps').className = 'tag ' + (c.accuracy < 30 ? 'ok' : '');
      if (!hFirstFix && !routeGroup) { hFirstFix = true; hmap.flyTo([c.latitude, c.longitude], 15, { duration: 1 }); }
    }, () => { $('hGps').textContent = 'GPS DENIED'; $('hGps').className = 'tag bad'; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function setHomeLayer(k) {
    if (hLayer) hmap.removeLayer(hLayer);
    hLayer = UL.LAYERS[k]().addTo(hmap); hLayer.setZIndex(0);
    cfg.set('mapLayer', k);
    $('hLayers') && $('hLayers').querySelectorAll('[data-l]').forEach(b => b.classList.toggle('on', b.dataset.l === k));
  }
  function placeSelf(lat, lon, acc) {
    if (!hSelf) { hSelf = L.marker([lat, lon], { icon: selfIcon(), zIndexOffset: 900 }).addTo(hmap); hAcc = L.circle([lat, lon], { radius: acc || 20, color: cfg.v.accent, weight: 1, fillOpacity: .06 }).addTo(hmap); }
    else { hSelf.setLatLng([lat, lon]); hAcc.setLatLng([lat, lon]).setRadius(acc || 20); }
  }

  /* --------------------------------------------------- profile list UI */
  let curId = null, cur = null, built = null, origJson = '';

  function renderList() {
    $('pCount').textContent = profiles.length;
    if (!profiles.length) {
      $('profList').innerHTML = `<div class="hint" style="padding:10px 4px;line-height:1.8">No mission profiles yet.<br>Press <b style="color:var(--accent)">＋ NEW MISSION PROFILE</b> to plan a race: import the GPX, set the date and departure time, split the route into sectors and assign rider codenames. Everything is saved on this laptop.</div>`;
      return;
    }
    const sorted = profiles.slice().sort((a, b) => (startMs(a) || 9e15) - (startMs(b) || 9e15));
    $('profList').innerHTML = sorted.map(p => {
      const c = cdInfo(p), km = p.route ? (p.route.distance / 1000).toFixed(1) + ' KM' : 'NO ROUTE';
      return `<div class="pitem ${p.id === curId ? 'sel' : ''}" data-id="${p.id}">
        <div class="pn">${esc(p.name || 'UNNAMED')}</div>
        <div class="pm">CODE <b style="color:var(--fg)">${esc(p.code)}</b> · ${km}<br>${p.date ? esc(p.date) : '—'} ${esc(p.time || '')} · ${(p.riders || []).filter(r => r.name).length} RIDERS · ${(p.sectors || []).length || 1} SECTORS</div>
        <span class="cd ${c.c}" data-cd="${p.id}">${c.t}</span>
        <button class="ghost x" data-del="${p.id}" title="Delete profile">✕</button></div>`;
    }).join('');
    $('profList').querySelectorAll('.pitem').forEach(el => el.onclick = e => {
      if (e.target.closest('[data-del]')) return;
      openProfile(el.dataset.id);
    });
    $('profList').querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.stopPropagation(); deleteProfile(b.dataset.del); });
  }
  setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach(el => {
      const p = profiles.find(x => x.id === el.dataset.cd); if (!p) return;
      const c = cdInfo(p); el.textContent = c.t; el.className = 'cd ' + c.c;
    });
    if (cur) { const el = $('dCd'); if (el) { const c = cdInfo(cur); el.textContent = c.t; el.className = 'tag ' + (c.c === 'soon' ? 'bad' : c.c === '' ? 'ok' : ''); } }
    const h = $('hClk'); if (h) h.textContent = new Date().toLocaleTimeString();
  }, 1000);

  async function deleteProfile(id) {
    const p = profiles.find(x => x.id === id); if (!p) return;
    if (!(await UL.confirm('DELETE PROFILE', `Delete <b>${esc(p.name)}</b> (code ${esc(p.code)}) from this laptop? This cannot be undone.`, { danger: true, yes: 'DELETE' }))) return;
    profiles = profiles.filter(x => x.id !== id); persist(); fx.remove();
    if (curId === id) closeDetail(true);
    renderList(); UL.toast('PROFILE DELETED', 'warn');
  }

  $('pNew').onclick = async () => {
    if (!(await guardDirty())) return;
    const p = { id: uid(), name: 'NEW MISSION', code: code6(), date: '', time: '', escort: localStorage.ulEscortCall || '', targetSec: null,
      riders: [{ name: '', color: UL.COLORS[0] }, { name: '', color: UL.COLORS[1] }], route: null, sectors: [], created: Date.now() };
    profiles.push(p); persist(); renderList(); openProfile(p.id, true); fx.success();
  };

  /* --------------------------------------------------------- detail UI */
  const isDirty = () => cur && JSON.stringify(cur) !== origJson;
  async function guardDirty() {
    if (!isDirty()) return true;
    return UL.confirm('UNSAVED CHANGES', 'Discard the unsaved changes to this profile?', { danger: true, yes: 'DISCARD' });
  }
  async function openProfile(id, isNew) {
    if (id !== curId && !(await guardDirty())) return;
    const p = profiles.find(x => x.id === id); if (!p) return;
    curId = id; cur = JSON.parse(JSON.stringify(p)); origJson = JSON.stringify(p);
    built = cur.route ? UL.buildRoute(cur.route.pts.map(q => ({ lat: q[0], lon: q[1], ele: q[2] || 0 })), cur.route.name) : null;
    if (built) cur.sectors = UL.normaliseSectors(cur.sectors, built.distance);
    renderList(); renderDetail(); showRouteOnMap(true);
    $('detPanel').classList.add('open'); fx.open();
  }
  function closeDetail(force) {
    (async () => {
      if (!force && !(await guardDirty())) return;
      $('detPanel').classList.remove('open'); curId = null; cur = null; built = null; clearRoute(); renderList(); fx.close();
    })();
  }
  $('dClose').onclick = () => closeDetail();

  function renderDetail() {
    const p = cur; if (!p) return;
    $('dTitle').textContent = 'MISSION DETAILS';
    $('dBody').innerHTML = `
      <div class="sech"><span class="stepnum">1</span>IDENTITY</div>
      <div class="fgrid">
        <div class="fld" style="grid-column:1/3"><label>Operation name</label><input id="fName" value="${esc(p.name)}" style="text-transform:uppercase" placeholder="OP NORTHWIND"></div>
        <div class="fld"><label>Mission code <span class="muted">(riders enter this)</span></label>
          <div class="row"><input id="fCode" value="${esc(p.code)}" maxlength="8" style="text-align:center;letter-spacing:.3em;text-transform:uppercase"><button id="fRegen" class="ghost" title="New random code">⟳</button></div></div>
        <div class="fld"><label>Your escort callsign</label><input id="fEsc" value="${esc(p.escort)}" placeholder="ESCORT-1" style="text-transform:uppercase"></div>
      </div>

      <div class="sech"><span class="stepnum">2</span>SCHEDULE &amp; TARGET</div>
      <div class="fgrid">
        <div class="fld"><label>Date</label><input type="date" id="fDate" value="${esc(p.date)}"></div>
        <div class="fld"><label>Departure time</label><input type="time" id="fTime" value="${esc(p.time)}"></div>
        <div class="fld"><label>Target time (h:mm:ss)</label><input id="fTarget" value="${p.targetSec ? UL.hmsStr(p.targetSec) : ''}" placeholder="e.g. 1:15:00"></div>
        <div class="fld"><label>Countdown</label><div style="padding-top:8px"><span class="tag" id="dCd">—</span></div></div>
      </div>
      <div class="hint" style="margin-top:6px">When you activate the mission, a countdown to this date and time runs on every screen and the mission clock starts automatically at zero.</div>

      <div class="sech"><span class="stepnum">3</span>ROUTE (GPX)</div>
      <div class="row"><button id="fGpxBtn" class="primary" style="flex:1">${built ? '⟳ REPLACE GPX FILE' : '⤒ IMPORT GPX FILE'}</button><input type="file" id="fGpx" accept=".gpx,application/gpx+xml" style="display:none"></div>
      <div class="hint" id="fRouteInfo" style="margin-top:6px"></div>
      <canvas id="setupProf" style="margin-top:8px"></canvas>

      <div class="sech"><span class="stepnum">4</span>SECTORS &amp; CHECKPOINTS</div>
      <div class="hint">Click the elevation profile above to add a checkpoint. Each sector starts at a checkpoint: a rider passing it starts a stopwatch, which stops at the next checkpoint.</div>
      <div class="row" style="margin:8px 0;gap:6px"><span class="hint">Quick split into</span><input type="number" id="fSplitN" min="1" max="12" value="3" style="width:64px;padding:5px"><span class="hint">equal sectors</span>
        <button id="fSplit" class="ghost" style="padding:5px 10px;font-size:10px">SPLIT</button></div>
      <div id="secList"></div>
      <button id="fSecT" class="ghost" style="width:100%;margin-top:6px" title="Set the target completion time of each sector">⏱ SECTOR TARGET TIMES…</button>

      <div class="sech"><span class="stepnum">5</span>RIDERS &amp; CODENAMES</div>
      <div id="riderList"></div>
      <button id="fAddRider" class="ghost" style="margin-top:6px">＋ ADD RIDER</button>
      <div class="hint" style="margin-top:6px">Riders type the mission code and choose their own callsign on their phone. These codenames are the planned roster and colours.</div>`;
    const bind = (id, fn, ev) => { const e = $(id); if (e) e[ev || 'oninput'] = fn; };
    bind('fName', e => { cur.name = e.target.value.toUpperCase(); dirty(); });
    bind('fCode', e => { cur.code = e.target.value.toUpperCase(); dirty(); });
    bind('fRegen', () => { cur.code = code6(); $('fCode').value = cur.code; dirty(); }, 'onclick');
    bind('fEsc', e => { cur.escort = e.target.value.toUpperCase(); dirty(); });
    bind('fDate', e => { cur.date = e.target.value; dirty(); });
    bind('fTime', e => { cur.time = e.target.value; dirty(); });
    bind('fTarget', e => { cur.targetSec = UL.parseHMS(e.target.value); dirty(); });
    bind('fGpxBtn', () => $('fGpx').click(), 'onclick');
    bind('fGpx', onGpx, 'onchange');
    bind('fSplit', () => { if (!built) return UL.toast('IMPORT A GPX FIRST', 'warn'); cur.sectors = UL.autoSplit(+$('fSplitN').value || 1, built.distance); renderSectors(); drawSetupProfile(); showRouteOnMap(); dirty(); }, 'onclick');
    bind('fSecT', openSectorTargets, 'onclick');
    bind('fAddRider', () => { cur.riders.push({ name: '', color: UL.COLORS[cur.riders.length % 8] }); renderRiders(); dirty(); fx.tick(); }, 'onclick');
    const cv = $('setupProf');
    cv.onclick = e => {
      if (!built) return UL.toast('IMPORT A GPX FIRST', 'warn');
      const r = cv.getBoundingClientRect(), d = (e.clientX - r.left) / r.width * built.distance;
      const before = cur.sectors.length;
      cur.sectors = UL.addCut(cur.sectors, d, built.distance);
      if (cur.sectors.length === before) return UL.toast('TOO CLOSE TO AN EXISTING CHECKPOINT OR THE ENDS', 'warn');
      fx.checkpoint(); renderSectors(); drawSetupProfile(); showRouteOnMap(); dirty();
    };
    cv.onmousemove = e => { hoverX = e.clientX - cv.getBoundingClientRect().left; drawSetupProfile(); };
    cv.onmouseleave = () => { hoverX = null; drawSetupProfile(); };
    renderRouteInfo(); renderSectors(); renderRiders(); dirty(); requestAnimationFrame(drawSetupProfile);
  }
  let hoverX = null;
  function dirty() {
    $('dDirty').textContent = isDirty() ? 'UNSAVED' : 'SAVED'; $('dDirty').className = 'tag ' + (isDirty() ? 'bad' : 'ok');
    const c = cdInfo(cur); const el = $('dCd'); if (el) { el.textContent = c.t; el.className = 'tag ' + (c.c === 'soon' ? 'bad' : c.c === '' ? 'ok' : ''); }
  }
  function renderRouteInfo() {
    $('fRouteInfo').innerHTML = built
      ? `<span style="color:var(--good)">ROUTE LOCKED</span> · ${esc(cur.route.name || 'GPX')} · ${built.points.length} pts · ${(built.distance / 1000).toFixed(2)} km · +${Math.round(built.gain)} m gain`
      : 'No route loaded yet. Import the GPX file of the race route.';
  }
  async function onGpx(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const r = UL.parseGPX(await f.text());
      if (!r.points.length) throw new Error('no track points');
      let pts = r.points; const step = Math.ceil(pts.length / 1500);
      if (step > 1) pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
      cur.route = { name: r.name || f.name.replace(/\.gpx$/i, ''), pts: pts.map(p => [+p.lat.toFixed(6), +p.lon.toFixed(6), Math.round(p.ele)]) };
      built = UL.buildRoute(pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele })), cur.route.name);
      cur.route.distance = built.distance; cur.route.gain = built.gain;
      cur.sectors = UL.autoSplit(1, built.distance);
      if ((!cur.name || cur.name === 'NEW MISSION') && r.name) { cur.name = r.name.toUpperCase(); $('fName').value = cur.name; }
      $('fGpxBtn').textContent = '⟳ REPLACE GPX FILE';
      renderRouteInfo(); renderSectors(); drawSetupProfile(); showRouteOnMap(true); dirty(); fx.success();
      UL.toast('ROUTE IMPORTED · ' + (built.distance / 1000).toFixed(1) + ' KM', 'ok');
    } catch (err) { fx.error(); UL.toast('COULD NOT READ GPX: ' + err.message, 'bad'); }
  }

  function renderSectors() {
    if (!built) { $('secList').innerHTML = '<div class="hint">Sectors appear after the route is imported.</div>'; return; }
    cur.sectors = UL.normaliseSectors(cur.sectors, built.distance);
    $('secList').innerHTML = cur.sectors.map((s, i) => `<div class="secrow" data-i="${i}">
      <input type="color" value="${s.color}" data-c="${i}" title="Sector colour">
      <input value="${esc(s.name)}" data-n="${i}" style="text-transform:uppercase" title="${(s.start / 1000).toFixed(2)} → ${(s.end / 1000).toFixed(2)} km">
      <span class="hint" style="text-align:right">${(s.start / 1000).toFixed(1)}–${(s.end / 1000).toFixed(1)} km${s.target ? '<br><b style="color:var(--fg)">' + UL.hmsStr(s.target) + '</b>' : ''}</span>
      ${i > 0 ? `<button class="ghost danger" data-r="${i}" style="padding:3px 6px" title="Remove this checkpoint (merge with previous sector)">✕</button>` : '<span class="hint" title="Start line">⚑</span>'}</div>`).join('');
    $('secList').querySelectorAll('[data-c]').forEach(el => el.oninput = () => { cur.sectors[+el.dataset.c].color = el.value; drawSetupProfile(); showRouteOnMap(); dirty(); });
    $('secList').querySelectorAll('[data-n]').forEach(el => el.oninput = () => { cur.sectors[+el.dataset.n].name = el.value.toUpperCase(); dirty(); });
    $('secList').querySelectorAll('[data-r]').forEach(el => el.onclick = () => {
      cur.sectors = UL.removeCut(cur.sectors, +el.dataset.r, built.distance); fx.remove(); renderSectors(); drawSetupProfile(); showRouteOnMap(); dirty();
    });
  }
  function renderRiders() {
    $('riderList').innerHTML = cur.riders.map((r, i) => `<div class="row" style="margin-bottom:6px">
      <input type="color" value="${r.color}" data-rc="${i}" style="width:30px;height:32px;padding:1px;background:none;border:1px solid var(--line2)" title="Rider colour">
      <input value="${esc(r.name)}" data-rn="${i}" placeholder="CODENAME ${i + 1}" style="flex:1;text-transform:uppercase">
      <button class="ghost danger" data-rx="${i}" style="padding:6px 9px" title="Remove rider">✕</button></div>`).join('');
    $('riderList').querySelectorAll('[data-rc]').forEach(el => el.oninput = () => { cur.riders[+el.dataset.rc].color = el.value; dirty(); });
    $('riderList').querySelectorAll('[data-rn]').forEach(el => el.oninput = () => { cur.riders[+el.dataset.rn].name = el.value.toUpperCase(); dirty(); });
    $('riderList').querySelectorAll('[data-rx]').forEach(el => el.onclick = () => { cur.riders.splice(+el.dataset.rx, 1); renderRiders(); dirty(); fx.remove(); });
  }

  /* profile canvas with sector bands + click-to-split */
  function drawSetupProfile() {
    const cv = $('setupProf'); if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,229,255,.07)';
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(w * i / 8, 0); x.lineTo(w * i / 8, h); x.stroke(); }
    if (!built) { x.fillStyle = '#5d8794'; x.font = '10px monospace'; x.fillText('ROUTE PROFILE — import a GPX file', 12, h / 2); return; }
    const P = built.points, lo = Math.min(...P.map(p => p.ele)), hi = Math.max(...P.map(p => p.ele)), span = Math.max(1, hi - lo);
    const X = d => d / built.distance * w, Y = e => h - 16 - (e - lo) / span * (h - 32);
    (cur.sectors || []).forEach(s => {
      x.beginPath(); x.moveTo(X(s.start), h);
      P.forEach(p => { if (p.d >= s.start && p.d <= s.end) x.lineTo(X(p.d), Y(p.ele)); });
      x.lineTo(X(s.end), h); x.closePath(); x.fillStyle = s.color + '55'; x.fill();
      x.strokeStyle = s.color; x.lineWidth = 1.6; x.beginPath(); let f = true;
      P.forEach(p => { if (p.d >= s.start && p.d <= s.end) { f ? x.moveTo(X(p.d), Y(p.ele)) : x.lineTo(X(p.d), Y(p.ele)); f = false; } }); x.stroke();
      x.strokeStyle = '#fff'; x.lineWidth = 1; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(X(s.start), 0); x.lineTo(X(s.start), h); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#fff'; x.font = '9px monospace'; x.fillText(s.idx === 0 ? 'START' : 'CP' + s.idx, X(s.start) + 3, 10);
    });
    x.fillStyle = '#5d8794'; x.font = '9px monospace'; x.fillText(Math.round(lo) + 'm', 4, h - 3); x.fillText(Math.round(hi) + 'm', 4, 20);
    x.fillText((built.distance / 1000).toFixed(1) + ' km', w - 52, h - 3);
    if (hoverX != null) {
      x.strokeStyle = cfg.v.accent; x.lineWidth = 1; x.beginPath(); x.moveTo(hoverX, 0); x.lineTo(hoverX, h); x.stroke();
      x.fillStyle = cfg.v.accent; x.fillText('SPLIT @ ' + (hoverX / w * built.distance / 1000).toFixed(2) + ' km', Math.min(hoverX + 6, w - 100), h - 18);
    }
  }
  addEventListener('resize', () => { if (cur) drawSetupProfile(); });

  /* route preview on the home map */
  function clearRoute() { if (routeGroup) { hmap.removeLayer(routeGroup); routeGroup = null; } }
  function showRouteOnMap(fit) {
    clearRoute(); if (!built || !hmap) return;
    routeGroup = L.layerGroup().addTo(hmap);
    const S = UL.normaliseSectors(cur.sectors, built.distance), P = built.points;
    S.forEach(s => {
      const seg = P.filter(p => p.d >= s.start && p.d <= s.end).map(p => [p.lat, p.lon]);
      if (seg.length > 1) { L.polyline(seg, { color: '#000', weight: 7, opacity: .5 }).addTo(routeGroup); L.polyline(seg, { color: s.color, weight: 3.5, opacity: .95 }).addTo(routeGroup); }
      const a = UL.routeAt(built, s.start);
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="cpflag" style="color:${s.color};transform:translate(6px,-8px)">${s.idx === 0 ? 'START' : 'CP' + s.idx} · ${esc(s.name)}</div>` }) }).addTo(routeGroup);
    });
    const e = P[P.length - 1];
    L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="cpflag" style="color:#ff4d6d;transform:translate(6px,-8px)">FINISH</div>' }) }).addTo(routeGroup);
    if (fit) fitRoute();
  }
  function fitRoute() { if (built && hmap) hmap.flyToBounds(L.latLngBounds(built.points.map(p => [p.lat, p.lon])), { padding: [60, 60], duration: .9 }); else UL.toast('NO ROUTE LOADED', 'warn'); }

  /* sector target-times popup */
  function openSectorTargets() {
    if (!built) return UL.toast('IMPORT A GPX FIRST', 'warn');
    const S = cur.sectors, dlg = $('dlgSecT');
    const totalOf = () => S.reduce((a, s) => a + (s.target || 0), 0);
    dlg.innerHTML = `<div style="padding:20px"><h3>SECTOR TARGET TIMES</h3>
      <div class="hint" style="margin:8px 0 12px">Target completion time of each sector (mm:ss or h:mm:ss). During the race, the sector stopwatch is compared against it.</div>
      <div id="stRows"></div>
      <div class="row" style="margin-top:12px;gap:8px"><span class="hint">Fill all from average speed</span><input id="stAvg" type="number" min="5" max="80" value="35" style="width:70px;padding:5px"><span class="hint">km/h</span><button class="ghost" id="stFill" style="padding:5px 10px;font-size:10px">APPLY</button></div>
      <div class="row" style="margin-top:12px"><span class="hint">TOTAL OF SECTORS</span><b id="stTotal" style="font-size:16px">--</b><span class="sp"></span><button class="ghost" id="stUse" style="font-size:10px;padding:5px 9px" title="Copy the sum into the overall target time">USE AS OVERALL TARGET</button></div>
      <div class="row" style="margin-top:16px;gap:8px"><button class="primary" id="stOk" style="flex:1">DONE</button></div></div>`;
    const draw = () => {
      $('stRows').innerHTML = S.map((s, i) => `<div class="secrow" style="grid-template-columns:14px 1fr 70px 96px">
        <i style="background:${s.color};width:12px;height:12px;display:block"></i><span style="font-size:11px">${esc(s.name)} <span class="hint">${((s.end - s.start) / 1000).toFixed(2)} km</span></span>
        <span class="hint" data-sp="${i}" style="text-align:right">${s.target ? ((s.end - s.start) / s.target * 3.6).toFixed(1) + ' km/h' : ''}</span>
        <input data-t="${i}" value="${s.target ? UL.hmsStr(s.target) : ''}" placeholder="mm:ss" style="text-align:center"></div>`).join('');
      $('stRows').querySelectorAll('[data-t]').forEach(el => el.oninput = () => {
        const i = +el.dataset.t; S[i].target = UL.parseHMS(el.value);
        const sp = dlg.querySelector(`[data-sp="${i}"]`); sp.textContent = S[i].target ? ((S[i].end - S[i].start) / S[i].target * 3.6).toFixed(1) + ' km/h' : '';
        $('stTotal').textContent = totalOf() ? UL.hmsStr(totalOf()) : '--';
      });
      $('stTotal').textContent = totalOf() ? UL.hmsStr(totalOf()) : '--';
    };
    draw();
    $('stFill').onclick = () => { const v = +$('stAvg').value; if (v > 0) { S.forEach(s => s.target = Math.round((s.end - s.start) / (v / 3.6))); draw(); fx.success(); } };
    $('stUse').onclick = () => { if (!totalOf()) return; cur.targetSec = totalOf(); $('fTarget').value = UL.hmsStr(cur.targetSec); dirty(); fx.success(); UL.toast('OVERALL TARGET SET', 'ok'); };
    $('stOk').onclick = () => { dlg.close(); renderSectors(); dirty(); fx.close(); };
    dlg.showModal(); fx.open();
  }

  /* ----------------------------------------------------------- actions */
  function save() {
    if (!cur) return false;
    if (!cur.code || cur.code.length < 4) { UL.toast('MISSION CODE MUST BE 4–8 CHARACTERS', 'warn'); fx.error(); return false; }
    if (profiles.some(p => p.id !== cur.id && p.code === cur.code)) { UL.toast('ANOTHER PROFILE ALREADY USES THIS CODE', 'warn'); fx.error(); return false; }
    cur.updated = Date.now();
    if (cur.escort) localStorage.ulEscortCall = cur.escort;
    const i = profiles.findIndex(p => p.id === cur.id);
    profiles[i] = JSON.parse(JSON.stringify(cur));
    if (!persist()) return false;
    origJson = JSON.stringify(cur); dirty(); renderList(); fx.save(); UL.toast('PROFILE SAVED', 'ok');
    return true;
  }
  $('dSave').onclick = save;
  $('dDel').onclick = () => cur && deleteProfile(cur.id);
  $('dExport').onclick = () => {
    if (!cur) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cur, null, 1)], { type: 'application/json' }));
    a.download = 'ultralink-' + (cur.name || 'mission').replace(/[^A-Z0-9]+/gi, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('pImport').onclick = () => $('impFile').click();
  $('impFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const p = JSON.parse(await f.text()); if (!p.code || !p.name) throw new Error('not a profile');
      p.id = uid(); if (profiles.some(x => x.code === p.code)) p.code = code6();
      profiles.push(p); persist(); renderList(); fx.success(); UL.toast('PROFILE IMPORTED', 'ok');
    } catch (err) { fx.error(); UL.toast('IMPORT FAILED: ' + err.message, 'bad'); }
    e.target.value = '';
  };
  $('dGo').onclick = () => {
    if (!cur) return;
    if (!built) { fx.error(); return UL.toast('IMPORT A GPX ROUTE FIRST', 'warn'); }
    if (!cur.escort.trim()) { fx.error(); $('fEsc').focus(); return UL.toast('ENTER YOUR ESCORT CALLSIGN', 'warn'); }
    if (!save()) return;
    let startAt = startMs(cur); if (startAt && startAt < Date.now() + 2000) startAt = null;
    fx.go();
    Plan.onLaunch && Plan.onLaunch({ profile: JSON.parse(JSON.stringify(cur)), route: built, startAt });
  };

  /* join existing */
  $('pJoin').onclick = () => { $('jcode').value = ''; $('jcall').value = localStorage.ulEscortCall || ''; $('jerr').textContent = ''; $('dlgJoin').showModal(); fx.open(); };
  $('jgo').onclick = () => {
    if (!$('jcode').value.trim() || !$('jcall').value.trim()) { fx.error(); return ($('jerr').textContent = 'CODE AND CALLSIGN REQUIRED'); }
    localStorage.ulEscortCall = $('jcall').value.toUpperCase();
    Plan.onJoin && Plan.onJoin($('jcode').value.toUpperCase(), $('jcall').value.toUpperCase());
  };
  $('hSet').onclick = () => { $('dlgSet').showModal(); fx.open(); };
  $('hHelp').onclick = () => {
    $('dlgHelp').innerHTML = `<div style="padding:20px"><h3>PLANNING A MISSION</h3><ol style="font-size:12px;line-height:1.95;padding-left:18px;margin:12px 0">
      <li>Press <b>＋ NEW MISSION PROFILE</b>, then click the profile to open its details on the right.</li>
      <li>Fill in the name, mission code and your escort callsign.</li>
      <li>Set the <b>date and departure time</b> — a live countdown appears on the profile.</li>
      <li><b>Import the GPX</b> route, then click the elevation profile to add <b>checkpoints</b> and split it into coloured sectors.</li>
      <li>Open <b>⏱ SECTOR TARGET TIMES</b> to set a target for each sector.</li>
      <li>Add rider codenames, press <b>SAVE</b>. Profiles stay on this laptop; use EXPORT to back them up.</li>
      <li>When ready, press <b>▶ ACTIVATE MISSION</b>. Riders can now join with the code. The mission clock starts by itself at the departure time.</li></ol>
      <div class="hint">Tip: the blue triangle on the map is your current position.</div>
      <button class="primary" style="margin-top:14px" onclick="this.closest('dialog').close()">GOT IT</button></div>`;
    $('dlgHelp').showModal(); fx.open();
  };

  /* -------------------------------------------------------------- API */
  const Plan = UL.Plan = {
    onLaunch: null, onJoin: null,
    show() {
      $('home').style.display = 'block';
      if (!hmap) initHomeMap(); else setTimeout(() => hmap.invalidateSize(), 50);
      renderList();
      fetch('health').then(() => { $('hRelay').textContent = 'RELAY ONLINE'; $('hRelay').className = 'tag ok'; }).catch(() => { $('hRelay').textContent = 'RELAY OFFLINE'; $('hRelay').className = 'tag bad'; });
      if (!localStorage.ulPlanHelp) { localStorage.ulPlanHelp = 1; setTimeout(() => $('hHelp').click(), 700); }
    },
    hide() {
      $('home').style.display = 'none';
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    },
    joinError(m) { $('jerr').textContent = m; },
    closeJoin() { $('dlgJoin').close(); },
    profiles: () => profiles
  };
})();
