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
  const SHELL = window.UltraApp || null;                               // desktop or Android app shell
  const APP = SHELL && typeof SHELL.startTracking === 'function' ? SHELL : null;   // only the Android app has native background tracking
  /* Android app v1.7+: the radio runs natively in the background service (keeps working with the screen off).
     Older apps and browsers keep the web radio (WebRTC + relay). */
  const NATIVE_RADIO = !!(APP && typeof APP.startRadio === 'function');
  window.ULNative = {
    onPos(lat, lon, acc, spd, hdg, alt, ts) { tel.onPosition({ coords: { latitude: lat, longitude: lon, accuracy: acc, speed: spd < 0 ? null : spd, heading: hdg < 0 ? null : hdg, altitude: alt }, timestamp: ts || Date.now() }); },
    onGpsError(msg) { $('acc').textContent = 'GPS ' + msg; $('acc').className = 'tag bad'; },
    ptt(on) { on ? open() : shut(); },
    togglePtt() { if (NATIVE_RADIO) app('radioToggle'); else live ? shut() : open(); },
    resume() { recoverAll(); },
    radioState(state, tx) { radioUi(state, tx); }
  };
  const app = (fn, ...a) => { try { APP && APP[fn] && APP[fn](...a); } catch (e) {} };

  // Optional browser battery reporting is independent of GPS and microphone.
  let batteryManager=null,batteryStatus='unavailable',batteryStarted=false;
  function sendBattery(){
    if(!started||ended||!link.ready||!alertJoined)return;
    const level=batteryManager?.level;
    const battery=batteryManager&&Number.isFinite(level)&&level>=0&&level<=1?{status:'ok',percent:Math.round(level*100),charging:!!batteryManager.charging}:{status:batteryStatus};
    const own=UL.batteryView({...battery,at:Date.now()});$('phoneBattery').textContent=own.text.replace(' · 0s ago','');$('phoneBattery').style.color=own.color;
    link.send({t:'battery',battery});
  }
  async function startBattery(){
    if(batteryStarted){sendBattery();return;}batteryStarted=true;
    setInterval(sendBattery,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sendBattery();});
    if(typeof navigator.getBattery!=='function'){sendBattery();return;}
    try{
      batteryManager=await Promise.race([navigator.getBattery(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Battery unavailable')),4000))]);batteryStatus='ok';
      batteryManager.addEventListener('levelchange',sendBattery);batteryManager.addEventListener('chargingchange',sendBattery);
    }catch{batteryManager=null;batteryStatus='error';}
    sendBattery();
  }

  /* One-tap assistance alerts. A relay receipt is not an escort acknowledgement.
     Pending events survive a reload and retry only after joining, with the same ID. */
  let riderAlerts = [], pendingAlerts = [], alertJoined = false;
  const alertLabel = k => k === 'riderDown' ? 'RIDER DOWN' : 'MECHANICAL';
  const alertKey = () => 'ulPendingAlerts:' + (mission?.code || joinInfo?.code || '');
  function savePending() { try { sessionStorage[alertKey()] = JSON.stringify(pendingAlerts); } catch (e) {} }
  function renderRiderAlerts() {
    const active = riderAlerts.filter(a => a.riderId === me && !a.ack);
    ['riderDown', 'mechanical'].forEach(k => {
      const on = active.some(a => a.kind === k) || pendingAlerts.some(a => a.kind === k);
      $(k === 'riderDown' ? 'btnRiderDown' : 'btnMechanical').setAttribute('aria-pressed', String(on));
    });
    const lines = active.map(a => alertLabel(a.kind) + ' SENT TO RELAY · AWAITING ESCORT ACK');
    pendingAlerts.forEach(a => lines.push(alertLabel(a.kind) + (link.ready && alertJoined && navigator.onLine !== false ? ' · SENDING…' : ' · NOT SENT — WAITING FOR CONNECTION')));
    $('riderAlertStatus').textContent = lines.join(' / ');
  }
  function sendPending() {
    if (!started || ended || !alertJoined || !link.ready || navigator.onLine === false) return;
    pendingAlerts.forEach(a => link.send({ t: 'rider.alert', eventId: a.eventId, kind: a.kind, data: a.data || tel.state }));
  }
  function triggerRiderAlert(kind) {
    if (!started || ended) return;
    if (pendingAlerts.some(a => a.kind === kind) || riderAlerts.some(a => a.riderId === me && a.kind === kind && !a.ack)) return;
    const eventId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c === 'x' ? r : (r&3|8)).toString(16); });
    const d = tel.state;
    pendingAlerts.push({ eventId, kind, data: d?.lat != null ? { lat: d.lat, lon: d.lon, ts: d.ts, accuracy: d.accuracy } : null });
    savePending(); fx.unlock(); navigator.vibrate?.([100, 50, 100]); sendPending(); renderRiderAlerts();
  }
  $('btnRiderDown').onclick = () => triggerRiderAlert('riderDown');
  $('btnMechanical').onclick = () => triggerRiderAlert('mechanical');
  link.on('close', () => { alertJoined = false; renderRiderAlerts(); });
  link.on('rider.alert.state', m => {
    const previous = riderAlerts;
    riderAlerts = Array.isArray(m.alerts) ? m.alerts : [];
    pendingAlerts = pendingAlerts.filter(p => !riderAlerts.some(a => a.riderId === me && (a.eventId === p.eventId || (!a.ack && a.kind === p.kind))));
    savePending(); renderRiderAlerts();
    riderAlerts.filter(a => a.riderId === me && a.ack && previous.some(p => p.eventId === a.eventId && !p.ack)).forEach(a => {
      $('riderAlertStatus').textContent = alertLabel(a.kind) + ' ACKNOWLEDGED BY ' + a.ackBy + ( $('riderAlertStatus').textContent ? ' / ' + $('riderAlertStatus').textContent : '');
      UL.toast(alertLabel(a.kind) + ' ACKNOWLEDGED BY ESCORT', 'ok', 5000);
    });
  });
  setInterval(sendPending, 2500);
  addEventListener('offline', renderRiderAlerts);
  addEventListener('online', () => { sendPending(); renderRiderAlerts(); });

  /* Emergency announcements do not use the escort microphone or rider microphone.
     Browser speech handles typed text; the updated Android bridge is a native fallback. */
  const emergencyInbox = [], emergencySeen = new Set();
  let emergencyCurrent = null, emergencyLatest = null, emergencyUtterance = null;
  const speechAvailable = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  function emergencyReport(m, state) {
    if (link.ready && !ended) link.send({t:'emergency.playback', eventId:m.eventId, state});
    if (emergencyLatest?.eventId === m.eventId) $('emergencyRxStatus').textContent = {
      queued:'VOICE QUEUED',playing:'PLAYING VOICE',played:'VOICE PLAYBACK COMPLETED',
      unavailable:'SPEECH UNAVAILABLE — USE A SPEECH-CAPABLE BROWSER OR UPDATED ANDROID APP',
      blocked:'AUDIO BLOCKED — TAP PLAY VOICE',muted:'SOUND DISABLED — ENABLE SOUND IN SETTINGS',failed:'VOICE FAILED — TAP PLAY TO RETRY'
    }[state] || state;
  }
  function finishEmergency(state) {
    const m = emergencyCurrent; if (!m) return;
    clearTimeout(m.timer); emergencyReport(m,state); emergencyCurrent = null; emergencyUtterance = null;
    setTimeout(playNextEmergency,0);
  }
  function nativeEmergencyReady() {
    try { return SHELL && typeof SHELL.speakEmergency === 'function' && SHELL.emergencySpeechReady(); } catch(e) { return false; }
  }
  function playNextEmergency() {
    if (emergencyCurrent || !emergencyInbox.length || ended) return;
    const m = emergencyCurrent = emergencyInbox.shift();
    m.timer = setTimeout(()=>finishEmergency('failed'),90000);
    if (!fx.state.enabled || fx.state.volume === 0) return finishEmergency('muted');
    if (m.preset) {
      emergencyReport(m,'playing');
      fx.emergencyPreset(m.preset).then(()=>{if(emergencyCurrent===m)finishEmergency('played');}).catch(e=>{if(emergencyCurrent===m)finishEmergency(['muted','blocked'].includes(e.message)?e.message:'failed');});
      return;
    }
    if (nativeEmergencyReady()) {
      try { SHELL.speakEmergency(m.eventId,m.text,fx.state.volume); } catch(e) { finishEmergency('failed'); }
      return;
    }
    if (!speechAvailable()) return finishEmergency('unavailable');
    const utterance = emergencyUtterance = new SpeechSynthesisUtterance(m.text);
    utterance.lang = 'en-US'; utterance.rate = 1; utterance.volume = fx.state.volume;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v=>v.lang==='en-US' && v.localService) || voices.find(v=>/^en(?:-|_|$)/i.test(v.lang));
    if (voice) utterance.voice = voice;
    utterance.onstart=()=>{if(emergencyCurrent===m)emergencyReport(m,'playing');};
    utterance.onend=()=>{if(emergencyCurrent===m)finishEmergency('played');};
    utterance.onerror=e=>{if(emergencyCurrent===m)finishEmergency(e.error==='not-allowed'?'blocked':'failed');};
    try { speechSynthesis.speak(utterance); } catch(e) { finishEmergency('failed'); }
  }
  window.ULNative.onEmergencySpeech = (id,state) => {
    if (!emergencyCurrent || emergencyCurrent.eventId !== id) return;
    if (state === 'playing') emergencyReport(emergencyCurrent,state);
    else finishEmergency(state === 'played' ? 'played' : 'failed');
  };
  link.on('emergency.say', m => {
    if (ended || typeof m.text !== 'string' || m.text.length > 500 || emergencySeen.has(m.eventId)) return;
    emergencySeen.add(m.eventId);if(emergencySeen.size>200)emergencySeen.delete(emergencySeen.values().next().value);
    emergencyLatest = m; $('emergencyRxFrom').textContent='EMERGENCY FREQUENCY · '+m.callsign;
    $('emergencyRxText').textContent=m.text; $('emergencyRx').classList.add('show');document.body.classList.add('emergency-receiving'); navigator.vibrate?.([80,50,80]);
    if (emergencyInbox.length >= 20) { emergencyReport(m,'failed'); return; }
    emergencyInbox.push(m); emergencyReport(m,'queued'); playNextEmergency();
  });
  $('emergencyReplay').onclick = () => {
    if (!emergencyLatest || emergencyCurrent?.eventId === emergencyLatest.eventId || emergencyInbox.some(m=>m.eventId===emergencyLatest.eventId)) return;
    fx.unlock(); emergencyInbox.push({...emergencyLatest});playNextEmergency();
  };
  $('emergencyDismiss').onclick = () => { $('emergencyRx').classList.remove('show'); document.body.classList.remove('emergency-receiving'); drawProfile(); };
  function primeEmergencySpeech() {
    if (!speechAvailable()) return;
    try { const u = new SpeechSynthesisUtterance('');u.volume=0;speechSynthesis.speak(u); } catch(e) {}
  }

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
  /* v1.5: the apps are no longer rider-only — mode select and escort mode stay available inside the app */
  UL.widget(document.getElementById('wStats'), { key: 'r-stats', head: '.rwh' });
  UL.widget(document.getElementById('wProf'), { key: 'r-prof', head: '.rwh', onToggle: min => { if (!min) setTimeout(() => drawProfile(), 30); } });
  ['code', 'callsign'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); deploy(); } }));

  async function deploy() {
    primeEmergencySpeech();
    const code = $('code').value.trim().toUpperCase(), cs = $('callsign').value.trim().toUpperCase();
    if (code.length < 4 || !cs) return fail('CODE AND CALLSIGN REQUIRED');
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
    /* Never recreate missing missions from a rider; wait for the durable relay state. */
    if(m.code==='MISSION_CLOSED'){link.emit('mission.ended',{mode:'close',reason:m.msg});return;}
    if (m.code === 'NO_MISSION' && started && !ended) { $('lnk').className = 'dot'; clearTimeout(retryT); retryT = setTimeout(() => link.send(joinMsg()), 4000); return; }
    fail(m.msg || 'LINK ERROR'); fx.error();
  });
  link.on('open', () => { $('lnk').className = 'dot ok'; if (started && joinInfo && !ended) link.send(joinMsg()); });
  link.on('close', () => { $('lnk').className = 'dot'; });
  link.on('rtt', v => $('rtt').textContent = 'RTT ' + v + 'ms');
  link.on('roster', m => {
    roster=m.units.filter(u=>u.id!==me);const escorted=roster.some(u=>u.role==='escort');$('escortPresence').textContent=escorted?'ESCORT ONLINE':'ESCORT OFFLINE · MISSION ACTIVE';$('escortPresence').className='tag '+(escorted?'ok':'');
    if (voice) voice.sync(roster.map(u => u.id));
  });
  link.on('ptt', m => {
    const el = $('rx');
    if (!NATIVE_RADIO) { if (m.state === 'start') fx.rxOpen(); else fx.rxClose(); }   // native radio plays its own sounds
    if (m.state === 'start') { el.textContent = '◉ ' + m.callsign; el.style.display = 'block'; el.style.borderColor = m.color; el.style.color = m.color; }
    else el.style.display = 'none';
  });
  link.on('mission', m => { mission = m.mission; startAt = mission.startAt || null; lastCd = null; applyRoute(); });
  link.on('mission.clock', m => { if (m.clockStart && !clockStart && !m.clockStop) { fx.go(); UL.toast('MISSION CLOCK RUNNING — GO', 'ok'); } clockStart = m.clockStart; clockStop = m.clockStop; targetSec = m.targetSec; renderClock(); });
  link.on('mission.ended', m => {
    ended = true; emergencyInbox.length=0; if(emergencyCurrent)clearTimeout(emergencyCurrent.timer); emergencyCurrent=null; if(speechAvailable())speechSynthesis.cancel(); try{SHELL?.stopEmergencySpeech?.();}catch(e){} pendingAlerts = []; savePending(); clearTimeout(retryT); app('stopTracking');
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
          <select id="rTheme" style="width:100%">${UL.themeOptions(v.theme)}</select></div>
        <div style="margin-top:10px"><label>Accent colour</label><input type="color" id="rAcc" value="${v.accent}" style="width:100%;height:34px"></div>
        <div style="margin-top:10px"><label>Units</label>
          <select id="rUnits" style="width:100%"><option value="metric" ${v.units === 'metric' ? 'selected' : ''}>metric</option><option value="imperial" ${v.units === 'imperial' ? 'selected' : ''}>imperial</option></select></div>
        <div style="margin-top:10px"><label>Interface scale <span class="muted">${v.fontScale}%</span></label>
          <input type="range" min="85" max="150" step="5" id="rScale" value="${v.fontScale}" style="width:100%"></div>
        <div class="row" style="margin-top:12px"><label style="flex:1">CRT scanlines</label><input type="checkbox" id="rScan" ${v.scanlines ? 'checked' : ''}></div>
        <div style="margin-top:10px"><label>Voice path</label>
          <select id="rVoice" style="width:100%"><option value="auto" ${(localStorage.ulVoice || 'auto') === 'auto' ? 'selected' : ''}>auto (P2P, fall back to relay)</option><option value="relay" ${localStorage.ulVoice === 'relay' ? 'selected' : ''}>relay only</option></select></div>
        ${SHELL && SHELL.resetServer ? '<button class="ghost" id="rServer" style="width:100%;margin-top:12px">CHANGE SERVER ADDRESS</button>' : ''}
        <button class="primary" style="width:100%;margin-top:16px;padding:14px" onclick="this.closest('dialog').close()">DONE</button></div>`;
      $('dlgR').showModal();
      if (SHELL && document.getElementById('rServer')) document.getElementById('rServer').onclick = () => { try { SHELL.resetServer(); } catch (e) {} };
      $('rTheme').onchange = e => cfg.set('theme', e.target.value);
      $('rAcc').oninput = e => cfg.set('accent', e.target.value);
      $('rUnits').onchange = e => { cfg.set('units', e.target.value); };
      $('rScale').oninput = e => cfg.set('fontScale', +e.target.value);
      $('rScan').onchange = e => cfg.set('scanlines', e.target.checked);
      $('rVoice').onchange = e => { localStorage.ulVoice = e.target.value; if (voice) { voice.mode = e.target.value; if (voice.mode === 'relay') [...voice.peers.keys()].forEach(id => voice.dropPeer(id)); else voice.sync(roster.map(u => u.id)); } };
    };
  }
  link.on('joined', m => {
    me = m.id; mission = m.mission; clearTimeout(retryT); alertJoined = true;
    try { pendingAlerts = JSON.parse(sessionStorage[alertKey()] || '[]'); } catch (e) { pendingAlerts = []; }
    riderAlerts = mission.riderAlerts || []; renderRiderAlerts();
    setTimeout(sendPending, 0);
    try { sessionStorage['ulRid:' + mission.code] = me; } catch (e) {}
    if (voice) { voice.selfId = me; voice.sync(roster.map(u => u.id)); }
    if (started && NATIVE_RADIO) startNativeRadio();
    $('login').style.display = 'none'; $('app').style.display = 'flex';
    $('mis').textContent = mission.code + ' · ' + mission.name;
    $('cs').textContent = localStorage.ulCallsign;
    $('src').textContent = useBle ? 'GPS+BLE' : 'GPS';
    clockStart=mission.clockStart||null;clockStop=mission.clockStop||null;targetSec=mission.targetSec||null;startAt=mission.startAt||null;
    if (started) { me=m.id;sendBattery();return; }
    started = true;
    clockStart = mission.clockStart || null; clockStop = mission.clockStop || null; targetSec = mission.targetSec || null; startAt = mission.startAt || null;
    applyRoute();initSectors();if(m.timing?.[localStorage.ulCallsign])sectorTimer?.units.set('me',m.timing[localStorage.ulCallsign]);
    startBattery();startGeo();startVoice();keepAwake();buildRiderSettings();
    setInterval(() => { renderClock(); }, 500);
    if (useBle) pairBle();
  });

  function applyRoute() {
    if (mission && mission.route && mission.route.length) {
      tel.setRoute(UL.buildRoute(mission.route.map(p => ({ lat: p[0], lon: p[1], ele: p[2] || 0 }))));
      if (mission.laps > 1) { try { const k = +sessionStorage['ulIdx:' + mission.code]; if (k >= 0) tel.lastIdx = k; } catch (e) {} }   // lap routes: resume on the right lap after a reload
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
      finish: (k, i, dur, sc) => { fx.sectorDone(); if (navigator.vibrate) navigator.vibrate(120); const dl = sc.target ? dur - sc.target : null; if (dl != null) UL.deltaPop(sc.name + ' · ' + UL.hmsStr(dur), dl); else UL.toast(sc.name + ' ' + UL.hmsStr(dur), 'ok', 5000); }
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
    restartWatch();
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

  /* ---------------------------------------------- escort pressed ⟳ REFRESH GPS
   * restart the GPS, take a brand-new high-accuracy fix and send it straight away (tagged with the request id) */
  let freshRid = null, geoWatch = null;
  link.on('gps.refresh', m => {
    if (!started || ended) return;
    freshRid = m.rid; link.kick();
    UL.toast('↻ ' + (m.callsign || 'ESCORT') + ' REFRESHED GPS', 'ok', 1800);
    const sendNow = () => { if (!freshRid) return; if (tel.state && tel.state.lat != null) { lastTx = Date.now(); link.send({ t: 'telemetry', data: tel.state, fresh: freshRid }); } freshRid = null; };
    if (APP) {                                  // native GPS in the app: ask for one fresh fix (newer app versions), else send the latest
      if (APP.requestFix) { app('requestFix'); setTimeout(sendNow, 6000); } else sendNow();
      return;
    }
    if (!navigator.geolocation) return sendNow();
    restartWatch();
    const t = setTimeout(sendNow, 10500);
    navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); tel.onPosition(p); }, () => { clearTimeout(t); sendNow(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  });
  function restartWatch() {
    if (!navigator.geolocation) return;
    if (geoWatch != null) { try { navigator.geolocation.clearWatch(geoWatch); } catch (e) {} }
    geoWatch = navigator.geolocation.watchPosition(p => tel.onPosition(p), e => { $('acc').textContent = 'GPS ERR ' + e.code; $('acc').className = 'tag bad'; }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }

  /* ---------------------------------------------------------- telemetry  */
  let lastTx = 0;
  tel.addEventListener('update', e => {
    if (mission && mission.laps > 1 && tel.lastIdx != null) { try { sessionStorage['ulIdx:' + mission.code] = tel.lastIdx; } catch (x) {} }
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
      /* off-route alerts are for the escorts only — nothing is shown or played on the rider phone */
      $('off').textContent = 'ROUTE LOCKED'; $('off').className = 'tag ok';
    }
    renderClock();
    drawProfile();
    if (sectorTimer) { sectorTimer.feed('me', s.covered, s.ts || Date.now()); renderSector(); }
    const now = Date.now();
    if (now - lastTx > 1000 || freshRid) { lastTx = now; const msg = { t: 'telemetry', data: s }; if (freshRid) { msg.fresh = freshRid; freshRid = null; } link.send(msg); }
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
  function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; }
  function startNativeRadio() { app('startRadio', wsUrl(), mission.code, me, localStorage.ulCallsign || ''); }
  /* native radio status → PTT button + voice tag (also called when the Bluetooth button keys the radio) */
  function radioUi(state, tx) {
    live = !!tx;
    btn.classList.toggle('live', live);
    btn.firstChild.textContent = live ? '◉ TRANSMITTING' : 'PUSH TO TALK';
    $('vmode').textContent = 'RADIO ' + (state || '--');
    $('vmode').className = 'tag ' + (state === 'READY' ? 'ok' : state === 'LINKING' || state === 'WAITING' ? '' : 'bad');
  }
  function startVoice() {
    if (NATIVE_RADIO) {                  // no WebRTC / web mic in the page: the app's radio does it
      startNativeRadio();
      let st = 'LINKING'; try { st = APP.radioState() || st; } catch (e) {}
      radioUi(st, false);
      return;
    }
    voice = new UL.VoiceNet(link, { mode: localStorage.ulVoice === 'relay' ? 'relay' : 'auto' });
    voice.selfId=me;
    voice.on('micstate',s=>{if(!s.ready)shut();});
    link.on('close',()=>shut());
    voice.on('txfault',reason=>{shut();$('ptt').firstChild.textContent='RADIO FAULT — CHECK INPUT';UL.toast(reason,'bad',5000);});
    voice.on('blocked', () => $('tapAudio').classList.add('show'));
    voice.on('unblocked', () => $('tapAudio').classList.remove('show'));
    $('tapAudio').onclick = () => { voice.audioCtx(); $('tapAudio').classList.remove('show'); };
    voice.mic().catch(() => { $('ptt').firstChild.textContent = 'MIC BLOCKED — CHECK PERMISSIONS'; });
    voice.sync(roster.map(u => u.id));
    setInterval(() => {
      const s = voice.summary();
      $('vmode').textContent = !s.mic ? 'MIC OFF' : s.mode === 'relay' ? 'VOICE RELAY' : 'VOICE P2P ' + s.p2p + '/' + s.total;
      $('vmode').className='tag '+(!s.mic||s.fault?'bad':s.p2p<s.total?'':'ok');$('vmode').title=s.status;
    }, 1000);
  }
  const btn = $('ptt');
  let live = false;
  /* voice.transmit() prepares healthy audio before announcing PTT; release() cancels preparation and closes both */
  const open = () => { if (NATIVE_RADIO) return app('radioPtt', true); if (live || !voice) return; live = true; fx.pttOpen(); if(!voice.transmit('all',140)){live=false;return;}btn.classList.add('live'); btn.firstChild.textContent = '◉ TRANSMITTING'; navigator.vibrate?.(30); app('setTalking', true); };
  const shut = () => { if (NATIVE_RADIO) return app('radioPtt', false); if (!live) return; live = false; voice.release(); fx.pttClose(); btn.classList.remove('live'); btn.firstChild.textContent = 'PUSH TO TALK'; app('setTalking', false); };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (x) {} open(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => btn.addEventListener(t, shut));
  btn.oncontextmenu = e => e.preventDefault();
  // laptops: hold Space · Bluetooth PTT remotes usually emit media/volume keys
  addEventListener('keydown', e => { if (NATIVE_RADIO && e.key === 'MediaPlayPause') return; if (!started || e.repeat || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || document.querySelector('dialog[open]')) return; if ([' ', 'MediaPlayPause', 'AudioVolumeUp', 'Enter'].includes(e.key)) { e.preventDefault(); open(); } });
  addEventListener('keyup', e => { if (NATIVE_RADIO && e.key === 'MediaPlayPause') return; if ([' ', 'MediaPlayPause', 'AudioVolumeUp', 'Enter'].includes(e.key)) shut(); });
  if ('mediaSession' in navigator && !NATIVE_RADIO) {          // the app's media session handles the headset button itself
    try {
      navigator.mediaSession.setActionHandler('play', () => { open(); setTimeout(shut, 2500); });
      navigator.mediaSession.setActionHandler('pause', shut);
    } catch (e) {}
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__rider = { get voice() { return voice; }, get me() { return me; } };
})();
