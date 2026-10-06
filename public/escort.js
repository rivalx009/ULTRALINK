/* ULTRALINK — ESCORT MODE: boot → planning home (escort-plan.js) → live operations */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cfg = UL.cfg, fx = UL.fx;
  const link = new UL.Link(), tel = new UL.Telemetry(), wind = new UL.WindField();
  let voice = null, map = null, route = null, mission = null, me = null, myColor = '#00e5ff', myCall = 'ESCORT';
  let units = new Map();               // id -> {id,role,callsign,color,data,ts,marker,trail}
  let clockStart = null, clockStop = null, targetSec = null, startAt = null;
  let sel = 'self', follow = true, keymap = new Map(), pttOpen = false;
  let routeGroup = null, selfMarker = null, sectors = [], sectorTimer = null;
  let opsStarted = false, joinInfo = null, popOff = false, lastCdSec = null, ended = false;
  let leadName = null, launchLead = null, restoring = 0, opsSec = null, hiLayer = null, pttTo = 'all';
  let power = null, geoWatch = null, gpsRef = null, freshRid = null, mTab = 'map';
  const isPhone = () => innerWidth <= 760;
  const OFF = new Map();               // rider id -> off-route alert state {n, back, on, ack, dist, since, beep}
  const fmtSpeed = ms => ms == null ? '--' : cfg.speed(ms).toFixed(1);

  /* ================================================================== BOOT */
  const bootTasks = UL.boot.tasks();
  async function startup() {
    buildSettings();
    if (/noboot/.test(location.search) || UL.boot.seen()) { const b = $('boot'); if (b) b.remove(); UL.Plan.show(); return; }   // loading screen already shown on the start page
    await UL.boot.run({ tasks: bootTasks, subtitle: 'ESCORT CONSOLE · LOADING' });
    UL.Plan.show();
  }

  /* ============================================================ LAUNCH/JOIN */
  UL.Plan.onLaunch = ({ profile, route: r, startAt: sa }) => {
    myCall = profile.escort.toUpperCase(); launchLead = profile.lead || null;
    joinInfo = { t: 'join', code: profile.code, role: 'escort', callsign: myCall, resume: resumeId(profile.code) };
    /* training profile with laps: the loop is unrolled N times, every lap gets its own sectors + targets */
    const training = profile.kind === 'training', X = training ? UL.expandLaps(profile, r) : null, laps = X ? X.laps : 1;
    route = laps > 1 ? UL.buildRoute(X.pts.map(q => ({ lat: q[0], lon: q[1], ele: q[2] || 0 })), r.name) : r;
    const secs = laps > 1 ? X.sectors : UL.normaliseSectors(X ? X.sectors : profile.sectors, r.distance);
    link.connect();
    link.send({
      t: 'mission.create', code: profile.code, name: profile.name || 'UNNAMED OP',
      route: laps > 1 ? X.pts : profile.route.pts, distance: route.distance,
      riders: profile.riders.filter(x => x.name).map(x => ({ codename: x.name, color: x.color })),
      sectors: secs.map(s => Object.assign({ name: s.name, color: s.color, start: s.start, target: s.target || null, cp: s.cp || '', notes: s.notes || '' }, s.lap ? { lap: s.lap, li: s.li, base: s.base } : {})),
      startAt: sa || null, targetSec: (X && X.targetSec) || profile.targetSec || null, lead: profile.lead || null,
      kind: training ? 'training' : 'race', laps, lapLen: X ? X.lapLen : r.distance, lapTargets: X ? X.lapTargets : []
    });
  };
  /* the same laptop keeps its unit id across reconnects (voice links + cards survive a network blip) */
  function resumeId(code) { try { const k = 'ulEsc:' + code; return sessionStorage[k] || undefined; } catch (e) { return undefined; } }
  const joinMsg = () => Object.assign({}, joinInfo, me ? { resume: me } : {});
  link.on('mission.created', m => { restoring = 0; link.send(joinMsg()); });
  UL.Plan.onJoin = (code, call) => { myCall = call; joinInfo = { t: 'join', code, role: 'escort', callsign: call, resume: resumeId(code) }; link.connect(); link.send(joinInfo); };
  /** the relay restarted (free hosting sleeps / redeploys): re-create the live mission from what this escort knows */
  function restoreMission() {
    if (Date.now() - restoring < 6000 || !mission) return; restoring = Date.now();
    link.send({ t: 'mission.create', code: mission.code, name: mission.name, route: mission.route, distance: mission.distance, riders: mission.riders,
      sectors: mission.sectors, startAt: mission.startAt || null, kind: mission.kind, laps: mission.laps, lapLen: mission.lapLen, lapTargets: mission.lapTargets, targetSec: targetSec || mission.targetSec || null, lead: mission.lead || null,
      restore: true, clockStart, clockStop });
    log('SYS', 'RELAY RESTARTED — MISSION RESTORED', '#ffb000');
  }
  link.on('error', m => {
    if (m.code === 'NO_MISSION' && opsStarted && !ended) return restoreMission();
    UL.Plan.joinError(m.msg || 'LINK ERROR'); UL.toast(m.msg || 'LINK ERROR', 'bad'); fx.error();
  });
  link.on('open', () => { $('tLink').className = 'dot ok'; if (opsStarted && joinInfo && !ended) link.send(joinMsg()); });
  link.on('close', () => { $('tLink').className = 'dot'; });
  link.on('rtt', v => { $('tRtt').textContent = 'RTT ' + v + 'ms'; $('netq').textContent = v < 150 ? 'NET GOOD' : v < 500 ? 'NET FAIR' : 'NET POOR'; $('netq').className = 'tag ' + (v < 150 ? 'ok' : v < 500 ? '' : 'bad'); });

  link.on('joined', m => {
    me = m.id; mission = m.mission; myColor = m.color;
    try { sessionStorage['ulEsc:' + mission.code] = me; } catch (e) {}
    if (voice) voice.selfId = me;
    if (opsStarted) { if (voice) voice.sync([...units.keys()]); return; }   // silent re-join after a dropped connection
    try { leadName = localStorage['ulLead:' + mission.code] || launchLead || mission.lead || null; } catch (e) { leadName = launchLead || mission.lead || null; }
    opsStarted = true;
    if (!route && mission.route && mission.route.length) route = UL.buildRoute(mission.route.map(p => ({ lat: p[0], lon: p[1], ele: p[2] || 0 })));
    if (route) tel.setRoute(route);
    if (route && mission.laps > 1) { try { const k = +sessionStorage['ulIdx:' + mission.code]; if (k >= 0) tel.lastIdx = k; } catch (e) {} }
    clockStart = mission.clockStart || null; clockStop = mission.clockStop || null; targetSec = mission.targetSec || null; startAt = mission.startAt || null;
    sectors = UL.normaliseSectors(mission.sectors, route ? route.distance : 1);
    sectorTimer = new UL.SectorTimer(sectors, route ? route.distance : 1, {
      checkpoint: (key, i, s) => {
        fx.checkpoint(); log('CP', `${key} passed ${UL.cpLabel(s)} — ${s.name}`, s.color); UL.toast(`${key} · ${s.name} STARTED`, 'ok');
        if (s.lap && s.li === 0) log('LAP', `${key} STARTED LAP ${s.lap} / ${mission.laps}`, '#ffb000');
      },
      finish: (key, i, dur, s, isEnd) => {
        fx.sectorDone();
        const dl = s.target ? dur - s.target : null, dtxt = dl == null ? '' : ` (${dl <= 0 ? '−' : '+'}${UL.hmsStr(Math.abs(dl))} vs target)`;
        log('SEC', `${key} finished ${s.name} in ${UL.hmsStr(dur)}${dtxt}`, s.color);
        UL.toast(`${key} · ${s.name} ${UL.hmsStr(dur)}${dtxt}`, dl != null && dl > 0 ? 'warn' : 'ok', 5000);
        if (s.lap && (isEnd || (sectors[i + 1] && sectors[i + 1].lap !== s.lap))) {          // last sector of a lap → lap time
          const L = UL.lapTimes(sectors, sectorTimer.units.get(key)).find(x => x.lap === s.lap);
          if (L && L.time != null) { const d2 = L.target ? L.time - L.target : null;
            log('LAP', `${key} LAP ${s.lap} / ${mission.laps} in ${UL.hmsStr(L.time)}${d2 == null ? '' : ` (${d2 <= 0 ? '−' : '+'}${UL.hmsStr(Math.abs(d2))} vs target ${UL.hmsStr(L.target)})`}`, '#ffb000');
            UL.toast(`${key} · LAP ${s.lap} ${UL.hmsStr(L.time)}`, d2 != null && d2 > 0 ? 'warn' : 'ok', 5000); }
        }
        if (isEnd) log('SYS', `${key} FINISHED THE ${mission.laps > 1 ? 'SESSION (' + mission.laps + ' LAPS)' : 'ROUTE'}`, '#7cff5a');
      }
    });
    UL.Plan.hide(); UL.Plan.closeJoin();
    $('shell').style.display = 'flex';
    $('tMis').textContent = mission.name + (mission.kind === 'training' ? ' · TRAINING' + (mission.laps > 1 ? ' · ' + mission.laps + ' LAPS' : '') : ''); $('tCode').textContent = 'CODE ' + mission.code;
    initMap(); initVoice(); startGeo(); layoutHandles(); renderSel(); bindMissionControls(); initGraph(); initOpsExtras();
    initPower(); initWidgets(); initMobile();
    if (leadName) log('SYS', '★ LEAD RIDER: ' + leadName, '#ffb000');
    log('SYS', 'MISSION ' + mission.code + ' ACTIVE — riders can join with the code', '#7cff5a');
    cfg.onchange = () => applyLiveSettings();
    setInterval(tick, 500);
    wind.addEventListener('update', () => renderWindTag());
    if (route) { wind.loadRoute(route); setInterval(() => wind.loadRoute(route), 120000); }
    fx.success();
  });

  /* ===================================================== ROSTER / TELEMETRY */
  link.on('roster', m => {
    const ids = new Set();
    m.units.filter(u => u.id !== me).forEach(u => {
      ids.add(u.id);
      const cur = units.get(u.id) || { data: {}, ts: 0 };
      const isNew = !units.has(u.id);
      units.set(u.id, Object.assign(cur, { id: u.id, role: u.role, callsign: u.callsign, color: u.color }));
      if (isNew && opsStarted) {
        log('SYS', `${u.callsign} (${u.role.toUpperCase()}) CONNECTED`, u.color); UL.toast(`${u.callsign} CONNECTED`, 'ok'); fx.success();
        if (u.role === 'rider' && u.callsign === leadName && sel === 'self') { sel = u.id; follow = true; G.zoomed = true; }   // lead rider becomes the main follow-up
      }
    });
    [...units.keys()].forEach(id => { if (!ids.has(id)) { const u = units.get(id); if (u && opsStarted) { log('SYS', `${u.callsign} LINK LOST`, '#ff4d6d'); fx.error(); } removeUnit(id); } });
    assignKeys(); renderUnits();
    if (voice) voice.sync([...ids]);
  });
  link.on('telemetry', m => {
    const u = units.get(m.id) || { id: m.id, role: m.role, callsign: m.callsign, color: m.color };
    u.data = m.data; u.ts = Date.now(); u.callsign = m.callsign; u.color = m.color; u.role = m.role;
    units.set(m.id, u);
    if (u.role === 'rider' && sectorTimer) sectorTimer.feed(u.callsign, m.data.covered, m.data.ts || Date.now());
    if (u.role === 'rider' && power) power.feed(u);
    if (m.fresh && gpsRef && m.fresh === gpsRef.rid) gpsRef.got.add(m.id);
    placeUnit(u); checkOff(u); renderUnits(); if (sel === m.id) renderSel();
  });
  let rxCount = 0;
  link.on('ptt', m => {
    const u = units.get(m.from);
    if (m.state === 'start') {
      rxCount++; fx.rxOpen();
      $('txbanner').style.display = 'block'; $('txbanner').textContent = '◉ INBOUND ' + m.callsign;
      $('txbanner').style.borderColor = m.color; $('txbanner').style.color = m.color;
      u && u.marker && u.marker.getElement()?.classList.add('tx');
      log('RX', m.callsign + ' transmitting', m.color);
    } else {
      rxCount = Math.max(0, rxCount - 1); if (!pttOpen) $('txbanner').style.display = 'none';
      fx.rxClose();
      u && u.marker && u.marker.getElement()?.classList.remove('tx');
    }
  });
  link.on('text', m => log(m.callsign, m.body, '#ffb000'));

  /** select a unit: map flies to it and follows, graph homes in on it, rider pop-up opens */
  let flyUntil = 0;
  function selectUnit(id) {
    sel = id; follow = true; flyUntil = Date.now() + 900; G.zoomed = true; popOff = false; syncFollowBtn(); closeOpsSector(true);
    const d = id === 'self' ? tel.state : units.get(id)?.data;
    if (d && d.lat != null) map.flyTo([d.lat, d.lon], Math.max(map.getZoom(), cfg.v.zoomFollow), { duration: .7 });
    fx.select(); renderSel(); renderUnits(); renderPop(true);
    if (isPhone() && mTab !== 'map') setTab('map');
  }
  function removeUnit(id) { OFF.delete(id); renderOff(); const u = units.get(id); if (u && u.marker) { map.removeLayer(u.marker); u.trail && map.removeLayer(u.trail); } removeCard(id); units.delete(id); if (sel === id) { sel = 'self'; renderSel(); renderPop(true); } }

  /* ==================================================================== MAP */
  const LAYERS = UL.LAYERS;
  let activeLayer = null, gridLayer = null, syncOverlays = () => {};
  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true });
    window.__map = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    setLayer(cfg.v.mapLayer || 'SAT');
    $('layers').innerHTML = '<div class="wh">MAP LAYER</div>' + Object.keys(LAYERS).map(k => `<button data-l="${k}">${k}</button>`).join('');
    $('layers').querySelectorAll('button').forEach(b => b.onclick = () => setLayer(b.dataset.l));
    $('mapopts').innerHTML = `<div class="wh">OVERLAY</div>
      <button id="oGrid" class="on">GRID</button><button id="oLbl" class="on">LABELS</button><button id="oRte" class="on">ROUTE</button><button id="oFit">FIT</button>`;
    $('oGrid').onclick = e => { e.target.classList.toggle('on'); gridLayer.setOpacity(e.target.classList.contains('on') ? 1 : 0); };
    $('oLbl').onclick = e => { e.target.classList.toggle('on'); document.body.classList.toggle('nolabels', !e.target.classList.contains('on')); };
    $('oRte').onclick = e => { e.target.classList.toggle('on'); routeGroup && (e.target.classList.contains('on') ? routeGroup.addTo(map) : map.removeLayer(routeGroup)); };
    $('oFit').onclick = () => fitRoute();
    syncOverlays = UL.mapOverlays(map, $('mapopts'));
    gridLayer = UL.makeGrid().addTo(map); gridLayer.setOpacity(cfg.v.gridOverlay ? 1 : 0);
    if (route) { drawRoute(); fitRoute(true); } else map.setView([-20.3, 57.55], 12);
    map.on('dragstart', () => { follow = false; syncFollowBtn(); });
    map.on('click', e => { if (!route) return; const h = UL.routeHit(map, route, e.latlng); if (h && h.px < 18) openOpsSector(UL.sectorAt(sectors, h.d).idx); else if (opsSec != null) closeOpsSector(); });
    map.on('moveend', updateReturnBtn);
  }
  /* ---- click a sector: fly to it + read-only card (gradient / elevation / escort notes) */
  function openOpsSector(i) {
    const s = sectors[i]; if (!s || !route) return;
    opsSec = i; follow = false; syncFollowBtn();
    if (innerWidth < 760 && !popOff && units.get(sel)?.role === 'rider') { popOff = true; renderPop(true); }
    if (hiLayer) map.removeLayer(hiLayer);
    const seg = UL.sectorLine(route, s);
    hiLayer = L.polyline(seg, { color: '#fff', weight: 9, opacity: .28, interactive: false }).addTo(map);
    const wide = innerWidth >= 760, rp = wide ? 380 + ($('map').classList.contains('popopen') ? 312 : 0) : 40;
    map.flyToBounds(UL.sectorBounds(route, s), { paddingTopLeft: [40, 40], paddingBottomRight: [rp, wide ? 40 : Math.round(innerHeight * .45)], duration: 1.1, maxZoom: 17 });
    UL.sectorCard($('opsSecCard'), { route, sectors, index: i, editable: false, onClose: () => closeOpsSector() });
    fx.open(); updateReturnBtn();
  }
  function closeOpsSector(silent) {
    if (opsSec == null) return; opsSec = null;
    $('opsSecCard').classList.remove('in'); if (hiLayer) { map.removeLayer(hiLayer); hiLayer = null; }
    if (!silent) fx.close();
  }
  function drawRoute() {
    if (routeGroup) map.removeLayer(routeGroup);
    routeGroup = L.layerGroup().addTo(map);
    const P = route.points;
    sectors.filter(s => !s.lap || s.lap === 1).forEach(s => {          // lap routes: the loop is drawn once
      const seg = UL.sectorLine(route, s);
      if (seg.length > 1) { L.polyline(seg, { color: '#000', weight: 7, opacity: .5 }).addTo(routeGroup); L.polyline(seg, { color: s.color, weight: 3, opacity: .95 }).addTo(routeGroup); }
      const a = UL.routeAt(route, s.start);
      const lbl = s.lap && s.li === 0 ? 'START / LAPS' : UL.cpLabel(s);
      L.marker([a.lat, a.lon], { icon: UL.cpIcon(s.color, lbl), zIndexOffset: 100, title: lbl + ' · ' + (s.base || s.name) })
        .on('click', () => openOpsSector(s.idx)).addTo(routeGroup);
    });
    const e = P[P.length - 1];
    if (!(mission && mission.laps > 1)) L.marker([e.lat, e.lon], { icon: UL.cpIcon('#fff', 'FINISH', { finish: true }), zIndexOffset: 100, interactive: false }).addTo(routeGroup);
  }
  function fitRoute(instant) { if (route) map.fitBounds(L.latLngBounds(route.points.map(p => [p.lat, p.lon])), { padding: [40, 40], animate: !instant }); }
  function setLayer(k) {
    if (activeLayer) map.removeLayer(activeLayer);
    activeLayer = LAYERS[k]().addTo(map); activeLayer.setZIndex(0);
    cfg.set('mapLayer', k);
    $('layers')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.l === k));
  }
  function icon(u, isSelf) {
    const c = cfg.colorFor(u.callsign, u.color || myColor), hd = (u.data?.heading || 0);
    return L.divIcon({
      className: 'mk' + (sel === u.id ? ' sel' : ''), iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<div style="color:${c}" class="${OFF.get(u.id)?.on ? 'offr' : ''}">${UL.unitSvg(u.role, c, hd)}<span class="lbl">${isSelf ? '● ' : ''}${u.role === 'rider' && u.callsign === leadName ? '★ ' : ''}${esc(u.callsign)}${OFF.get(u.id)?.on ? ' · OFF ROUTE' : ''}</span></div>`
    });
  }
  /** where to draw a unit: on the route line when GPS says it is within 30 m of it (removes GPS wobble), else the raw fix */
  function shownLL(d) {
    if (cfg.v.snapRoute !== false && route && typeof d.offRoute === 'number' && d.offRoute < 30 && d.covered != null) { const r = UL.routeAt(route, d.covered); if (r) return [r.lat, r.lon]; }
    return [d.lat, d.lon];
  }
  function placeUnit(u) {
    const d = u.data; if (!d || d.lat == null || !map) return;
    const ll = shownLL(d);
    if (!u.marker) {
      u.marker = L.marker(ll, { icon: icon(u), zIndexOffset: 500 }).addTo(map);
      u.marker.on('click', () => selectUnit(u.id));
      u.trail = L.polyline([ll], { color: u.color, weight: 1.2, opacity: .45, interactive: false }).addTo(map);
      if (sel === u.id && follow) { flyUntil = Date.now() + 1000; map.flyTo(ll, Math.max(map.getZoom(), cfg.v.zoomFollow), { duration: .9 }); }
    } else {
      u.marker.setLatLng(ll); u.marker.setIcon(icon(u));
      const t = u.trail.getLatLngs(); t.push(L.latLng(ll)); if (t.length > cfg.v.trailLength) t.shift(); u.trail.setLatLngs(t);
    }
    if (follow && Date.now() > flyUntil && sel === u.id && (d.speed || 0) > 0.6) map.panTo(ll, { animate: true, duration: .4 });
  }

  /* ================================================================ SELF GPS */
  function startGeo() {
    if (!navigator.geolocation) return;
    if (geoWatch != null) { try { navigator.geolocation.clearWatch(geoWatch); } catch (e) {} }
    geoWatch = navigator.geolocation.watchPosition(p => tel.onPosition(p), () => {}, { enableHighAccuracy: true, maximumAge: 1500, timeout: 20000 });
  }
  /** one brand-new high-accuracy fix (no cached position) */
  function freshFix() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(false);
      const t = setTimeout(() => res(false), 11000);
      navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); tel.onPosition(p); res(true); }, () => { clearTimeout(t); res(false); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    });
  }
  let lastTx = 0;
  tel.addEventListener('update', e => {
    if (mission && mission.laps > 1 && tel.lastIdx != null) { try { sessionStorage['ulIdx:' + mission.code] = tel.lastIdx; } catch (x) {} }
    const s = e.detail;
    if (!map) return;
    if (!selfMarker && s.lat != null) {
      selfMarker = L.marker(shownLL(s), { icon: icon(selfUnit(), true), zIndexOffset: 900 }).addTo(map);
      selfMarker.on('click', () => selectUnit('self'));
    } else if (selfMarker) { selfMarker.setLatLng(shownLL(s)); selfMarker.setIcon(icon(selfUnit(), true)); }
    if (follow && Date.now() > flyUntil && sel === 'self' && s.lat != null && (s.speed || 0) > 0.6) map.panTo([s.lat, s.lon], { animate: true, duration: .4 });
    if (sel === 'self') renderSel();
    renderUnits();
    const now = Date.now();
    if (now - lastTx > 1500 || freshRid) { lastTx = now; const msg = { t: 'telemetry', data: Object.assign({}, s, { lead: leadName }) }; if (freshRid) { msg.fresh = freshRid; freshRid = null; } link.send(msg); }
  });
  function selfUnit() { return { id: 'self', role: 'escort', callsign: myCall, color: myColor, data: tel.state, ts: Date.now() }; }
  const isLead = u => u && u.role === 'rider' && leadName && u.callsign === leadName;
  function sortedUnits() { return [...units.values()].sort((a, b) => (isLead(b) - isLead(a)) || (a.role === b.role ? a.callsign.localeCompare(b.callsign) : a.role === 'rider' ? -1 : 1)); }
  const heading = d => (d && d.heading != null && (d.speed || 0) > 1.5) ? d.heading : (route && d && d.covered != null ? (UL.routeAt(route, d.covered)?.bearing ?? d.heading ?? 0) : (d?.heading ?? 0));

  /* ===================================================== CLOCK / COUNTDOWN */
  link.on('mission.clock', m => {
    const wasIdle = !clockStart;
    clockStart = m.clockStart; clockStop = m.clockStop; targetSec = m.targetSec;
    syncClockBtn();
    if (m.clockStart && !m.clockStop && wasIdle) { fx.go(); UL.toast('MISSION CLOCK RUNNING — GO', 'ok'); $('cdBanner').style.display = 'none'; }
    log('SYS', clockStart ? (clockStop ? 'CLOCK STOPPED' : 'CLOCK RUNNING' + (m.auto ? ' (SCHEDULED START)' : '')) : 'CLOCK RESET', '#7cff5a');
    if (!clockStart && sectorTimer) sectorTimer.reset();
  });
  link.on('mission', m => { mission = m.mission; startAt = mission.startAt || null; lastCdSec = null; });
  link.on('mission.ended', m => {
    ended = true; OFF.clear(); renderOff(); m.mode === 'close' ? fx.success() : fx.abort();
    $('dlgEnded').innerHTML = `<div style="padding:22px;text-align:center">
      <h3 style="color:var(--bad);letter-spacing:.3em">${esc(m.reason)}</h3>
      <div class="muted" style="font-size:11px;margin-top:10px">Declared by ${esc(m.by)}. All units have been notified and the mission code is now invalid.</div>
      <button class="primary" style="margin-top:16px" onclick="location.href='escort.html?noboot=1'">BACK TO PLANNING</button></div>`;
    $('dlgEnded').showModal();
  });

  function bindMissionControls() {
    syncClockBtn();
    $('btnClock').onclick = () => link.send({ t: 'mission.clock', code: mission.code, action: !clockStart ? 'start' : (clockStop ? 'reset' : 'stop') });
    $('btnTarget').onclick = () => {
      const cur = targetSec ? UL.hmsStr(targetSec) : '';
      $('dlgTarget').innerHTML = `<div style="padding:20px;width:min(360px,88vw)"><h3>TARGET TIME</h3>
        <div class="hint" style="margin:8px 0 12px">Target duration of the whole stage (mm:ss or h:mm:ss). DELTA compares it with the projected finish of the selected unit.</div>
        <label>Target time</label><input id="tgtMin" value="${cur}" placeholder="1:15:00" style="width:100%;text-align:center;font-size:20px">
        <div class="row" style="margin-top:14px;gap:8px"><button class="primary" id="tgtOk" style="flex:1">SET</button><button class="ghost" id="tgtClear" style="flex:1">CLEAR</button></div></div>`;
      $('dlgTarget').showModal(); fx.open();
      $('tgtOk').onclick = () => { const v = UL.parseHMS($('tgtMin').value); link.send({ t: 'mission.clock', code: mission.code, targetSec: v }); $('dlgTarget').close(); fx.save(); };
      $('tgtClear').onclick = () => { link.send({ t: 'mission.clock', code: mission.code, targetSec: null }); $('dlgTarget').close(); };
    };
    $('btnSched').onclick = () => {
      const val = startAt ? new Date(startAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      $('dlgSched').innerHTML = `<div style="padding:20px;width:min(380px,88vw)"><h3>DEPARTURE COUNTDOWN</h3>
        <div class="hint" style="margin:8px 0 12px">The mission clock starts automatically at this time on every screen.</div>
        <label>Departure (local time)</label><input type="datetime-local" id="schedT" value="${val}" style="width:100%">
        <div class="row" style="margin-top:14px;gap:8px"><button class="primary" id="schedOk" style="flex:1">SET COUNTDOWN</button><button class="ghost" id="schedNow" style="flex:1">START NOW</button></div>
        <button class="ghost" id="schedClr" style="width:100%;margin-top:8px">CLEAR SCHEDULE</button></div>`;
      $('dlgSched').showModal(); fx.open();
      $('schedOk').onclick = () => { const t = new Date($('schedT').value).getTime(); if (!isFinite(t) || t < Date.now() + 2000) { fx.error(); return UL.toast('CHOOSE A FUTURE TIME', 'warn'); } link.send({ t: 'mission.update', code: mission.code, patch: { startAt: t } }); $('dlgSched').close(); fx.save(); };
      $('schedClr').onclick = () => { link.send({ t: 'mission.update', code: mission.code, patch: { startAt: null } }); $('dlgSched').close(); };
      $('schedNow').onclick = () => { link.send({ t: 'mission.update', code: mission.code, patch: { startAt: null } }); link.send({ t: 'mission.clock', code: mission.code, action: 'start' }); $('dlgSched').close(); };
    };
    $('btnAbort').onclick = () => {
      $('dlgAbort').innerHTML = `<div style="padding:20px;width:min(420px,90vw)"><h3 style="color:var(--bad)">END MISSION</h3>
        <div class="muted" style="font-size:11px;line-height:1.7;margin:10px 0 14px">Every connected rider and escort is notified and disconnected. The code ${esc(mission.code)} stops working. This cannot be undone.</div>
        <div class="row" style="gap:8px"><button class="ghost danger" id="abAbort" style="flex:1">ABORT (EMERGENCY)</button><button class="ghost" id="abClose" style="flex:1">CLOSE (COMPLETE)</button></div>
        <button class="ghost" style="width:100%;margin-top:8px" onclick="this.closest('dialog').close()">CANCEL</button></div>`;
      $('dlgAbort').showModal(); fx.alert();
      $('abAbort').onclick = () => { link.send({ t: 'mission.abort', code: mission.code, mode: 'abort', reason: 'MISSION ABORTED' }); $('dlgAbort').close(); };
      $('abClose').onclick = () => { link.send({ t: 'mission.abort', code: mission.code, mode: 'close', reason: 'MISSION COMPLETE' }); $('dlgAbort').close(); };
    };
    $('btnSettings').onclick = () => { $('dlgSet').showModal(); fx.open(); };
    $('btnWind').onclick = openWindDialog;
    $('btnSectors').onclick = openBoard;
    $('btnFollow').onclick = () => { follow = !follow; syncFollowBtn(); };
  }
  function syncClockBtn() {
    if (!$('btnClock')) return;
    $('btnClock').textContent = !clockStart ? 'START' : (clockStop ? 'RESET' : 'STOP');
    $('btnClock').className = clockStart && !clockStop ? 'primary' : 'ghost';
  }
  const elapsedSec = () => clockStart ? ((clockStop || Date.now()) - clockStart) / 1000 : 0;
  function renderClock() {
    const e = elapsedSec();
    $('mClock').textContent = UL.fmt.hms(e).padStart(5, '0');
    $('mTarget').textContent = 'TARGET ' + (targetSec ? UL.fmt.hms(targetSec) : '--:--');
    const u = sel === 'self' ? { data: tel.state } : units.get(sel);
    const togo = u && u.data ? u.data.etaSec : null;
    if (targetSec && clockStart && togo != null) {
      const proj = e + togo, d = proj - targetSec;
      $('mDelta').textContent = 'DELTA ' + (d >= 0 ? '+' : '−') + UL.fmt.hms(Math.abs(d)); $('mDelta').className = 'tag ' + (d <= 0 ? 'ok' : 'bad');
    } else { $('mDelta').textContent = 'DELTA --'; $('mDelta').className = 'tag'; }
    /* departure countdown */
    const cd = $('cdBanner');
    if (startAt && !clockStart) {
      const rem = Math.ceil((startAt - Date.now()) / 1000);
      const h = Math.floor(Math.max(0, rem) / 3600), m = Math.floor((Math.max(0, rem) % 3600) / 60), s = Math.max(0, rem) % 60, d = Math.floor(h / 24);
      const txt = (d ? d + 'd ' : '') + String(h % 24).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      $('mStart').textContent = 'T-' + txt; $('mStart').className = 'tag ' + (rem <= 600 ? 'bad' : 'ok');
      if (rem <= 900 && rem > 0) { cd.style.display = 'block'; cd.innerHTML = `<small>DEPARTURE IN</small>${txt}`; } else cd.style.display = 'none';
      if (rem <= 10 && rem > 0 && rem !== lastCdSec) { lastCdSec = rem; fx.countdown(rem); }
    } else { $('mStart').textContent = clockStart ? 'DEPARTED' : 'NO SCHEDULE'; $('mStart').className = 'tag' + (clockStart ? ' ok' : ''); if (clockStart) cd.style.display = 'none'; }
  }

  /* ===================================================== UNIT CARDS/GAUGES */
  const R = 44, CX = 60, CY = 56, ARC = R * (240 * Math.PI / 180);
  const pt = a => [CX + R * Math.cos(a * Math.PI / 180), CY + R * Math.sin(a * Math.PI / 180)];
  const cards = new Map();
  const MODES = [{ k: 'SPEED' }, { k: 'HEART RATE' }, { k: 'GRADIENT' }];
  function gaugeSvg() {
    const a = pt(150), b = pt(390 % 360 || 30), path = `M${a[0].toFixed(1)} ${a[1].toFixed(1)} A${R} ${R} 0 1 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    let ticks = '';
    for (let i = 0; i <= 8; i++) { const ang = 150 + i * 30, p1 = [CX + (R + 6) * Math.cos(ang * Math.PI / 180), CY + (R + 6) * Math.sin(ang * Math.PI / 180)], p2 = [CX + (R + (i % 2 ? 9 : 12)) * Math.cos(ang * Math.PI / 180), CY + (R + (i % 2 ? 9 : 12)) * Math.sin(ang * Math.PI / 180)]; ticks += `<line class="tk" x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}"/>`; }
    return `<svg class="gauge" viewBox="0 0 120 92">${ticks}<path class="tr" d="${path}"/><path class="vl" d="${path}" stroke-dasharray="${ARC.toFixed(1)}" stroke-dashoffset="${ARC.toFixed(1)}"/><circle class="nd" r="4.5" fill="#fff" cx="0" cy="0" style="transform:translate(${a[0].toFixed(1)}px,${a[1].toFixed(1)}px);transition:transform .6s cubic-bezier(.2,.8,.2,1)"/></svg>`;
  }
  function makeCard(id) {
    const el = document.createElement('div'); el.className = 'ucard'; el.dataset.id = id;
    el.innerHTML = `<div class="uh"><span class="ico"></span><span class="cs"></span><button class="lead" title="Make this rider your lead (main follow-up)">★</button><span class="sp"></span><span class="tag ptt" style="font-size:8px"></span><span class="dot"></span></div>
      <div class="ubody"><div class="gwrap" title="Click the gauge to cycle: speed / heart rate / gradient">${gaugeSvg()}<div class="gval"><b>0.0</b><small>KM/H</small></div><div class="gmode">SPEED ▸</div></div>
      <div class="ustats"><div><div class="k">HEART</div><div class="v"><span class="hrp">♥</span> <span class="hv">--</span></div></div><div><div class="k">GRADE %</div><div class="v gv">--</div></div>
      <div><div class="k">REMAIN</div><div class="v rv">--</div></div><div><div class="k">ETA</div><div class="v ev">--:--</div></div></div></div>
      <div class="prog"></div><div class="usec"></div>`;
    const c = { el, mode: 0, refs: { ico: el.querySelector('.ico'), cs: el.querySelector('.cs'), ptt: el.querySelector('.ptt'), dot: el.querySelector('.dot'), vl: el.querySelector('.vl'), nd: el.querySelector('.nd'),
      gval: el.querySelector('.gval b'), gunit: el.querySelector('.gval small'), gmode: el.querySelector('.gmode'), hv: el.querySelector('.hv'), hrp: el.querySelector('.hrp'), gv: el.querySelector('.gv'), rv: el.querySelector('.rv'), ev: el.querySelector('.ev'), prog: el.querySelector('.prog'), usec: el.querySelector('.usec') }, sig: '' };
    el.onclick = () => selectUnit(id);
    c.refs.lead = el.querySelector('.lead');
    c.refs.lead.onclick = e => { e.stopPropagation(); const u = units.get(id); if (u) setLead(u.callsign === leadName ? null : u.callsign); };
    el.querySelector('.gwrap').onclick = e => { e.stopPropagation(); c.mode = (c.mode + 1) % 3; fx.tick(); updateCard(id); };
    const cu = id === 'self' ? null : units.get(id);
    UL.widget(el, { key: 'card:' + (id === 'self' ? 'self' : (cu && cu.callsign) || id), head: '.uh' });
    cards.set(id, c); return c;
  }
  function removeCard(id) { const c = cards.get(id); if (c) { c.el.remove(); cards.delete(id); } }
  function frac(mode, d) {
    if (mode === 0) return Math.max(0, Math.min(1, cfg.speed(d.speed || 0) / (cfg.v.units === 'imperial' ? cfg.v.gaugeMax * 0.621 : cfg.v.gaugeMax)));
    if (mode === 1) return Math.max(0, Math.min(1, ((d.hr || 0) - 40) / 160));
    return Math.max(0, Math.min(1, ((d.grade || 0) + 15) / 30));
  }
  function updateCard(id) {
    const u = id === 'self' ? selfUnit() : units.get(id), c = cards.get(id); if (!u || !c) return;
    const d = u.data || {}, r = c.refs, col = cfg.colorFor(u.callsign, u.color || myColor);
    const stale = id !== 'self' && Date.now() - (u.ts || 0) > 12000;
    c.el.classList.toggle('sel', sel === id); c.el.classList.toggle('stale', stale);
    c.el.classList.toggle('off', !!OFF.get(id)?.on); c.el.classList.toggle('leadcard', isLead(u));
    r.lead.style.display = u.role === 'rider' ? '' : 'none'; r.lead.classList.toggle('on', isLead(u));
    c.el.style.borderLeft = '3px solid ' + col;
    r.ico.innerHTML = UL.unitSvg(u.role, col, 0, 15);
    r.cs.style.color = col; r.cs.textContent = (id === 'self' ? 'YOU · ' : '') + u.callsign;
    r.ptt.textContent = id === 'self' ? '' : (keymap.get(id) ? 'PTT ' + UL.KEY_LABEL(keymap.get(id)) : '');
    r.dot.className = 'dot ' + (id === 'self' || !stale ? 'ok' : '');
    const f = frac(c.mode, d), v = ARC * (1 - f), a = pt(150 + 240 * f);
    r.vl.style.strokeDashoffset = v.toFixed(1);
    const zone = c.mode === 2 ? (d.grade > 6 ? 'var(--bad)' : d.grade > 3 ? 'var(--warn)' : 'var(--accent)') : (f > .85 ? 'var(--bad)' : f > .6 ? 'var(--warn)' : 'var(--accent)');
    r.vl.style.stroke = zone; r.vl.style.color = zone;
    r.nd.style.transform = `translate(${a[0].toFixed(1)}px,${a[1].toFixed(1)}px)`;
    if (c.mode === 0) { r.gval.textContent = d.speed == null ? '--' : fmtSpeed(d.speed); r.gunit.textContent = cfg.speedU(); r.gmode.textContent = 'SPEED ▸'; }
    else if (c.mode === 1) { r.gval.textContent = d.hr || '--'; r.gunit.textContent = 'BPM'; r.gmode.textContent = 'HEART RATE ▸'; }
    else { r.gval.textContent = d.grade == null ? '--' : (d.grade >= 0 ? '+' : '') + d.grade.toFixed(1); r.gunit.textContent = '% GRADE'; r.gmode.textContent = 'GRADIENT ▸'; }
    r.hv.textContent = d.hr || '--'; r.hrp.style.animationDuration = (d.hr ? 60 / d.hr : 1) + 's'; r.hrp.style.opacity = d.hr ? 1 : .25;
    r.gv.textContent = d.grade == null ? '--' : (d.grade >= 0 ? '+' : '') + d.grade.toFixed(1);
    r.rv.textContent = d.remaining == null ? '--' : cfg.dist(d.remaining).toFixed(1) + ' ' + cfg.distU().toLowerCase();
    r.ev.textContent = d.eta ? cfg.time(d.eta) : '--:--';
    /* sector-coloured progress */
    const sig = sectors.map(s => s.color + s.start).join('') + (route ? route.distance : 0);
    if (c.sig !== sig && route) { c.sig = sig; r.prog.innerHTML = sectors.map(s => `<i style="width:${(s.end - s.start) / route.distance * 100}%;background:${s.color}"></i>`).join('') + '<em></em>'; }
    const em = r.prog.querySelector('em'); if (em && route) em.style.left = Math.max(0, Math.min(100, (d.covered || 0) / route.distance * 100)) + '%';
    if (u.role === 'rider' && sectorTimer) {
      const st = sectorTimer.units.get(u.callsign), run = sectorTimer.running(u.callsign);
      if (st && st.cur >= 0 && run != null) {
        const s = sectors[st.cur], over = s.target && run > s.target;
        r.usec.innerHTML = `<i style="width:8px;height:8px;background:${s.color};display:inline-block"></i><span>${esc(s.name)}</span><b style="color:${over ? 'var(--bad)' : 'var(--fg)'}">${UL.hmsStr(run)}</b>${s.target ? `<span>/ ${UL.hmsStr(s.target)}</span>` : ''}`;
      } else if (st && st.times.length) {
        let li = st.times.length - 1; while (li > 0 && st.times[li] == null) li--;
        const s = sectors[li], t = st.times[li], dl = s && s.target ? t - s.target : null;
        r.usec.innerHTML = `<span style="color:var(--good)">✓</span><span>${esc(s.name)}</span><b>${UL.hmsStr(t)}</b>${dl != null ? `<span style="color:${dl <= 0 ? 'var(--good)' : 'var(--bad)'}">${dl <= 0 ? '−' : '+'}${UL.hmsStr(Math.abs(dl))}</span>` : ''}`;
      } else r.usec.innerHTML = '<span>AWAITING CHECKPOINT</span>';
    } else {
      const ld = id === 'self' ? leadName : d.lead;
      r.usec.innerHTML = ld ? `<span class="ltag">★ LEAD → ${esc(ld)}</span>` : '';
    }
    if (OFF.get(id)?.on) r.usec.innerHTML = `<b style="color:var(--bad)">⚠ OFF ROUTE ${Math.round(OFF.get(id).dist)} M</b>`;
  }
  function renderUnits() {
    if (!opsStarted) return;
    const order = ['self', ...sortedUnits().map(u => u.id)], host = $('units');
    order.forEach((id, i) => {
      let c = cards.get(id) || makeCard(id);
      if (host.children[i] !== c.el) host.insertBefore(c.el, host.children[i] || null);
      updateCard(id);
    });
    [...cards.keys()].forEach(id => { if (!order.includes(id)) removeCard(id); });
    $('uCount').textContent = units.size; $('tUnits').textContent = units.size + ' UNITS';
  }

  /* ===================================================== SELECTED WIDGET */
  function renderSel() {
    const u = sel === 'self' ? selfUnit() : units.get(sel);
    if (!u) { sel = 'self'; return renderSel(); }
    const d = u.data || {}, self = tel.state, col = cfg.colorFor(u.callsign, u.color);
    $('selName').innerHTML = `<span style="display:inline-block;vertical-align:-3px">${UL.unitSvg(u.role, col, 0, 16)}</span> ${esc(sel === 'self' ? 'SELF · ' + u.callsign : u.callsign)}`;
    $('selName').style.color = col;
    $('selKey').textContent = 'PTT ' + (sel === 'self' ? '—' : UL.KEY_LABEL(keymap.get(sel)));
    const S = v => v == null ? '--' : cfg.speed(v).toFixed(1), D = v => v == null ? '--' : cfg.dist(v).toFixed(2);
    const rows = [
      ['SPEED ' + cfg.speedU(), S(d.speed)], ['AVG ' + cfg.speedU(), S(d.avg)],
      ['DIST COVERED ' + cfg.distU(), D(d.covered)], ['DIST REMAINING ' + cfg.distU(), D(d.remaining)],
      ['GRADIENT %', UL.fmt.pct(d.grade)], ['ELEVATION ' + cfg.elevU(), d.ele == null ? '--' : Math.round(cfg.elev(d.ele))],
      ['ETA', d.eta ? cfg.time(d.eta) : '--:--'], ['TIME TO GO', UL.fmt.hms(d.etaSec)]
    ];
    if (sel !== 'self') {
      rows.push([(u.role === 'rider' ? 'DIST TO CYCLIST ' : 'DIST TO ESCORT ') + cfg.distU(), (d.lat != null && self.lat != null) ? D(UL.haversine({ lat: self.lat, lon: self.lon }, { lat: d.lat, lon: d.lon })) : '--']);
      rows.push(['HEART RATE BPM', d.hr ?? '--']);
      rows.push(['ROUTE GAP ' + cfg.distU(), (d.covered != null && self.covered != null) ? D(d.covered - self.covered) : '--']);
    } else if (d.hr) rows.push(['HEART RATE BPM', d.hr]);
    if (route && d.covered != null) { const s = UL.sectorAt(sectors, d.covered); rows.push(['SECTOR', `<span style="color:${s.color}">${esc(s.name)}</span>`]); }
    $('selKv').innerHTML = rows.map(r => `<div><div class="k">${r[0]}</div><div class="v">${r[1]}</div></div>`).join('');
    syncFollowBtn();
  }
  function syncFollowBtn() { $('btnFollow').className = follow ? 'primary' : 'ghost'; $('btnFollow').textContent = follow ? 'FOLLOWING' : 'FOLLOW'; }
  $('btnMon').onclick = () => {
    if (sel === 'self' || !voice) return;
    const u = units.get(sel); u.muted = !u.muted; voice.setMonitor(sel, !u.muted);
    $('btnMon').textContent = u.muted ? 'MONITOR OFF' : 'MONITOR ON'; $('btnMon').className = u.muted ? 'ghost danger' : 'ghost';
  };

  /* ================================================ WIND + DRAFTING POP-UP */
  const wsp = ms => cfg.v.units === 'imperial' ? (ms * 2.23694).toFixed(0) + ' MPH' : (ms * 3.6).toFixed(0) + ' KM/H';
  function unitWind(d) { return d && d.lat != null ? wind.at(d.lat, d.lon) : null; }
  function renderWindTag() {
    const u = sel === 'self' ? selfUnit() : units.get(sel), d = u && u.data, w = unitWind(d) || (route ? wind.at(route.points[0].lat, route.points[0].lon) : null);
    $('windTag').textContent = w ? 'WIND ' + wsp(w.speed) + ' ' + UL.compass(w.dir) + ' · ' + w.src : 'WIND ' + (wind.status === 'error' ? 'OFFLINE — SET MANUALLY' : '…');
    $('btnWind').className = 'ghost' + (w ? '' : ' danger');
  }
  function diagram(adv, col) {
    const rr = (deg, r) => [80 + r * Math.sin(deg * Math.PI / 180), 80 - r * Math.cos(deg * Math.PI / 180)];
    const [ax, ay] = rr(adv.beta, 68), [bx, by] = rr(adv.beta, 24), [tx, ty] = rr(adv.trueRel, 68), [ux, uy] = rr(adv.trueRel, 30);
    const north = rr(-(adv.headingUsed || 0), 72);
    const p = adv.pos;
    return `<svg viewBox="0 0 160 160" style="width:100%;max-width:220px;display:block;margin:0 auto">
      <circle cx="80" cy="80" r="70" fill="none" stroke="var(--line2)"/><circle cx="80" cy="80" r="46" fill="none" stroke="var(--line)" stroke-dasharray="2 4"/>
      <line x1="80" y1="6" x2="80" y2="154" stroke="var(--line)"/><line x1="6" y1="80" x2="154" y2="80" stroke="var(--line)"/>
      <text x="${north[0]}" y="${north[1] + 3}" font-size="8" fill="var(--dim)" text-anchor="middle">N</text>
      <ellipse cx="${80 + p[0]}" cy="${80 + p[1]}" rx="15" ry="11" fill="${adv.value === 'HIGH' ? '#7cff5a' : adv.value === 'MEDIUM' ? '#ffb000' : '#5d8794'}" fill-opacity=".22" stroke="${adv.value === 'HIGH' ? '#7cff5a' : adv.value === 'MEDIUM' ? '#ffb000' : '#5d8794'}" stroke-dasharray="3 2"/>
      <text x="${80 + p[0]}" y="${80 + p[1] + 3}" font-size="7" fill="var(--fg)" text-anchor="middle">COVER</text>
      <line x1="${tx}" y1="${ty}" x2="${ux}" y2="${uy}" stroke="var(--dim)" stroke-width="1.4" stroke-dasharray="3 3"/>
      <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="var(--warn)" stroke-width="2.6"/>
      <polygon points="${bx},${by} ${bx + 5 * Math.cos((adv.beta) * Math.PI / 180) - 6 * Math.sin(adv.beta * Math.PI / 180)},${by + 5 * Math.sin(adv.beta * Math.PI / 180) + 6 * Math.cos(adv.beta * Math.PI / 180)} ${bx - 5 * Math.cos(adv.beta * Math.PI / 180) - 6 * Math.sin(adv.beta * Math.PI / 180)},${by - 5 * Math.sin(adv.beta * Math.PI / 180) + 6 * Math.cos(adv.beta * Math.PI / 180)}" fill="var(--warn)"/>
      <polygon points="80,66 92,80 80,94 68,80" fill="${col}" stroke="#03090c" stroke-width="1.3"/><line x1="80" y1="66" x2="80" y2="52" stroke="${col}" stroke-width="2"/>
      <text x="80" y="14" font-size="7" fill="var(--dim)" text-anchor="middle">TRAVEL ▲</text></svg>`;
  }
  let popSig = '';
  function renderPop(force) {
    const pop = $('riderPop'), u = units.get(sel);
    $('map').classList.toggle('popopen', !!(u && u.role === 'rider' && !popOff));
    if (!u || u.role !== 'rider' || popOff) { if (pop.classList.contains('show')) { pop.classList.remove('in'); setTimeout(() => { if (!pop.classList.contains('in')) pop.classList.remove('show'); }, 300); } popSig = ''; return; }
    const d = u.data || {}, col = cfg.colorFor(u.callsign, u.color), hd = heading(d), w = unitWind(d);
    const adv = w ? UL.advise({ speed: d.speed, heading: hd, wind: w, grade: d.grade }) : null;
    if (adv) adv.headingUsed = hd;
    const S = v => v == null ? '--' : cfg.speed(v).toFixed(1), D = v => v == null ? '--' : cfg.dist(v).toFixed(2);
    const self = tel.state;
    let h = `<div class="ph"><span>${UL.unitSvg('rider', col, 0, 16)}</span><b style="letter-spacing:.16em;color:${col}">${esc(u.callsign)}</b><span class="sp"></span><span class="tag ${Date.now() - u.ts > 12000 ? 'bad' : 'ok'}">${Date.now() - u.ts > 12000 ? 'STALE' : 'LIVE'}</span><button class="ghost" id="popX" style="padding:2px 8px">✕</button></div><div class="pb">
      <div class="row" style="gap:6px;margin-bottom:8px"><button id="popLead" class="${isLead(u) ? 'primary' : 'ghost'}" style="flex:1;font-size:9px;padding:6px">${isLead(u) ? '★ LEAD RIDER' : '☆ SET AS LEAD'}</button><button id="popRet" class="ghost" style="flex:1;font-size:9px;padding:6px">◎ RETURN TO RIDER</button></div>
      <div class="pgrid"><div><div class="k">SPEED ${cfg.speedU()}</div><div class="v">${S(d.speed)}</div></div><div><div class="k">HEART BPM</div><div class="v">${d.hr ?? '--'}</div></div><div><div class="k">GRADE %</div><div class="v">${UL.fmt.pct(d.grade)}</div></div>
      <div><div class="k">ELEV ${cfg.elevU()}</div><div class="v">${d.ele == null ? '--' : Math.round(cfg.elev(d.ele))}</div></div><div><div class="k">REMAIN ${cfg.distU()}</div><div class="v">${D(d.remaining)}</div></div><div><div class="k">ETA</div><div class="v">${d.eta ? cfg.time(d.eta) : '--:--'}</div></div>
      <div><div class="k">DIST TO ME ${cfg.distU()}</div><div class="v">${(d.lat != null && self.lat != null) ? D(UL.haversine({ lat: self.lat, lon: self.lon }, { lat: d.lat, lon: d.lon })) : '--'}</div></div><div><div class="k">AVG ${cfg.speedU()}</div><div class="v">${S(d.avg)}</div></div><div><div class="k">COVERED ${cfg.distU()}</div><div class="v">${D(d.covered)}</div></div></div>
      <div class="psec">WIND ON RIDER</div>`;
    if (!adv) h += `<div class="hint" style="line-height:1.7">No wind data yet (${wind.status === 'error' ? 'wind service unreachable: ' + esc(wind.error) : 'loading…'}).<br><button class="ghost" id="popWind" style="margin-top:8px;width:100%">SET WIND MANUALLY</button></div>`;
    else {
      const hw = adv.head >= 0 ? 'HEADWIND' : 'TAILWIND', cw = adv.cross >= 0 ? 'RIGHT' : 'LEFT';
      h += diagram(adv, col) + `<div class="pgrid" style="margin-top:8px">
        <div><div class="k">TRUE WIND</div><div class="v" style="font-size:12px">${wsp(adv.trueSpeed)}</div></div>
        <div><div class="k">FROM</div><div class="v" style="font-size:12px">${UL.compass(adv.trueDir)} ${Math.round(adv.trueDir)}°</div></div>
        <div><div class="k">GUST</div><div class="v" style="font-size:12px">${wsp(adv.gust)}</div></div>
        <div><div class="k">HITTING FROM</div><div class="v" style="font-size:11px">${adv.relLabel}</div></div>
        <div><div class="k">APPARENT</div><div class="v" style="font-size:12px">${wsp(adv.appSpeed)}</div></div>
        <div><div class="k">${hw}</div><div class="v" style="font-size:12px;color:${adv.head >= 0 ? 'var(--bad)' : 'var(--good)'}">${wsp(Math.abs(adv.head))}</div></div>
        <div><div class="k">CROSS FROM ${cw}</div><div class="v" style="font-size:12px">${wsp(Math.abs(adv.cross))}</div></div>
        <div><div class="k">WIND COST</div><div class="v" style="font-size:12px;color:${adv.costW > 0 ? 'var(--bad)' : 'var(--good)'}">${adv.costW > 0 ? '+' : ''}${adv.costW} W</div></div>
        <div><div class="k">SOURCE</div><div class="v" style="font-size:12px">${adv.src}</div></div></div>
        <div class="psec">DRAFTING ADVICE</div>
        <div class="advice ${adv.value}"><b>${adv.zone}</b> · SHELTER ${adv.value}<br>${esc(adv.position)}</div>
        <ul class="notes">${adv.notes.map(n => '<li>' + esc(n) + '</li>').join('')}</ul>
        <div class="hint" style="margin-top:6px">Estimate: wind at ~1.2 m rider height, CdA 0.32 m². Green ring = where the rider should sit relative to the wheel ahead.</div>`;
    }
    if (route && sectors.length) {
      h += `<div class="psec">SECTORS</div>`;
      const st = sectorTimer && sectorTimer.units.get(u.callsign);
      const LT = mission.laps > 1 ? UL.lapTimes(sectors, st) : null;
      sectors.forEach((s, i) => {
        if (LT && s.li === 0) { const L = LT.find(x => x.lap === s.lap), d2 = L.time != null && L.target ? L.time - L.target : null;
          h += `<div class="seclr" style="margin-top:6px;border-top:1px solid var(--line2);padding-top:5px"><i style="background:transparent"></i><span style="color:var(--warn);letter-spacing:.18em">LAP ${s.lap}${L.current ? ' ▸' : ''}</span><b>${L.time != null ? UL.hmsStr(L.time) : L.part ? '▸ ' + UL.hmsStr(L.part) : '—'}</b><span style="color:${d2 == null ? 'var(--dim)' : d2 <= 0 ? 'var(--good)' : 'var(--bad)'}">${d2 != null ? (d2 <= 0 ? '−' : '+') + UL.hmsStr(Math.abs(d2)) : L.target ? 'TGT ' + UL.hmsStr(L.target) : ''}</span></div>`; }
        const t = st && st.times[i], run = st && st.cur === i ? sectorTimer.running(u.callsign) : null;
        const val = t != null ? UL.hmsStr(t) : run != null ? '▸ ' + UL.hmsStr(run) : '—';
        const dl = t != null && s.target ? t - s.target : null;
        h += `<div class="seclr"><i style="background:${s.color}"></i><span>${esc(LT ? s.base || s.name : s.name)}</span><b>${val}</b><span style="color:${dl == null ? 'var(--dim)' : dl <= 0 ? 'var(--good)' : 'var(--bad)'}">${dl != null ? (dl <= 0 ? '−' : '+') + UL.hmsStr(Math.abs(dl)) : (s.target ? 'TGT ' + UL.hmsStr(s.target) : '')}</span></div>`;
      });
    }
    h += '</div>';
    if (h === popSig && !force) return; popSig = h;
    const scroll = pop.querySelector('.pb') ? pop.querySelector('.pb').scrollTop : 0;
    pop.innerHTML = h;
    const pb = pop.querySelector('.pb'); if (pb) pb.scrollTop = scroll;
    if (!pop.classList.contains('show')) { pop.classList.add('show'); fx.open(); requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('in'))); } else pop.classList.add('in');
    UL.widget(pop, { key: 'riderpop', head: '.ph', before: '#popX' });
    const x = pop.querySelector('#popX'); if (x) x.onclick = () => { popOff = true; renderPop(true); fx.close(); };
    const pw = pop.querySelector('#popWind'); if (pw) pw.onclick = openWindDialog;
    pop.querySelector('#popLead').onclick = () => setLead(isLead(u) ? null : u.callsign);
    pop.querySelector('#popRet').onclick = () => returnTo(u.id);
  }

  function openWindDialog() {
    const m = wind.manual, u = sel === 'self' ? selfUnit() : units.get(sel), w = unitWind(u && u.data);
    const imp = cfg.v.units === 'imperial', cv = ms => (imp ? ms * 2.23694 : ms * 3.6);
    $('dlgWind').innerHTML = `<div style="padding:20px;width:min(420px,90vw)"><h3>WIND SOURCE</h3>
      <div class="hint" style="margin:8px 0 12px">Status: <b style="color:var(--fg)">${wind.source}</b> ${wind.status === 'error' ? '· model offline (' + esc(wind.error) + ')' : wind.samples.length ? '· ' + wind.samples.length + ' route sample points' : ''}.
      The model gives wind along the whole route (10 m height, scaled to rider height). Use manual entry if you are offline or have a local reading — it applies to the entire route.</div>
      <div class="fgrid"><div class="fld"><label>Speed (${imp ? 'mph' : 'km/h'})</label><input id="wS" type="number" min="0" max="120" step="0.5" value="${(m ? cv(m.speed) : w ? cv(w.speed) : 0).toFixed(1)}"></div>
      <div class="fld"><label>Blowing FROM (° / compass)</label><input id="wD" type="number" min="0" max="360" value="${Math.round(m ? m.dir : w ? w.dir : 0)}"></div></div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((c, i) => `<button class="ghost" data-c="${i * 45}" style="padding:4px 9px;font-size:10px">${c}</button>`).join('')}</div>
      <div class="row" style="margin-top:14px;gap:8px"><button class="primary" id="wApply" style="flex:1">APPLY MANUAL</button><button class="ghost" id="wModel" style="flex:1">USE MODEL</button></div>
      <button class="ghost" id="wRef" style="width:100%;margin-top:8px">REFRESH MODEL NOW</button></div>`;
    $('dlgWind').showModal(); fx.open();
    $('dlgWind').querySelectorAll('[data-c]').forEach(b => b.onclick = () => $('wD').value = b.dataset.c);
    $('wApply').onclick = () => { const s = +$('wS').value; wind.setManual(imp ? s / 2.23694 : s / 3.6, ((+$('wD').value % 360) + 360) % 360); $('dlgWind').close(); fx.save(); log('WIND', 'MANUAL WIND SET ' + wsp(wind.manual.speed) + ' FROM ' + Math.round(wind.manual.dir) + '°', '#ffb000'); };
    $('wModel').onclick = () => { wind.setManual(null); $('dlgWind').close(); wind.loadRoute(route, true); };
    $('wRef').onclick = () => { wind.loadRoute(route, true); UL.toast('REFRESHING WIND MODEL…'); };
  }

  /* ===================================================== SECTOR BOARD */
  let boardTimer = null;
  function openBoard() {
    if (mission && mission.laps > 1) return openLapBoard();
    const draw = () => {
      const riders = sortedUnits().filter(u => u.role === 'rider');
      const head = sectors.map(s => `<th style="border-bottom:3px solid ${s.color};padding:6px 8px;font-size:9px;letter-spacing:.12em">${esc(s.name)}<br><span class="muted">${((s.end - s.start) / 1000).toFixed(1)} km${s.target ? ' · TGT ' + UL.hmsStr(s.target) : ''}</span></th>`).join('');
      const rows = riders.map(u => {
        const st = sectorTimer.units.get(u.callsign);
        let tot = 0;
        const cells = sectors.map((s, i) => {
          const t = st && st.times[i], run = st && st.cur === i ? sectorTimer.running(u.callsign) : null;
          if (t != null) { tot += t; const dl = s.target ? t - s.target : null; return `<td style="padding:6px 8px;text-align:center"><b>${UL.hmsStr(t)}</b>${dl != null ? `<br><span style="font-size:9px;color:${dl <= 0 ? 'var(--good)' : 'var(--bad)'}">${dl <= 0 ? '−' : '+'}${UL.hmsStr(Math.abs(dl))}</span>` : ''}</td>`; }
          if (run != null) return `<td style="padding:6px 8px;text-align:center;color:var(--warn)">▸ ${UL.hmsStr(run)}</td>`;
          return '<td style="padding:6px 8px;text-align:center" class="muted">—</td>';
        }).join('');
        return `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px;color:${cfg.colorFor(u.callsign, u.color)};font-weight:600;letter-spacing:.12em">${esc(u.callsign)}</td>${cells}<td style="padding:6px 8px;text-align:center"><b>${tot ? UL.hmsStr(tot) : '—'}</b></td></tr>`;
      }).join('') || `<tr><td colspan="${sectors.length + 2}" class="muted" style="padding:16px;text-align:center">No riders connected yet.</td></tr>`;
      $('dlgBoard').innerHTML = `<div style="padding:18px"><div class="row"><h3>SECTOR BOARD</h3><span class="sp"></span><span class="hint">Times start at each checkpoint and stop at the next.</span></div>
        <div style="overflow:auto;margin-top:12px"><table style="width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums"><tr><th style="text-align:left;padding:6px 8px;font-size:9px;color:var(--dim)">RIDER</th>${head}<th style="font-size:9px;color:var(--dim)">TOTAL</th></tr>${rows}</table></div>
        <button style="margin-top:14px" onclick="this.closest('dialog').close()">CLOSE</button></div>`;
    };
    draw(); $('dlgBoard').showModal(); fx.open();
    clearInterval(boardTimer); boardTimer = setInterval(() => { if ($('dlgBoard').open) draw(); else clearInterval(boardTimer); }, 1000);
  }

  /* lap sessions: one table per rider — a row per lap, a column per sector, then the lap time vs the lap target */
  function openLapBoard() {
    const base = sectors.filter(s => s.lap === 1), cell = 'padding:6px 8px;text-align:center';
    const dlt = (t, tg) => { const d = t != null && tg ? t - tg : null; return d == null ? '' : `<br><span style="font-size:9px;color:${d <= 0 ? 'var(--good)' : 'var(--bad)'}">${d <= 0 ? '−' : '+'}${UL.hmsStr(Math.abs(d))}</span>`; };
    const draw = () => {
      const riders = sortedUnits().filter(u => u.role === 'rider');
      const head = `<tr><th style="text-align:left;padding:6px 8px;font-size:9px;color:var(--dim)">LAP</th>${base.map(s => `<th style="border-bottom:3px solid ${s.color};padding:6px 8px;font-size:9px;letter-spacing:.12em">${esc(s.base || s.name)}<br><span class="muted">${((s.end - s.start) / 1000).toFixed(1)} km</span></th>`).join('')}<th style="font-size:9px;color:var(--warn);letter-spacing:.14em">LAP TIME</th></tr>`;
      const body = riders.map(u => {
        const st = sectorTimer.units.get(u.callsign), LT = UL.lapTimes(sectors, st);
        const rows = LT.map(L => `<tr style="border-top:1px solid var(--line)${L.current ? ';background:rgba(255,176,0,.07)' : ''}"><td style="padding:6px 8px;color:var(--warn);letter-spacing:.14em;white-space:nowrap">LAP ${L.lap}${L.current ? ' ▸' : ''}</td>${L.idx.map(i => {
            const s = sectors[i], t = st && st.times[i], run = st && st.cur === i ? sectorTimer.running(u.callsign) : null;
            if (t != null) return `<td style="${cell}"><b>${UL.hmsStr(t)}</b>${dlt(t, s.target)}</td>`;
            if (run != null) return `<td style="${cell};color:var(--warn)">▸ ${UL.hmsStr(run)}${s.target ? `<br><span class="muted" style="font-size:9px">TGT ${UL.hmsStr(s.target)}</span>` : ''}</td>`;
            return `<td style="${cell}" class="muted">—${s.target ? `<br><span style="font-size:9px">TGT ${UL.hmsStr(s.target)}</span>` : ''}</td>`;
          }).join('')}<td style="${cell}"><b>${L.time != null ? UL.hmsStr(L.time) : '—'}</b>${L.time != null ? dlt(L.time, L.target) : L.target ? `<br><span class="muted" style="font-size:9px">TGT ${UL.hmsStr(L.target)}</span>` : ''}</td></tr>`).join('');
        const tot = LT.every(L => L.time != null) ? LT.reduce((a, L) => a + L.time, 0) : null;
        return `<div style="margin-top:14px"><div class="row"><b style="color:${cfg.colorFor(u.callsign, u.color)};letter-spacing:.14em">${esc(u.callsign)}</b><span class="sp"></span><span class="hint">TOTAL ${tot != null ? UL.hmsStr(tot) : '—'}${mission.targetSec ? ' · TARGET ' + UL.hmsStr(mission.targetSec) : ''}</span></div>
          <div style="overflow:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums">${head}${rows}</table></div></div>`;
      }).join('') || '<div class="muted" style="padding:16px;text-align:center">No riders connected yet.</div>';
      $('dlgBoard').innerHTML = `<div style="padding:18px"><div class="row" style="flex-wrap:wrap"><h3>SECTOR BOARD · ${mission.laps} LAPS</h3><span class="sp"></span><span class="hint">Sector times and targets lap by lap.</span></div>${body}
        <button style="margin-top:14px" onclick="this.closest('dialog').close()">CLOSE</button></div>`;
    };
    draw(); $('dlgBoard').showModal(); fx.open();
    clearInterval(boardTimer); boardTimer = setInterval(() => { if ($('dlgBoard').open) draw(); else clearInterval(boardTimer); }, 1000);
  }

  /* ================================================ ELEVATION / ICON GRAPH */
  const G = { zoomed: false, win: 3000, v0: 0, v1: 1, lo: 0, hi: 1, init: false, hover: null, icons: [], last: 0 };
  function initGraph() {
    G.win = cfg.v.graphWindow * 1000; G.v0 = 0; G.v1 = route ? route.distance : 1;
    const cv = $('graph');
    const localX = e => e.clientX - cv.getBoundingClientRect().left;
    cv.onmousemove = e => {
      const x = localX(e), y = e.clientY - cv.getBoundingClientRect().top;
      G.hover = x;
      const hit = G.icons.some(i => Math.hypot(i.x - x, i.y - y) < 16);
      cv.style.cursor = hit ? 'pointer' : 'crosshair';
      const tip = $('gtip');
      if (route) {
        const d = G.v0 + x / cv.clientWidth * (G.v1 - G.v0), r = UL.routeAt(route, d), s = UL.sectorAt(sectors, d), w = wind.at(r.lat, r.lon);
        const hc = w ? UL.headComponent(w, r.bearing) : null;
        tip.style.display = 'block'; tip.style.left = Math.min(x + 12, cv.clientWidth - 190) + 'px'; tip.style.top = '30px';
        tip.innerHTML = `${cfg.dist(d).toFixed(2)} ${cfg.distU()} · ${Math.round(cfg.elev(r.ele))} ${cfg.elevU()} · ${UL.fmt.pct(r.grade)}%<br><span style="color:${s.color}">${esc(s.name)}</span>${hc != null ? ` · ${hc >= 0 ? 'HEAD' : 'TAIL'} ${wsp(Math.abs(hc))}` : ''}`;
      }
    };
    cv.onmouseleave = () => { G.hover = null; $('gtip').style.display = 'none'; };
    cv.onclick = e => {
      const x = localX(e), y = e.clientY - cv.getBoundingClientRect().top;
      let best = null, bd = 18;
      G.icons.forEach(i => { const dd = Math.hypot(i.x - x, i.y - y); if (dd < bd) { bd = dd; best = i; } });
      if (best) selectUnit(best.id);
    };
    cv.onwheel = e => { e.preventDefault(); zoomGraph(e.deltaY < 0 ? 0.7 : 1.45); };
    $('gIn').onclick = () => zoomGraph(0.6); $('gOut').onclick = () => zoomGraph(1.6);
    $('gFull').onclick = () => { G.zoomed = false; fx.tick(); };
    requestAnimationFrame(function loop(t) { if (t - G.last > 45) { G.last = t; if (opsStarted) drawGraph(); } requestAnimationFrame(loop); });
  }
  function zoomGraph(f) { if (!route) return; G.zoomed = true; G.win = Math.max(400, Math.min(route.distance, G.win * f)); fx.tick(); }
  function gTargets() {
    if (!route) return [0, 1];
    if (!G.zoomed) return [0, route.distance];
    const u = sel === 'self' ? selfUnit() : units.get(sel), c = u && u.data && u.data.covered != null ? u.data.covered : route.distance / 2;
    const win = Math.min(G.win, route.distance); let a = c - win / 2, b = c + win / 2;
    if (a < 0) { b -= a; a = 0; } if (b > route.distance) { a -= b - route.distance; b = route.distance; }
    return [Math.max(0, a), b];
  }
  function drawGraph() {
    const cv = $('graph'); if (!cv || !route) return;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const [t0, t1] = gTargets();
    G.v0 += (t0 - G.v0) * 0.2; G.v1 += (t1 - G.v1) * 0.2;
    if (Math.abs(t0 - G.v0) < 0.5) G.v0 = t0; if (Math.abs(t1 - G.v1) < 0.5) G.v1 = t1;
    const v0 = G.v0, v1 = G.v1, span = Math.max(50, v1 - v0), P = route.points;
    const vis = P.filter(p => p.d >= v0 - span * 0.03 && p.d <= v1 + span * 0.03);
    let lo = Infinity, hi = -Infinity; vis.forEach(p => { if (p.ele < lo) lo = p.ele; if (p.ele > hi) hi = p.ele; });
    if (!isFinite(lo)) { const r = UL.routeAt(route, (v0 + v1) / 2); lo = r.ele - 5; hi = r.ele + 5; }
    const pad = Math.max(3, (hi - lo) * 0.12); lo -= pad; hi += pad * 1.4;
    if (!G.init) { G.lo = lo; G.hi = hi; G.init = true; } else { G.lo += (lo - G.lo) * 0.2; G.hi += (hi - G.hi) * 0.2; }
    const top = cfg.v.windBand ? 24 : 10, bot = 16;
    const X = d => (d - v0) / span * w, Y = e => h - bot - (e - G.lo) / (G.hi - G.lo) * (h - bot - top - 10);
    const acc = cfg.v.accent;
    /* grid */
    const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000]; const step = steps.find(s => span / s <= 9) || 50000;
    x.font = '9px monospace'; x.lineWidth = 1;
    for (let d = Math.ceil(v0 / step) * step; d <= v1; d += step) { const px = X(d); x.strokeStyle = 'rgba(0,229,255,.08)'; x.beginPath(); x.moveTo(px, top); x.lineTo(px, h - bot); x.stroke(); x.fillStyle = '#5d8794'; x.fillText(cfg.dist(d).toFixed(step < 1000 ? 2 : 1), px + 3, h - 4); }
    for (let i = 0; i <= 3; i++) { const e = G.lo + (G.hi - G.lo) * (0.1 + i * 0.28), py = Y(e); x.strokeStyle = 'rgba(0,229,255,.06)'; x.beginPath(); x.moveTo(0, py); x.lineTo(w, py); x.stroke(); x.fillStyle = '#5d8794'; x.fillText(Math.round(cfg.elev(e)) + cfg.elevU().toLowerCase(), 4, py - 2); }
    /* sector-coloured profile */
    sectors.forEach(s => {
      if (s.end < v0 || s.start > v1) return;
      const pts = P.filter(p => p.d >= s.start - 1 && p.d <= s.end + 1); if (pts.length < 2) return;
      x.beginPath(); x.moveTo(X(pts[0].d), h - bot);
      pts.forEach(p => x.lineTo(X(p.d), Y(p.ele)));
      x.lineTo(X(pts[pts.length - 1].d), h - bot); x.closePath(); x.fillStyle = s.color + '38'; x.fill();
      x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p.d), Y(p.ele)) : x.moveTo(X(p.d), Y(p.ele))); x.strokeStyle = s.color; x.lineWidth = 2; x.stroke();
    });
    /* checkpoints */
    sectors.forEach(s => {
      if (s.start < v0 || s.start > v1) return;
      const px = X(s.start); x.strokeStyle = 'rgba(255,255,255,.55)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px, top - 2); x.lineTo(px, h - bot); x.stroke(); x.setLineDash([]);
      x.fillStyle = s.color; x.fillText(UL.cpLabel(s), px + 3, top + 8);
    });
    /* wind band */
    if (cfg.v.windBand && (wind.samples.length || wind.manual)) {
      for (let px = 0; px < w; px += 4) {
        const r = UL.routeAt(route, v0 + (px + 2) / w * span), wv = wind.at(r.lat, r.lon); if (!wv) continue;
        const hc = UL.headComponent(wv, r.bearing), a = Math.min(0.9, 0.15 + Math.abs(hc) / 8 * 0.75);
        x.fillStyle = hc >= 0 ? `rgba(255,77,109,${a})` : `rgba(124,255,90,${a})`; x.fillRect(px, 4, 4, 6);
      }
      x.fillStyle = '#5d8794'; x.fillText('WIND  ■ HEAD  ■ TAIL', 4, 20);
    }
    /* unit icons on the profile */
    G.icons = [];
    const all = [selfUnit(), ...sortedUnits()];
    let k = 0;
    all.forEach(u => {
      const d = u.data && u.data.covered; if (d == null || d < v0 - span * 0.02 || d > v1 + span * 0.02) return;
      const r = UL.routeAt(route, d), px = X(d), py = Y(r.ele), col = cfg.colorFor(u.callsign, u.color || myColor), isSel = sel === u.id;
      if (isSel) { x.strokeStyle = col; x.globalAlpha = .55; x.lineWidth = 1; x.beginPath(); x.moveTo(px, top); x.lineTo(px, h - bot); x.stroke(); x.globalAlpha = 1; }
      x.beginPath();
      if (u.role === 'rider') { x.moveTo(px, py - 8); x.lineTo(px + 6, py); x.lineTo(px, py + 8); x.lineTo(px - 6, py); }
      else { x.moveTo(px - 7, py - 6); x.lineTo(px + 7, py - 6); x.lineTo(px, py + 7); }
      x.closePath(); x.fillStyle = col; x.fill(); x.strokeStyle = '#03090c'; x.lineWidth = 1.4; x.stroke();
      if (isSel) { x.strokeStyle = '#fff'; x.lineWidth = 1.2; x.beginPath(); x.arc(px, py, 12 + Math.sin(Date.now() / 250) * 1.5, 0, 7); x.stroke(); }
      const ly = py - 13 - (k++ % 2) * 11; x.font = '600 9px monospace'; x.fillStyle = col;
      x.fillText((u.id === 'self' ? '● ' : '') + u.callsign + (isSel ? ` · ${UL.fmt.pct(r.grade)}% · ${Math.round(cfg.elev(r.ele))}${cfg.elevU().toLowerCase()}` : ''), Math.min(px + 8, w - 130), Math.max(top + 14, ly));
      G.icons.push({ id: u.id, x: px, y: py });
    });
    if (G.hover != null) { x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(G.hover, top); x.lineTo(G.hover, h - bot); x.stroke(); }
    $('gwin').textContent = G.zoomed ? (cfg.dist(Math.min(G.win, route.distance)).toFixed(1) + ' ' + cfg.distU() + ' WINDOW') : 'FULL ROUTE';
  }

  /* ================================================== VOICE + PTT KEYS */
  function initVoice() {
    let mode = 'auto'; try { mode = localStorage.ulVoice === 'relay' ? 'relay' : 'auto'; } catch (e) {}
    voice = new UL.VoiceNet(link, { mode });
    voice.selfId = me;
    voice.on('blocked', () => $('audioPrompt').classList.add('show'));
    voice.on('unblocked', () => $('audioPrompt').classList.remove('show'));
    voice.on('micerror', e => { log('SYS', 'MIC UNAVAILABLE — ' + (e || 'DENIED') + ' · PTT TX OFF', '#ff4d6d'); UL.toast('MICROPHONE BLOCKED — ALLOW IT IN THE BROWSER', 'bad', 5000); });
    const seen = new Map();
    voice.on('state', s => {
      const u = units.get(s.id); if (!u || seen.get(s.id) === s.state) return; seen.set(s.id, s.state);
      if (s.state === 'connected') log('NET', `${u.callsign} VOICE LINK UP (P2P)`, '#7cff5a');
      if (s.state === 'failed') log('NET', `${u.callsign} P2P BLOCKED — VOICE VIA RELAY`, '#ffb000');
    });
    $('audioPrompt').onclick = () => { voice.audioCtx(); $('audioPrompt').classList.remove('show'); };
    voice.mic().catch(() => log('SYS', 'MIC DENIED — PTT TX DISABLED', '#ff4d6d'));
    voice.sync([...units.keys()]);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || ended) return; link.kick(); voice.audioCtx(); voice.recover().then(f => f && UL.toast('MICROPHONE RESTORED', 'ok')); });
    $('netq').insertAdjacentHTML('beforebegin', '<span id="vq" class="tag" title="Voice path: peer-to-peer links / relay fallback">VOICE …</span>');
  }
  function setVoiceMode(mode) {
    try { localStorage.ulVoice = mode; } catch (e) {}
    if (!voice) return;
    voice.mode = mode;
    if (mode === 'relay') [...voice.peers.keys()].forEach(id => voice.dropPeer(id)); else voice.sync([...units.keys()]);
  }
  function voiceTag() {
    if (!voice || !$('vq')) return;
    const s = voice.summary();
    $('vq').textContent = !s.mic ? 'MIC OFF' : s.mode === 'relay' ? 'VOICE RELAY' : 'VOICE P2P ' + s.p2p + '/' + s.total;
    $('vq').className = 'tag ' + (!s.mic ? 'bad' : s.total && s.p2p < s.total ? '' : 'ok');
  }
  function assignKeys() {
    keymap = new Map(); const slots = cfg.v.keys.units;
    sortedUnits().forEach((u, i) => { if (i < slots.length) keymap.set(u.id, slots[i]); });
  }
  addEventListener('keydown', e => {
    if (!opsStarted || e.repeat || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || captureTarget || document.querySelector('dialog[open]')) return;
    const K = cfg.v.keys;
    if (e.code === K.pttAll) { e.preventDefault(); return txStart('all', 'ALL UNITS'); }
    const id = [...keymap.entries()].find(([, k]) => k === e.code)?.[0];
    if (id) { e.preventDefault(); return txStart([id], units.get(id).callsign); }
    if (e.code === K.master) { e.preventDefault(); return masterAck(); }
    if (e.code === K.returnLead) { e.preventDefault(); return returnTo(); }
    if (e.code === K.refreshGps) { e.preventDefault(); return refreshGps(); }
    if (e.code === 'Escape' && opsSec != null) return closeOpsSector();
    if (e.code === K.follow) { follow = !follow; syncFollowBtn(); }
    else if (e.code === K.settings) { $('dlgSet').showModal(); }
    else if (e.code === K.clock) { $('btnClock').click(); }
    else if (e.code === K.layer) { const ks = Object.keys(LAYERS), i = ks.indexOf(cfg.v.mapLayer); setLayer(ks[(i + 1) % ks.length]); fx.tick(); }
  });
  addEventListener('keyup', e => {
    if (!opsStarted) return;
    const K = cfg.v.keys;
    if (e.code === K.pttAll || K.units.includes(e.code)) txEnd();
  });
  function txStart(targets, label) {
    if (pttOpen || !voice) return;
    pttOpen = true; fx.pttOpen(); $('pttBtn').classList.add('on'); $('map').classList.add('tx');
    voice.transmit(targets, 140);        // sends the PTT banner now, opens the mic just after the key beep (so the beep is not transmitted)
    $('txbanner').style.display = 'block'; $('txbanner').textContent = '◉ TX → ' + label;
    $('txbanner').style.borderColor = '#ffb000'; $('txbanner').style.color = '#ffb000';
    log('TX', '→ ' + label, '#ffb000');
  }
  function txEnd() {
    if (!pttOpen) return;
    pttOpen = false; voice.release(); fx.pttClose(); $('pttBtn').classList.remove('on'); $('map').classList.remove('tx');
    if (!rxCount) $('txbanner').style.display = 'none';
  }
  $('btnKeys').onclick = () => {
    const rows = [...keymap.entries()].map(([id, k]) => `<tr><td style="color:${units.get(id)?.color}">${UL.KEY_LABEL(k)}</td><td>${esc(units.get(id)?.callsign)}</td></tr>`).join('');
    $('dlgKeys').innerHTML = `<div style="padding:18px"><h3 style="margin-bottom:12px">PTT KEYMAP</h3>
      <table style="width:100%;font-size:12px;line-height:1.9"><tr><td style="color:var(--warn)">${UL.KEY_LABEL(cfg.v.keys.pttAll)}</td><td>ALL UNITS (NET-WIDE)</td></tr>${rows}
      <tr><td style="color:var(--dim)">${UL.KEY_LABEL(cfg.v.keys.follow)}</td><td>TOGGLE FOLLOW</td></tr><tr><td style="color:var(--dim)">${UL.KEY_LABEL(cfg.v.keys.clock)}</td><td>MISSION CLOCK START/STOP</td></tr>
      <tr><td style="color:var(--dim)">${UL.KEY_LABEL(cfg.v.keys.layer)}</td><td>CYCLE MAP LAYER</td></tr><tr><td style="color:var(--dim)">${UL.KEY_LABEL(cfg.v.keys.settings)}</td><td>SETTINGS</td></tr></table>
      <div class="hint" style="margin-top:10px">Hold the key to transmit, release to stop. Keys reassign as units join. Rebind them in Settings → Keybinds.</div>
      <button style="margin-top:14px" onclick="this.closest('dialog').close()">CLOSE</button></div>`;
    $('dlgKeys').showModal(); fx.open();
  };

  /* ===================================================== SETTINGS PANEL */
  let captureTarget = null;
  function buildSettings() {
    $('setTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
      $('setTabs').querySelectorAll('button').forEach(x => x.className = ''); b.className = 'primary'; renderSettings(b.dataset.t);
    });
    $('setReset').onclick = async () => { if (await UL.confirm('RESET SETTINGS', 'Reset every appearance, audio and keybinding setting to defaults?', { danger: true, yes: 'RESET' })) { cfg.reset(); applyLiveSettings(); renderSettings('appearance'); } };
    renderSettings('appearance');
  }
  const row = (label, control) => `<div class="srow"><label>${label}</label>${control}</div>`;
  function renderSettings(tab) {
    const v = cfg.v; let h = '';
    if (tab === 'appearance') {
      h += row('Appearance <span class="muted">DARK = original · ARCTIC = dark-grey text on light-grey widgets</span>', `<select data-s="theme">${UL.themeOptions(v.theme)}</select>`);
      h += row('Accent colour', `<input type="color" data-s="accent" value="${v.accent}">`);
      h += row('Warning colour', `<input type="color" data-s="warn" value="${v.warn}">`);
      h += row('Alert colour', `<input type="color" data-s="bad" value="${v.bad}">`);
      h += row('Good colour', `<input type="color" data-s="good" value="${v.good}">`);
      h += row('Panel opacity <span class="muted">' + v.panelOpacity + '%</span>', `<input type="range" min="30" max="100" data-s="panelOpacity" value="${v.panelOpacity}">`);
      h += row('Interface scale <span class="muted">' + v.fontScale + '%</span>', `<input type="range" min="80" max="140" step="5" data-s="fontScale" value="${v.fontScale}">`);
      h += row('Map label size <span class="muted">' + v.labelScale + '%</span>', `<input type="range" min="70" max="180" step="10" data-s="labelScale" value="${v.labelScale}">`);
      h += row('Marker size <span class="muted">' + v.markerScale + '%</span>', `<input type="range" min="70" max="200" step="10" data-s="markerScale" value="${v.markerScale}">`);
      h += row('Speed gauge full scale <span class="muted">' + v.gaugeMax + ' km/h</span>', `<input type="range" min="30" max="120" step="5" data-s="gaugeMax" value="${v.gaugeMax}">`);
      h += row('CRT scanlines', `<input type="checkbox" data-s="scanlines" ${v.scanlines ? 'checked' : ''}>`);
      h += row('Corner accents', `<input type="checkbox" data-s="cornerAccents" ${v.cornerAccents ? 'checked' : ''}>`);
    }
    if (tab === 'audio') {
      h += row('Radio &amp; alert sounds (PTT beeps, checkpoints, alerts)', `<input type="checkbox" data-s="sound" ${v.sound ? 'checked' : ''}>`);
      h += row('Interface sounds (clicks, panels)', `<input type="checkbox" data-s="uiSounds" ${v.uiSounds ? 'checked' : ''}>`);
      h += row('Master volume <span class="muted">' + v.volume + '%</span>', `<input type="range" min="0" max="100" step="5" data-s="volume" value="${v.volume}">`);
      h += `<div class="sub" style="margin:14px 0 8px">TEST SOUNDS</div><div class="row" style="flex-wrap:wrap;gap:6px">` +
        [['pttOpen', 'RADIO KEY'], ['pttClose', 'RADIO RELEASE'], ['rxOpen', 'INCOMING'], ['checkpoint', 'CHECKPOINT'], ['sectorDone', 'SECTOR DONE'], ['countdown', 'COUNTDOWN'], ['go', 'GO'], ['alert', 'ALERT']]
          .map(([f, l]) => `<button class="ghost" data-fx="${f}" style="font-size:9px;padding:6px 9px" data-nosnd="1">${l}</button>`).join('') + '</div>';
      const vs = voice ? voice.summary() : null;
      h += `<div class="sub" style="margin:14px 0 8px">VOICE PATH</div>`;
      h += row('Route PTT audio', `<select id="sVoice"><option value="auto" ${!voice || voice.mode !== 'relay' ? 'selected' : ''}>Auto — peer-to-peer, relay fallback</option><option value="relay" ${voice && voice.mode === 'relay' ? 'selected' : ''}>Relay only (strict firewalls / hotspots)</option></select>`);
      h += `<div class="hint" style="margin-top:6px">${vs ? `Mic: <b>${vs.mic ? 'READY' : 'OFF' + (vs.micError ? ' — ' + esc(vs.micError) : '')}</b> · ${vs.p2p} of ${vs.total} units on direct P2P, ${vs.relay} via relay.` : 'Status appears once the mission is live.'} Auto mode switches a unit to the relay by itself when a direct link cannot be made.</div>`;
    }
    if (tab === 'keys') {
      h += `<div class="hint" style="margin-bottom:8px">Click a key, then press the key you want. Unit slots are assigned in roster order: riders first, then escorts.</div>`;
      [['pttAll', 'PTT — all units'], ['follow', 'Toggle follow'], ['returnLead', 'Return to lead rider'], ['refreshGps', 'Refresh live GPS (all units)'], ['master', 'Master alert (acknowledge off-route)'], ['clock', 'Mission clock start/stop'], ['layer', 'Cycle map layer'], ['settings', 'Open settings']].forEach(([k, lbl]) => h += row(lbl, `<div class="keycap" data-k="${k}">${UL.KEY_LABEL(v.keys[k])}</div>`));
      h += `<div class="sub" style="margin:14px 0 6px">PTT UNIT SLOTS</div>`;
      v.keys.units.forEach((code, i) => { const u = sortedUnits()[i]; h += row('Slot ' + (i + 1) + (u ? ' <span style="color:' + u.color + '">· ' + esc(u.callsign) + '</span>' : ' <span class="muted">· unassigned</span>'), `<div class="keycap" data-ku="${i}">${UL.KEY_LABEL(code)}</div>`); });
    }
    if (tab === 'map') {
      h += row('Default map layer', `<select data-s="mapLayer">${Object.keys(LAYERS).map(k => `<option ${v.mapLayer === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`);
      h += row('Tactical grid overlay', `<input type="checkbox" data-s="gridOverlay" ${v.gridOverlay ? 'checked' : ''}>`);
      h += row('Zoom level when following <span class="muted">' + v.zoomFollow + '</span>', `<input type="range" min="12" max="19" data-s="zoomFollow" value="${v.zoomFollow}">`);
      h += row('Graph window when homing in <span class="muted">' + v.graphWindow + ' km</span>', `<input type="range" min="1" max="20" step="1" data-s="graphWindow" value="${v.graphWindow}">`);
      h += row('Snap units onto the route line (when within 30 m)', `<input type="checkbox" data-s="snapRoute" ${v.snapRoute !== false ? 'checked' : ''}>`);
      h += row('Off-route alert distance <span class="muted">' + v.offRouteM + ' m</span>', `<input type="range" min="20" max="300" step="10" data-s="offRouteM" value="${v.offRouteM}">`);
      h += row('Wind band on elevation graph', `<input type="checkbox" data-s="windBand" ${v.windBand ? 'checked' : ''}>`);
      h += row('Motion trail length <span class="muted">' + v.trailLength + ' pts</span>', `<input type="range" min="50" max="2000" step="50" data-s="trailLength" value="${v.trailLength}">`);
      h += row('Units', `<select data-s="units"><option value="metric" ${v.units === 'metric' ? 'selected' : ''}>metric (km/h, km, m)</option><option value="imperial" ${v.units === 'imperial' ? 'selected' : ''}>imperial (mph, mi, ft)</option></select>`);
      h += row('Clock', `<select data-s="clock"><option value="local" ${v.clock === 'local' ? 'selected' : ''}>local time</option><option value="zulu" ${v.clock === 'zulu' ? 'selected' : ''}>zulu / UTC</option></select>`);
    }
    if (tab === 'units') {
      const list = sortedUnits();
      h += `<div class="hint" style="margin-bottom:8px">Override the auto-assigned colour of any unit. Applies to its marker, label, card and graph icon.</div>`;
      if (!list.length) h += `<div class="muted" style="font-size:11px">No units connected yet.</div>`;
      list.forEach(u => h += row(`<span class="swatch" style="background:${cfg.colorFor(u.callsign, u.color)}"></span> ${esc(u.callsign)} <span class="muted">${u.role}</span>`,
        `<input type="color" data-uc="${esc(u.callsign)}" value="${cfg.colorFor(u.callsign, u.color)}"><button class="ghost" data-ucr="${esc(u.callsign)}" style="font-size:9px;padding:5px 7px">AUTO</button>`));
    }
    $('setBody').innerHTML = h;
    $('setBody').querySelectorAll('[data-s]').forEach(el => {
      const key = el.dataset.s;
      const handler = () => {
        const val = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? +el.value : el.value);
        cfg.set(key, val); applyLiveSettings();
        if (el.type === 'range' || el.tagName === 'SELECT') renderSettings(tab);
      };
      el.oninput = el.type === 'range' || el.type === 'color' ? handler : null; el.onchange = handler;
    });
    const sv = $('sVoice'); if (sv) sv.onchange = () => { setVoiceMode(sv.value); UL.toast('VOICE PATH: ' + (sv.value === 'relay' ? 'RELAY ONLY' : 'AUTO'), 'ok'); };
    $('setBody').querySelectorAll('[data-fx]').forEach(b => b.onclick = () => fx[b.dataset.fx](b.dataset.fx === 'countdown' ? 1 : undefined));
    $('setBody').querySelectorAll('[data-k],[data-ku]').forEach(el => el.onclick = () => capture(el, tab));
    $('setBody').querySelectorAll('[data-uc]').forEach(el => el.oninput = () => { cfg.v.colorOverrides[el.dataset.uc] = el.value; cfg.save(); applyLiveSettings(); });
    $('setBody').querySelectorAll('[data-ucr]').forEach(el => el.onclick = () => { delete cfg.v.colorOverrides[el.dataset.ucr]; cfg.save(); applyLiveSettings(); renderSettings('units'); });
  }
  function capture(el, tab) {
    captureTarget = el; el.classList.add('wait'); el.textContent = 'PRESS…';
    const done = e => {
      e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', done, true); captureTarget = null;
      if (e.code !== 'Escape') { if (el.dataset.k) cfg.set('keys.' + el.dataset.k, e.code); else { cfg.v.keys.units[+el.dataset.ku] = e.code; cfg.save(); } assignKeys(); }
      renderSettings(tab); renderUnits(); renderSel();
    };
    addEventListener('keydown', done, true);
  }
  function applyLiveSettings() {
    cfg.apply();
    G.win = cfg.v.graphWindow * 1000;
    if (gridLayer) gridLayer.setOpacity(cfg.v.gridOverlay ? 1 : 0);
    syncOverlays();
    units.forEach(u => { if (u.marker) u.marker.setIcon(icon(u)); if (u.trail) u.trail.setStyle({ color: cfg.colorFor(u.callsign, u.color) }); });
    if (selfMarker) selfMarker.setIcon(icon(selfUnit(), true));
    if (opsStarted) { renderUnits(); renderSel(); renderPop(true); renderWindTag(); }
  }

  /* ======================================================= LAYOUT / MISC */
  function layoutHandles() {
    let d = null;
    $('drag').onpointerdown = e => { d = { x: e.clientX, w: $('left').offsetWidth }; document.body.style.cursor = 'col-resize'; e.preventDefault(); };
    $('vdrag').onpointerdown = e => { d = { y: e.clientY, h: $('bottom').offsetHeight }; document.body.style.cursor = 'row-resize'; e.preventDefault(); };
    addEventListener('pointermove', e => {
      if (!d) return;
      if (d.w != null) $('left').style.width = Math.max(220, Math.min(560, d.w + e.clientX - d.x)) + 'px';
      else $('bottom').style.height = Math.max(130, Math.min(460, d.h - (e.clientY - d.y))) + 'px';
      map.invalidateSize();
    });
    addEventListener('pointerup', () => { d = null; document.body.style.cursor = ''; });
    $('btnLayout').onclick = () => { const l = $('left'); l.style.display = l.style.display === 'none' ? 'flex' : 'none'; setTimeout(() => map.invalidateSize(), 60); };
  }
  function log(who, body, color) {
    const el = document.createElement('div');
    el.innerHTML = `<span class="muted">${UL.fmt.zulu()}</span> <b style="color:${color || '#00e5ff'}">${esc(who)}</b> ${esc(body)}`;
    $('log').appendChild(el); $('log').scrollTop = 1e6;
    while ($('log').children.length > 60) $('log').firstChild.remove();
  }
  function tick() {
    $('tClk').textContent = cfg.v.clock === 'zulu' ? UL.fmt.zulu() : new Date().toLocaleTimeString();
    renderClock(); renderUnits(); if (sel !== 'self') renderSel(); renderPop(); renderWindTag(); voiceTag(); updateReturnBtn();
    if (power) power.tick();
    if ($('mClk')) $('mClk').textContent = $('mClock').textContent;
    OFF.forEach((s, id) => { if (s.on && !s.ack && Date.now() - s.beep > 10000) { s.beep = Date.now(); fx.alert(); } });
    renderOff();
  }

  /* ============================================ OFF-ROUTE MASTER ALERT */
  function checkOff(u) {
    if (u.role !== 'rider' || !route || ended) return;
    const d = u.data; if (!d || d.lat == null) return;
    let off = typeof d.offRoute === 'number' ? d.offRoute : null;
    if (off == null) { const p = UL.projectToRoute(route, d.lat, d.lon); off = p ? p.off : null; }
    if (off == null) return;
    const T = cfg.v.offRouteM || 60, s = OFF.get(u.id) || { n: 0, back: 0, on: false, ack: false, beep: 0 };
    s.dist = off;
    if (!s.on) {
      s.n = off > T ? s.n + 1 : 0;
      if (s.n >= 2) {                                   // two consecutive fixes beyond the threshold = real, not GPS noise
        Object.assign(s, { on: true, ack: false, since: Date.now(), back: 0, beep: Date.now() });
        fx.alert(); log('ALERT', `${u.callsign} OFF ROUTE — ${Math.round(off)} M FROM COURSE`, '#ff4d6d');
        if (u.marker) u.marker.setIcon(icon(u));
      }
    } else {
      s.back = off < T * 0.66 ? s.back + 1 : 0;
      if (s.back >= 2) {
        Object.assign(s, { on: false, ack: false, n: 0 });
        log('SYS', `${u.callsign} BACK ON COURSE`, '#7cff5a'); UL.toast(`${u.callsign} BACK ON COURSE`, 'ok');
        if (u.marker) u.marker.setIcon(icon(u));
      }
    }
    OFF.set(u.id, s); renderOff();
  }
  let offSig = '';
  function renderOff() {
    const list = [...OFF.entries()].filter(([id, s]) => s.on && !s.ack && units.has(id));
    const box = $('offAlert'); if (!box) return;
    box.classList.toggle('show', list.length > 0);
    const h = list.map(([id, s]) => { const u = units.get(id), mm = Math.floor((Date.now() - s.since) / 1000);
      return `<div class="orow" data-id="${id}"><b style="color:#fff">${isLead(u) ? '★ ' : ''}${esc(u.callsign)}</b><span>${Math.round(s.dist)} M OFF COURSE</span><span class="sp"></span><span>${UL.hmsStr(mm)}</span><span style="color:#fff">◎</span></div>`; }).join('');
    if (h !== offSig) { offSig = h; $('offRows').innerHTML = h; $('offRows').querySelectorAll('.orow').forEach(r => r.onclick = () => returnTo(r.dataset.id)); }
  }
  function masterAck() {
    let n = 0; OFF.forEach(s => { if (s.on && !s.ack) { s.ack = true; n++; } });
    if (n) { log('SYS', 'MASTER ALERT ACKNOWLEDGED', '#ffb000'); fx.tick(); }
    renderOff();
  }

  /* ============================================ LEAD RIDER + RETURN TO RIDER */
  function setLead(name) {
    leadName = name || null;
    try { const k = 'ulLead:' + mission.code; leadName ? localStorage[k] = leadName : localStorage.removeItem(k); } catch (e) {}
    log('SYS', leadName ? '★ LEAD RIDER → ' + leadName : 'LEAD RIDER CLEARED', '#ffb000');
    if (leadName) UL.toast('★ ' + leadName + ' IS YOUR LEAD RIDER', 'ok');
    units.forEach(u => u.marker && u.marker.setIcon(icon(u)));
    assignKeys(); renderUnits(); renderPop(true); updateReturnBtn();
    if (power) power.setLead(leadName);
    if (tel.state) link.send({ t: 'telemetry', data: Object.assign({}, tel.state, { lead: leadName }) });
  }
  const leadUnit = () => leadName ? [...units.values()].find(isLead) : null;
  /** who "return" goes to: the lead rider, else the selected rider, else the first rider */
  function returnTarget() {
    const ok = u => u && u.role === 'rider' && u.data && u.data.lat != null;
    const l = leadUnit(); if (ok(l)) return l;
    const s = units.get(sel); if (ok(s)) return s;
    return sortedUnits().find(ok) || null;
  }
  function returnTo(id) {
    const u = id ? units.get(id) : returnTarget();
    if (!u || !u.data || u.data.lat == null) { UL.toast('NO RIDER POSITION YET', 'warn'); return; }
    closeOpsSector(true);
    sel = u.id; follow = true; G.zoomed = true; popOff = false; flyUntil = Date.now() + 1300;
    map.flyTo([u.data.lat, u.data.lon], Math.max(cfg.v.zoomFollow, 13), { duration: 1.1 });
    fx.select(); syncFollowBtn(); renderSel(); renderUnits(); renderPop(true); updateReturnBtn();
  }
  function updateReturnBtn() {
    const b = $('btnReturn'); if (!b || !map) return;
    const u = returnTarget();
    if (!u) return b.classList.remove('show');
    const ll = L.latLng(u.data.lat, u.data.lon), inView = map.getBounds().pad(-0.15).contains(ll);
    const show = !(follow && sel === u.id && inView) || opsSec != null;
    b.classList.toggle('show', show);
    b.textContent = '◎ RETURN TO ' + (isLead(u) ? '★ ' : '') + u.callsign;
  }

  /* ============================================ ON-SCREEN PTT + ALERT BUTTONS */
  function initOpsExtras() {
    $('btnMaster').onclick = e => { e.stopPropagation(); masterAck(); };
    $('btnReturn').onclick = () => returnTo();
    document.querySelectorAll('.gpsbtn').forEach(b => b.onclick = () => refreshGps());
    const b = $('pttBtn');
    const down = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {}
      const t = pttTo === 'sel' && sel !== 'self' && units.get(sel) ? [sel] : 'all';
      txStart(t, t === 'all' ? 'ALL UNITS' : units.get(sel).callsign); };
    const up = () => txEnd();
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.oncontextmenu = e => e.preventDefault();
    const lbl = () => { $('pttTgt').textContent = pttTo === 'all' ? 'TO: ALL' : 'TO: SELECTED'; };
    $('pttTgt').onclick = () => { pttTo = pttTo === 'all' ? 'sel' : 'all'; lbl(); fx.tick(); }; lbl();
  }
  /* ============================================ LIVE GPS REFRESH (button ↻ GPS, key G)
   * 1. reconnects the link if it went quiet
   * 2. restarts this laptop's GPS watch and takes a brand-new high-accuracy fix
   * 3. asks every rider / escort (via the relay) to take a fresh fix and send it immediately
   * 4. the relay answers at once with the last known position of every unit -> markers redrawn
   * 5. the map re-centres on all units; after 7 s a summary shows who answered with a fresh fix */
  function refreshGps() {
    if (!opsStarted || !map) return;
    if (gpsRef && Date.now() - gpsRef.t < 2500) return;
    const rid = Math.random().toString(36).slice(2, 10);
    gpsRef = { rid, t: Date.now(), got: new Set(), self: null, fitted: false };
    document.querySelectorAll('.gpsbtn').forEach(b => b.classList.add('busy'));
    link.kick();
    link.send({ t: 'gps.refresh', code: mission.code, rid });
    log('GPS', 'REFRESHING LIVE GPS — ALL UNITS', cfg.v.accent);
    UL.toast('↻ REFRESHING LIVE GPS…');
    startGeo();
    freshFix().then(ok => { if (!gpsRef || gpsRef.rid !== rid) return; gpsRef.self = ok; if (ok) { freshRid = rid; tel.dispatchEvent(new CustomEvent('update', { detail: tel.state })); } });
    redrawMarkers();
    setTimeout(() => fitAll(), 400);
    setTimeout(() => finishGps(rid), 7000);
  }
  function redrawMarkers() {
    units.forEach(u => { if (u.marker) { map.removeLayer(u.marker); u.marker = null; } if (u.trail) { const t = u.trail.getLatLngs(); map.removeLayer(u.trail); u.trail = null; u._keepTrail = t; } placeUnitFresh(u); });
    if (selfMarker) { map.removeLayer(selfMarker); selfMarker = null; }
    if (tel.state && tel.state.lat != null) { selfMarker = L.marker(shownLL(tel.state), { icon: icon(selfUnit(), true), zIndexOffset: 900 }).addTo(map); selfMarker.on('click', () => selectUnit('self')); }
  }
  function placeUnitFresh(u) {
    placeUnit(u);
    if (u.trail && u._keepTrail) { u.trail.setLatLngs(u._keepTrail.concat(u.trail.getLatLngs())); u._keepTrail = null; }
  }
  /** fit the map to every unit with a position (riders, other escorts and this escort) */
  function fitAll() {
    const pts = [];
    units.forEach(u => { if (u.data && u.data.lat != null && Date.now() - (u.ts || 0) < 120000) pts.push(shownLL(u.data)); });
    if (tel.state && tel.state.lat != null) pts.push(shownLL(tel.state));
    if (!pts.length) return UL.toast('NO GPS POSITIONS YET', 'warn');
    follow = false; syncFollowBtn(); flyUntil = Date.now() + 1300;
    if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), cfg.v.zoomFollow), { duration: 0.9 });
    else map.flyToBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: cfg.v.zoomFollow, duration: 0.9 });
    updateReturnBtn();
  }
  function finishGps(rid) {
    if (!gpsRef || gpsRef.rid !== rid) return;
    document.querySelectorAll('.gpsbtn').forEach(b => b.classList.remove('busy'));
    const all = [...units.values()], fresh = all.filter(u => gpsRef.got.has(u.id)), silent = all.filter(u => !gpsRef.got.has(u.id));
    const selfTxt = gpsRef.self === false ? ' · OWN GPS: NO FIX' : '';
    log('GPS', `FRESH FIX FROM ${fresh.length}/${all.length} UNITS${selfTxt}`, fresh.length === all.length ? '#7cff5a' : '#ffb000');
    if (silent.length) log('GPS', 'NO FRESH FIX: ' + silent.map(u => u.callsign).join(', ') + ' (last known position shown)', '#ffb000');
    UL.toast(`GPS REFRESHED · ${fresh.length}/${all.length} UNITS${selfTxt}`, silent.length || gpsRef.self === false ? 'warn' : 'ok', 4200);
    redrawMarkers(); renderUnits(); renderSel();
  }
  link.on('gps.snapshot', m => {
    if (!gpsRef || m.rid !== gpsRef.rid) return;
    (m.units || []).forEach(x => {
      if (!x.data || x.data.lat == null) return;
      const u = units.get(x.id) || { id: x.id, role: x.role, callsign: x.callsign, color: x.color, data: {}, ts: 0 };
      if (!u.data || (x.data.ts || 0) >= (u.data.ts || 0)) { u.data = x.data; u.ts = x.at ? Math.max(u.ts || 0, Date.now() - Math.max(0, m.ts - x.at)) : u.ts; }
      Object.assign(u, { role: x.role, callsign: x.callsign, color: x.color }); units.set(x.id, u);
      placeUnit(u);
    });
    renderUnits(); fitAll();
  });
  /* another escort pressed refresh: take a fresh fix and send it straight away */
  link.on('gps.refresh', m => {
    startGeo();
    freshFix().then(ok => { if (ok) { freshRid = m.rid; tel.dispatchEvent(new CustomEvent('update', { detail: tel.state })); } else link.send({ t: 'telemetry', data: Object.assign({}, tel.state, { lead: leadName }), fresh: m.rid }); });
    log('GPS', (m.callsign || 'ESCORT') + ' REFRESHED THE GPS FEED', '#ffb000');
  });

  /* ============================================ LEAD POWER widget */
  function initPower() {
    power = new UL.PowerPanel($('pwrBox'), {
      wind: d => { const w = unitWind(d); if (!w || !route || d.covered == null) return null; const r = UL.routeAt(route, d.covered); return r ? UL.headComponent(w, r.bearing) : null; }
    });
    power.setRoute(route); power.setLead(leadName);
    units.forEach(u => u.role === 'rider' && power.feed(u));
  }

  /* ============================================ minimise / maximise on every widget */
  function initWidgets() {
    UL.widget($('layers'), { key: 'layers', head: '.wh', defMin: isPhone() });
    UL.widget($('mapopts'), { key: 'overlay', head: '.wh', defMin: isPhone() });
    UL.widget($('comms'), { key: 'comms', head: '.row' });
    UL.widget($('left'), { key: 'units', head: '.hdr', onToggle: () => setTimeout(() => map && map.invalidateSize(), 60) });
    UL.widget($('sel'), { key: 'selunit', head: '.row' });
    UL.widget($('gbox'), { key: 'graph', head: '#gctl', onToggle: min => { $('bottom').classList.toggle('gmin', min); setTimeout(() => map && map.invalidateSize(), 60); } });
    UL.widget($('pwrBox'), { key: 'power', head: '.pw-h', onToggle: min => { if (!min && power) power.draw(true); } });
  }

  /* ============================================ phone layout: tab bar + bottom sheets */
  function initMobile() {
    const tabs = $('mTabs'); if (!tabs) return;
    tabs.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => setTab(mTab === b.dataset.tab && b.dataset.tab !== 'map' ? 'map' : b.dataset.tab));
    $('mSheetX').onclick = () => setTab('map');
    $('mSet').onclick = () => { $('dlgSet').showModal(); fx.open(); };
    const more = $('mMore'), homes = { clockbar: [$('clockbar').parentNode, $('clockbar').nextSibling], comms: [$('comms').parentNode, $('comms').nextSibling] };
    const place = () => {
      const ph = isPhone();
      document.body.classList.toggle('phone', ph);
      if (ph) { if ($('clockbar').parentNode !== more) more.appendChild($('clockbar')); if ($('comms').parentNode !== more) more.appendChild($('comms')); }
      else { Object.entries(homes).forEach(([id, [par, nx]]) => { if ($(id).parentNode !== par) par.insertBefore($(id), nx && nx.parentNode === par ? nx : null); }); if (mTab !== 'map') setTab('map'); }
      setTimeout(() => map && map.invalidateSize(), 80);
    };
    addEventListener('resize', place); place(); setTab('map');
  }
  function setTab(t) {
    mTab = t;
    ['units', 'power', 'profile', 'more'].forEach(k => document.body.classList.toggle('mt-' + k, t === k));
    document.body.classList.toggle('msheet', t !== 'map');
    $('mTabs') && $('mTabs').querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    if ($('mSheetT')) $('mSheetT').textContent = { units: 'TRACKED UNITS', power: 'LEAD POWER', profile: 'ELEVATION & SELECTED UNIT', more: 'MISSION CONTROL & COMMS' }[t] || '';
    if (t === 'power' && power) setTimeout(() => power.draw(true), 30);
    setTimeout(() => map && map.invalidateSize(), 60);
    fx.tick && fx.tick();
  }

  addEventListener('resize', () => { map && map.invalidateSize(); });
  startup();
  window.__ul = { get units() { return units; }, get sectors() { return sectors; }, wind, G, get sel() { return sel; }, selectUnit,
    get voice() { return voice; }, get follow() { return follow; }, get lead() { return leadName; }, setLead, returnTo, openSector: openOpsSector, closeSector: closeOpsSector,
    get opsSec() { return opsSec; }, get route() { return route; }, alerts: OFF, masterAck, get me() { return me; }, refreshGps, get power() { return power; }, setTab };
})();
