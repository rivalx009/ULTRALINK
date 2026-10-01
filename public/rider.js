/* ULTRALINK — RIDER MODE */
(() => {
  const NUL = { textContent: '', innerHTML: '', className: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, firstChild: { textContent: '' } };
  const $ = id => document.getElementById(id) || NUL;
  const link = new UL.Link(), tel = new UL.Telemetry(), ble = new UL.BleSensors();
  const cfg = new UL.Settings(); cfg.apply();
  const fx = UL.fx; let sectors = [], sectorTimer = null, startAt = null, lastCd = null, joinInfo = null, started = false;
  let clockStart = null, clockStop = null, targetSec = null;
  let voice = null, mission = null, me = null, useBle = false, wake = null, roster = [], ended = false, wasOff = false;
  const P = UL.platform || {};
  /* Android app (UltraApp bridge): native GPS + foreground service keep tracking and radio alive with the screen off */
  const APP = window.UltraApp || null;
  window.ULNative = {
    onPos(lat, lon, acc, spd, hdg, alt, ts) { tel.onPosition({ coords: { latitude: lat, longitude: lon, accuracy: acc, speed: spd < 0 ? null : spd, heading: hdg < 0 ? null : hdg, altitude: alt }, timestamp: ts || Date.now() }); },
    onGpsError(msg) { $('acc').textContent = 'GPS ' + msg; $('acc').className = 'tag bad'; },
    ptt(on) { on ? open() : shut(); },
    togglePtt() { live ? shut() : open(); },
    resume() { recoverAll(); }
  };
  const app = (fn, ...a) => { try { APP && APP[fn] && APP[fn](...a); } catch (e) {} };

  /* ---------------------------------------------------------- login form */
  $('code').value = localStorage.ulCode || '';
  $('callsign').value = localStorage.ulCallsign || '';
  $('srcGps').onclick = () => { useBle = false; $('srcGps').className = 'primary'; $('srcBle').className = ''; };
  $('srcBle').onclick = () => { useBle = true; $('srcBle').className = 'primary'; $('srcGps').className = ''; };
  $('code').oninput = e => e.target.value = e.target.value.toUpperCase();
  $('go').onclick = deploy;
  /* iPhone / iPad Safari and Firefox have no Web Bluetooth: GPS works, sensors need Chrome/Edge (Android, Windows, macOS) */
  if (!navigator.bluetooth) {
    $('srcBle').disabled = true; $('srcBle').title = 'Web Bluetooth is not available in this browser';
    $('bleNote').innerHTML = P.ios ? 'iPhone / iPad: BLE sensors are not supported by Safari — phone GPS only. Heart rate can still come from an Android phone or a laptop.' : 'BLE sensors need Chrome or Edge (Android, Windows, macOS). Phone GPS works everywhere.';
  }
  if (/Android/.test(navigator.userAgent) && !APP) $('getApp').style.display = 'block';
  if (APP) { const ms = document.querySelector('#login .sub a'); if (ms) ms.style.display = 'none'; }
  ['code', 'callsign'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); deploy(); } }));

  async function deploy() {
    const code = $('code').value.trim().toUpperCase(), cs = $('callsign').value.trim().toUpperCase();
    if (code.length < 4 || !cs) return fail('MISSION CODE AND CALLSIGN REQUIRED');
    localStorage.ulCode = code; localStorage.ulCallsign = cs;
    $('go').textContent = 'LINKING…';
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
    } catch (e) { /* mic optional */ }
    fx.unlock();
    let resume; try { resume = sessionStorage['ulRid:' + code] || undefined; } catch (e) {}
    joinInfo = { t: 'join', code, role: 'rider', callsign: cs, resume };
    link.connect();
    link.send(joinInfo);
  }
  const fail = m => { $('err').textContent = m; $('go').textContent = '◮ DEPLOY'; };

  /* -------------------------------------------------------------- link   */
  const joinMsg = () => Object.assign({}, joinInfo, me ? { resume: me } : {});
  let retryT = null;
  link.on('error', m => {
    /* relay restarted: the escort re-creates the mission within seconds — keep retrying instead of kicking the rider out */
    if (m.code === 'NO_MISSION' && started && !ended) { $('lnk').className = 'dot'; clearTimeout(retryT); retryT = setTimeout(() => link.send(joinMsg()), 4000); return; }
    fail(m.msg || 'LINK ERROR'); fx.error();
  });
  link.on('open', () => { $('lnk').className = 'dot ok'; if (started && joinInfo && !ended) link.send(joinMsg()); });
  link.on('close', () => { $('lnk').className = 'dot'; });
  link.on('rtt', v => $('rtt').textContent = 'RTT ' + v + 'ms');
  link.on('roster', m => {
    roster = m.units.filter(u => u.id !== me);
    if (voice) voice.sync(roster.map(u => u.id));
  });
  link.on('ptt', m => {
    const el = $('rx');
    if (m.state === 'start') fx.rxOpen(); else fx.rxClose();
    if (m.state === 'start') { el.textContent = '◉ ' + m.callsign; el.style.display = 'block'; el.style.borderColor = m.color; el.style.color = m.color; }
    else el.style.display = 'none';
  });
  link.on('mission', m => { mission = m.mission; startAt = mission.startAt || null; lastCd = null; applyRoute(); });
  link.on('mission.clock', m => { if (m.clockStart && !clockStart && !m.clockStop) { fx.go(); UL.toast('MISSION CLOCK RUNNING — GO', 'ok'); } clockStart = m.clockStart; clockStop = m.clockStop; targetSec = m.targetSec; renderClock(); });
  link.on('mission.ended', m => {
    ended = true; clearTimeout(retryT); app('stopTracking');
    m.mode === 'close' ? fx.success() : fx.abort();
    $('dlgEnd').innerHTML = `<div style="padding:22px;text-align:center">
      <div style="color:var(--bad);font-size:16px;letter-spacing:.3em">${m.reason}</div>
      <div class="muted" style="font-size:11px;margin-top:10px">Declared by ${m.by}. Telemetry and comms have stopped.</div>
      <button class="primary" style="margin-top:16px;width:100%;padding:14px" onclick="location.reload()">CLOSE</button></div>`;
    $('dlgEnd').showModal();
  });

  function renderClock() {
    if (startAt && !clockStart) {
      const rem = Math.ceil((startAt - Date.now()) / 1000), r = Math.max(0, rem), h = Math.floor(r / 3600), m = Math.floor(r % 3600 / 60), x = r % 60;
      $('rStart').textContent = 'T-' + (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); $('rStart').className = 'tag ' + (rem <= 600 ? 'bad' : 'ok'); $('rStart').style.display = '';
      if (rem <= 10 && rem > 0 && rem !== lastCd) { lastCd = rem; fx.countdown(rem); }
    } else $('rStart').style.display = 'none';
    if (!clockStart) { $('rClock').textContent = '00:00'; }
    else $('rClock').textContent = UL.fmt.hms(((clockStop || Date.now()) - clockStart) / 1000);
    const e = clockStart ? ((clockStop || Date.now()) - clockStart) / 1000 : 0;
    const togo = tel.state.etaSec;
    if (targetSec && clockStart && togo != null) {
      const d = e + togo - targetSec;
      $('rTarget').textContent = 'TGT ' + (d <= 0 ? '-' : '+') + UL.fmt.hms(Math.abs(d));
      $('rTarget').className = 'tag ' + (d <= 0 ? 'ok' : 'bad');
    } else $('rTarget').textContent = targetSec ? 'TGT ' + UL.fmt.hms(targetSec) : 'TGT --';
  }

  function buildRiderSettings() {
    $('rSet').onclick = () => {
      const v = cfg.v;
      $('dlgR').innerHTML = `<div style="padding:18px">
        <h3 style="letter-spacing:.2em">SETTINGS</h3>
        <div style="margin-top:12px"><label>Theme</label>
          <select id="rTheme" style="width:100%">${Object.keys(UL.THEMES).map(t => `<option ${v.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div style="margin-top:10px"><label>Accent colour</label><input type="color" id="rAcc" value="${v.accent}" style="width:100%;height:34px"></div>
        <div style="margin-top:10px"><label>Units</label>
          <select id="rUnits" style="width:100%"><option value="metric" ${v.units === 'metric' ? 'selected' : ''}>metric</option><option value="imperial" ${v.units === 'imperial' ? 'selected' : ''}>imperial</option></select></div>
        <div style="margin-top:10px"><label>Interface scale <span class="muted">${v.fontScale}%</span></label>
          <input type="range" min="85" max="150" step="5" id="rScale" value="${v.fontScale}" style="width:100%"></div>
        <div class="row" style="margin-top:12px"><label style="flex:1">CRT scanlines</label><input type="checkbox" id="rScan" ${v.scanlines ? 'checked' : ''}></div>
        <div style="margin-top:10px"><label>Voice path</label>
          <select id="rVoice" style="width:100%"><option value="auto" ${(localStorage.ulVoice || 'auto') === 'auto' ? 'selected' : ''}>auto (P2P, fall back to relay)</option><option value="relay" ${localStorage.ulVoice === 'relay' ? 'selected' : ''}>relay only</option></select></div>
        ${APP ? '<button class="ghost" id="rServer" style="width:100%;margin-top:12px">CHANGE SERVER ADDRESS</button>' : ''}
        <button class="primary" style="width:100%;margin-top:16px;padding:14px" onclick="this.closest('dialog').close()">DONE</button></div>`;
      $('dlgR').showModal();
      if (APP && document.getElementById('rServer')) document.getElementById('rServer').onclick = () => app('resetServer');
      $('rTheme').onchange = e => cfg.set('theme', e.target.value);
      $('rAcc').oninput = e => cfg.set('accent', e.target.value);
      $('rUnits').onchange = e => { cfg.set('units', e.target.value); };
      $('rScale').oninput = e => cfg.set('fontScale', +e.target.value);
      $('rScan').onchange = e => cfg.set('scanlines', e.target.checked);
      $('rVoice').onchange = e => { localStorage.ulVoice = e.target.value; if (voice) { voice.mode = e.target.value; if (voice.mode === 'relay') [...voice.peers.keys()].forEach(id => voice.dropPeer(id)); else voice.sync(roster.map(u => u.id)); } };
    };
  }
  link.on('joined', m => {
    me = m.id; mission = m.mission; clearTimeout(retryT);
    try { sessionStorage['ulRid:' + mission.code] = me; } catch (e) {}
    if (voice) { voice.selfId = me; voice.sync(roster.map(u => u.id)); }
    $('login').style.display = 'none'; $('app').style.display = 'flex';
    $('mis').textContent = mission.code + ' · ' + mission.name;
    $('cs').textContent = localStorage.ulCallsign;
    $('src').textContent = useBle ? 'GPS+BLE' : 'GPS';
    if (started) { me = m.id; return; }
    started = true;
    clockStart = mission.clockStart || null; clockStop = mission.clockStop || null; targetSec = mission.targetSec || null; startAt = mission.startAt || null;
    applyRoute(); initSectors(); startGeo(); startVoice(); keepAwake(); buildRiderSettings();
    setInterval(() => { renderClock(); }, 500);
    if (useBle) pairBle();
  });

  function applyRoute() {
    if (mission && mission.route && mission.route.length) {
      tel.setRoute(UL.buildRoute(mission.route.map(p => ({ lat: p[0], lon: p[1], ele: p[2] || 0 }))));
      drawProfile();
    }
  }

  /* ----------------------------------------------------------- sensors   */
  async function pairBle() {
    try {
      const name = await ble.pair();
      $('dev').textContent = (name || 'SENSOR').toUpperCase();
      $('dev').className = 'tag ok';
    } catch (e) { $('dev').textContent = 'BLE FAILED'; $('dev').className = 'tag bad'; }
  }
  ble.on('data', d => {
    if (d.hr != null) { tel.setSensor('hr', d.hr); $('hr').textContent = d.hr; }
    if (d.cad != null) tel.setSensor('cad', d.cad);
    if (d.power != null) tel.setSensor('power', d.power);
    tel.setSensor('source', 'BLE');
  });
  ble.on('status', s => { if (s.state === 'lost') { $('dev').textContent = 'SENSOR LOST'; $('dev').className = 'tag bad'; } });

  function initSectors() {
    if (!mission || !mission.route || !mission.route.length) return;
    const total = mission.distance || tel.route?.distance || 1;
    sectors = UL.normaliseSectors(mission.sectors, total);
    sectorTimer = new UL.SectorTimer(sectors, total, {
      checkpoint: (k, i, sc) => { fx.checkpoint(); if (navigator.vibrate) navigator.vibrate([40, 40, 40]); UL.toast(UL.cpLabel(sc) + ' · ' + sc.name, 'ok'); },
      finish: (k, i, dur, sc) => { fx.sectorDone(); if (navigator.vibrate) navigator.vibrate(120); const dl = sc.target ? dur - sc.target : null; UL.toast(sc.name + ' ' + UL.hmsStr(dur) + (dl != null ? ' (' + (dl <= 0 ? '−' : '+') + UL.hmsStr(Math.abs(dl)) + ')' : ''), dl != null && dl > 0 ? 'warn' : 'ok', 5000); }
    });
  }
  function renderSector() {
    const st = sectorTimer.units.get('me'), run = sectorTimer.running('me');
    if (st && st.cur >= 0 && run != null) {
      const sc = sectors[st.cur], over = sc.target && run > sc.target;
      $('secChip').textContent = sc.name + ' ' + UL.hmsStr(run) + (sc.target ? ' / ' + UL.hmsStr(sc.target) : ''); $('secChip').className = 'tag ' + (over ? 'bad' : 'ok'); $('secChip').style.borderColor = sc.color;
    } else if (st && st.times.length) { let li = st.times.length - 1; while (li > 0 && st.times[li] == null) li--; $('secChip').textContent = '✓ ' + sectors[li].name + ' ' + UL.hmsStr(st.times[li]); $('secChip').className = 'tag'; }
    else { $('secChip').textContent = sectors.length > 1 ? 'AWAITING CHECKPOINT' : 'SECTOR --'; $('secChip').className = 'tag'; }
  }
  function startGeo() {
    if (APP) { app('startTracking', mission ? mission.code : '', localStorage.ulCallsign || ''); $('src').textContent = 'APP GPS'; return; }
    if (!navigator.geolocation) return fail('NO GEOLOCATION');
    navigator.geolocation.watchPosition(
      p => tel.onPosition(p),
      e => { $('acc').textContent = 'GPS ERR ' + e.code; $('acc').className = 'tag bad'; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  }
  /** back on screen after a call / app switch: reconnect, fresh mic if it was lost, sound back on, position out now */
  let lastRecover = 0;
  function recoverAll() {
    if (!started || ended || Date.now() - lastRecover < 1500) return; lastRecover = Date.now();
    link.kick();
    if (voice) voice.recover().then(fixed => { if (fixed) UL.toast('MICROPHONE RESTORED', 'ok'); });
    if (voice) voice.audioCtx();
    if (tel.state && tel.state.lat != null) { lastTx = 0; link.send({ t: 'telemetry', data: tel.state }); }
    UL.toast('BACK ONLINE', 'ok', 1800);
  }
  async function keepAwake() {
    try { wake = await navigator.wakeLock.request('screen'); } catch (e) {}
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') recoverAll();
      if (document.visibilityState === 'visible') { try { wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
    });
  }

  /* ---------------------------------------------------------- telemetry  */
  let lastTx = 0;
  tel.addEventListener('update', e => {
    const s = e.detail;
    $('spd').innerHTML = cfg.speed(s.speed).toFixed(1) + '<span style="font-size:15px;letter-spacing:.2em"> ' + cfg.speedU() + '</span>';
    $('cov').textContent = cfg.dist(s.covered).toFixed(2);
    $('rem').textContent = s.remaining ? cfg.dist(s.remaining).toFixed(2) : '--';
    $('eta').textContent = s.eta ? cfg.time(s.eta) : '--:--';
    $('grd').textContent = UL.fmt.pct(s.grade);
    $('ele').textContent = Math.round(cfg.elev(s.ele || 0));
    $('acc').textContent = 'GPS ±' + Math.round(s.acc || 0) + 'm';
    $('acc').className = 'tag' + ((s.acc || 99) < 25 ? ' ok' : '');
    $('avg').textContent = 'AVG ' + cfg.speed(s.avg).toFixed(1);
    if (s.offRoute != null) {
      const T = cfg.v.offRouteM || 60, off = wasOff ? s.offRoute > T * 0.66 : s.offRoute > T;
      if (off && !wasOff) { fx.alert(); navigator.vibrate?.([220, 120, 220, 120, 220]); }
      wasOff = off; $('offBar').classList.toggle('show', off);
      $('off').textContent = off ? 'OFF ROUTE ' + Math.round(s.offRoute) + 'm' : 'ON ROUTE';
      $('off').className = 'tag' + (off ? ' bad' : ' ok');
    }
    renderClock();
    drawProfile();
    if (sectorTimer) { sectorTimer.feed('me', s.covered, s.ts || Date.now()); renderSector(); }
    const now = Date.now();
    if (now - lastTx > 1000) { lastTx = now; link.send({ t: 'telemetry', data: s }); }
  });

  /* ------------------------------------------------------ elevation plot */
  function drawProfile() {
    const cv = $('prof'), r = tel.route; if (!cv) return;
    const w = cv.clientWidth, h = 78, dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const x = cv.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,229,255,.08)';
    for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(w * i / 6, 0); x.lineTo(w * i / 6, h); x.stroke(); }
    if (!r || !r.points.length) {
      x.fillStyle = '#5d8794'; x.font = '10px monospace'; x.fillText('NO ROUTE PROFILE LOADED', 10, 42); return;
    }
    const P = r.points, lo = Math.min(...P.map(p => p.ele)), hi = Math.max(...P.map(p => p.ele)), span = Math.max(1, hi - lo);
    x.beginPath(); x.moveTo(0, h);
    P.forEach(p => x.lineTo((p.d / r.distance) * w, h - 8 - ((p.ele - lo) / span) * (h - 18)));
    x.lineTo(w, h); x.closePath();
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,229,255,.35)'); g.addColorStop(1, 'rgba(0,229,255,.02)');
    x.fillStyle = g; x.fill();
    x.strokeStyle = '#00e5ff'; x.lineWidth = 1.2; x.beginPath();
    P.forEach((p, i) => { const px = (p.d / r.distance) * w, py = h - 8 - ((p.ele - lo) / span) * (h - 18); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    const s = tel.state;
    if (s.covered) {
      const px = (s.covered / r.distance) * w;
      x.strokeStyle = '#ffb000'; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, h); x.stroke();
      x.fillStyle = '#ffb000'; x.beginPath(); x.arc(px, h - 8 - ((s.ele - lo) / span) * (h - 18), 3.2, 0, 7); x.fill();
    }
    x.fillStyle = '#5d8794'; x.font = '9px monospace';
    x.fillText(Math.round(lo) + 'm', 3, h - 3); x.fillText(Math.round(hi) + 'm', 3, 10);
    x.fillText((r.distance / 1000).toFixed(1) + 'km', w - 38, h - 3);
  }
  addEventListener('resize', drawProfile);

  /* --------------------------------------------------------------- PTT   */
  function startVoice() {
    voice = new UL.VoiceNet(link, { mode: localStorage.ulVoice === 'relay' ? 'relay' : 'auto' });
    voice.selfId = me;
    voice.on('blocked', () => $('tapAudio').classList.add('show'));
    voice.on('unblocked', () => $('tapAudio').classList.remove('show'));
    $('tapAudio').onclick = () => { voice.audioCtx(); $('tapAudio').classList.remove('show'); };
    voice.mic().catch(() => { $('ptt').firstChild.textContent = 'MIC BLOCKED — CHECK PERMISSIONS'; });
    voice.sync(roster.map(u => u.id));
    setInterval(() => {
      const s = voice.summary();
      $('vmode').textContent = !s.mic ? 'MIC OFF' : s.mode === 'relay' ? 'VOICE RELAY' : 'VOICE P2P ' + s.p2p + '/' + s.total;
      $('vmode').className = 'tag ' + (!s.mic ? 'bad' : s.p2p < s.total ? '' : 'ok');
    }, 1000);
  }
  const btn = $('ptt');
  let live = false;
  /* voice.transmit() sends the PTT banner and opens the mic just after the key beep; release() closes both */
  const open = () => { if (live || !voice) return; live = true; fx.pttOpen(); voice.transmit('all', 140); btn.classList.add('live'); btn.firstChild.textContent = '◉ TRANSMITTING'; navigator.vibrate?.(30); app('setTalking', true); };
  const shut = () => { if (!live) return; live = false; voice.release(); fx.pttClose(); btn.classList.remove('live'); btn.firstChild.textContent = 'PUSH TO TALK'; app('setTalking', false); };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (x) {} open(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => btn.addEventListener(t, shut));
  btn.oncontextmenu = e => e.preventDefault();
  // laptops: hold Space · Bluetooth PTT remotes usually emit media/volume keys
  addEventListener('keydown', e => { if (!started || e.repeat || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || document.querySelector('dialog[open]')) return; if ([' ', 'MediaPlayPause', 'AudioVolumeUp', 'Enter'].includes(e.key)) { e.preventDefault(); open(); } });
  addEventListener('keyup', e => { if ([' ', 'MediaPlayPause', 'AudioVolumeUp', 'Enter'].includes(e.key)) shut(); });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { open(); setTimeout(shut, 2500); });
      navigator.mediaSession.setActionHandler('pause', shut);
    } catch (e) {}
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__rider = { get voice() { return voice; }, get me() { return me; } };
})();
