/* ULTRALINK — COMMS MODE: open-line intercom. Every device is a single unit on a numbered channel.
 * No roles, no telemetry, no location — only push-to-talk voice (same WebRTC P2P + relay engine as the race radio). */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = new UL.Link(), fx = UL.fx, cfg = new UL.Settings(); cfg.apply();
  let voice = null, me = null, chan = null, call = '', started = false, roster = [], talking = new Set(), resumeId;
  const fmt = id => String(id).replace(/(\d{3})(\d{3})/, '$1 $2');
  const clean = v => String(v || '').replace(/\D/g, '').slice(0, 6);
  const SHELL = window.UltraApp || null;
  const app = (fn, ...a) => { try { SHELL && SHELL[fn] && SHELL[fn](...a); } catch (e) {} };

  /* ---------------------------------------------------------------- start screen */
  $('call').value = localStorage.ulCommsCall || localStorage.ulCallsign || '';
  const err = m => { $('err').textContent = m || ''; if (m) fx.error(); };
  const needCall = () => { call = $('call').value.trim().toUpperCase(); if (!call) { err('ENTER YOUR CALLSIGN'); $('call').focus(); return false; } localStorage.ulCommsCall = call; return true; };
  $('joinT').onclick = () => { $('joinBox').classList.toggle('show'); if ($('joinBox').classList.contains('show')) setTimeout(() => $('chId').focus(), 50); fx.tick(); };
  $('chId').oninput = e => { const v = clean(e.target.value); e.target.value = v.length > 3 ? v.slice(0, 3) + ' ' + v.slice(3) : v; };
  $('chId').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
  const q = new URLSearchParams(location.search).get('ch'); if (q && clean(q).length === 6) { $('joinBox').classList.add('show'); $('chId').value = fmt(clean(q)); }
  async function micFirst() { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch (e) {} fx.unlock && fx.unlock(); }
  $('create').onclick = async () => {
    if (!needCall()) return; err(''); $('create').textContent = 'CREATING…';
    await micFirst(); link.connect(); link.send({ t: 'channel.create', callsign: call });
  };
  $('join').onclick = async () => {
    if (!needCall()) return; const id = clean($('chId').value);
    if (id.length !== 6) return err('THE CHANNEL ID HAS 6 DIGITS');
    err(''); $('join').textContent = 'JOINING…'; await micFirst(); joinCh(id);
  };
  function joinCh(id) {
    chan = id; try { resumeId = sessionStorage['ulCh:' + id] || undefined; } catch (e) {}
    if (!link.url) link.connect();
    link.send({ t: 'join', code: id, role: 'unit', callsign: call, resume: me || resumeId });
  }

  /* ---------------------------------------------------------------- link */
  link.on('channel.created', m => { joinCh(m.id); });
  link.on('error', m => {
    if (m.code === 'NO_CHANNEL') {
      if (started && chan) { link.send({ t: 'channel.create', id: chan, callsign: call }); return; }    // relay restarted: re-open the same channel
      $('join').textContent = 'JOIN CHANNEL'; $('create').textContent = '＋ CREATE CHANNEL'; chan = null;
      return err('CHANNEL ' + fmt(clean($('chId').value)) + ' NOT FOUND — check the number');
    }
  });
  link.on('open', () => { $('lnk').className = 'dot ok'; if (started && chan) link.send({ t: 'join', code: chan, role: 'unit', callsign: call, resume: me }); });
  link.on('close', () => { $('lnk').className = 'dot'; });
  link.on('joined', m => {
    me = m.id; try { sessionStorage['ulCh:' + chan] = me; } catch (e) {}
    if (voice) { voice.selfId = me; voice.sync(roster.map(u => u.id)); }
    if (started) return;
    started = true;
    $('start').style.display = 'none'; $('app').style.display = 'flex';
    $('cid').textContent = fmt(chan); $('me').textContent = call;
    history.replaceState(null, '', 'comms.html?ch=' + chan);
    startVoice(); fx.success(); log('CHANNEL ' + fmt(chan) + ' OPEN — share the ID with the other units');
    UL.toast('CHANNEL ' + fmt(chan), 'ok');
  });
  link.on('roster', m => {
    const before = new Set(roster.map(u => u.id));
    roster = m.units.filter(u => u.id !== me);
    roster.forEach(u => { if (started && !before.has(u.id)) { log(u.callsign + ' JOINED'); fx.success(); } });
    before.forEach(id => { if (!roster.some(u => u.id === id)) { log('UNIT LEFT'); talking.delete(id); } });
    if (voice) voice.sync(roster.map(u => u.id));
    renderUnits();
  });
  link.on('ptt', m => {
    if (m.state === 'start') { talking.add(m.from); fx.rxOpen(); $('rx').style.display = 'block'; $('rx').textContent = '◉ ' + m.callsign; $('rx').style.borderColor = m.color; $('rx').style.color = m.color; log(m.callsign + ' talking'); }
    else { talking.delete(m.from); fx.rxClose(); if (!talking.size) $('rx').style.display = 'none'; }
    renderUnits();
  });
  function renderUnits() {
    if (!started) return;
    const list = [{ id: me, callsign: call + ' (YOU)', color: 'var(--accent)', self: true }, ...roster.slice().sort((a, b) => a.callsign.localeCompare(b.callsign))];
    const vs = voice ? voice : null;
    $('units').innerHTML = list.map(u => {
      const tx = u.self ? live : talking.has(u.id), p2p = !u.self && vs && vs.p2pUp(u.id);
      return `<div class="unit ${tx ? 'tx' : ''}"><i style="background:${u.color}"></i><span>${esc(u.callsign)}</span><span class="st">${tx ? '◉ TALKING' : u.self ? 'ON CHANNEL' : p2p ? 'DIRECT' : 'VIA RELAY'}</span></div>`;
    }).join('');
    $('ucount').textContent = list.length;
  }
  function log(t) {
    const d = new Date(), el = document.createElement('div');
    el.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ' + t;
    $('clog').prepend(el); while ($('clog').children.length > 40) $('clog').lastChild.remove();
  }

  /* ---------------------------------------------------------------- voice */
  function startVoice() {
    voice = new UL.VoiceNet(link, { mode: localStorage.ulVoice === 'relay' ? 'relay' : 'auto' });
    voice.selfId = me;
    voice.on('blocked', () => $('tapAudio').classList.add('show'));
    voice.on('unblocked', () => $('tapAudio').classList.remove('show'));
    voice.on('state', () => renderUnits());
    $('tapAudio').onclick = () => { voice.audioCtx(); $('tapAudio').classList.remove('show'); };
    voice.mic().catch(() => { $('ptt').firstChild.textContent = 'MIC BLOCKED — CHECK PERMISSIONS'; });
    voice.sync(roster.map(u => u.id));
    setInterval(() => {
      const s = voice.summary();
      $('vmode').textContent = !s.mic ? 'MIC OFF' : s.mode === 'relay' ? 'VOICE RELAY' : 'VOICE P2P ' + s.p2p + '/' + s.total;
      $('vmode').className = 'tag ' + (!s.mic ? 'bad' : s.p2p < s.total ? '' : 'ok');
    }, 1000);
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { link.kick(); voice.recover(); try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {} } });
  }
  const btn = $('ptt'); let live = false, latch = false;
  const open = () => { if (live || !voice) return; live = true; fx.pttOpen(); voice.transmit('all', 140); btn.classList.add('live'); btn.firstChild.textContent = '◉ TRANSMITTING'; navigator.vibrate && navigator.vibrate(30); app('setTalking', true); renderUnits(); };
  const shut = () => { if (!live) return; live = false; voice.release(); fx.pttClose(); btn.classList.remove('live'); btn.firstChild.textContent = latch ? 'TAP TO TALK' : 'PUSH TO TALK'; app('setTalking', false); renderUnits(); };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); if (latch) { live ? shut() : open(); return; } try { btn.setPointerCapture(e.pointerId); } catch (x) {} open(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => btn.addEventListener(t, () => { if (!latch) shut(); }));
  btn.oncontextmenu = e => e.preventDefault();
  $('latch').onclick = () => { latch = !latch; if (!latch) shut(); $('latch').classList.toggle('on', latch); $('latch').textContent = latch ? '◉ HANDS-FREE: ON' : '◎ HANDS-FREE: OFF'; if (!live) btn.firstChild.textContent = latch ? 'TAP TO TALK' : 'PUSH TO TALK'; fx.tick(); };
  const KEYS = [' ', 'MediaPlayPause', 'AudioVolumeUp'];
  addEventListener('keydown', e => { if (!started || e.repeat || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return; if (KEYS.includes(e.key)) { e.preventDefault(); latch ? (live ? shut() : open()) : open(); } });
  addEventListener('keyup', e => { if (KEYS.includes(e.key) && !latch) shut(); });
  if ('mediaSession' in navigator) { try { navigator.mediaSession.setActionHandler('play', () => { live ? shut() : open(); }); navigator.mediaSession.setActionHandler('pause', shut); } catch (e) {} }
  window.ULNative = { ptt(on) { on ? open() : shut(); }, togglePtt() { live ? shut() : open(); }, resume() { link.kick(); voice && voice.recover(); }, onPos() {}, onGpsError() {} };

  /* ---------------------------------------------------------------- channel actions */
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText(chan); UL.toast('CHANNEL ID COPIED', 'ok'); } catch (e) { UL.toast('ID ' + fmt(chan), 'ok'); } fx.tick(); };
  $('share').onclick = async () => {
    const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'comms.html?ch=' + chan, text = 'ULTRALINK comms channel ' + fmt(chan);
    if (navigator.share) { try { await navigator.share({ title: 'ULTRALINK COMMS', text, url }); } catch (e) {} } else { try { await navigator.clipboard.writeText(text + ' — ' + url); UL.toast('LINK COPIED', 'ok'); } catch (e) {} }
  };
  $('leave').onclick = async () => {
    if (!(await UL.confirm('LEAVE CHANNEL', `Leave channel <b>${fmt(chan)}</b>? You can come back with the same ID.`, { yes: 'LEAVE', danger: true }))) return;
    shut(); link.send({ t: 'leave' }); try { sessionStorage.removeItem('ulCh:' + chan); } catch (e) {}
    setTimeout(() => location.href = 'comms.html', 150);
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__comms = { get voice() { return voice; }, get me() { return me; }, get chan() { return chan; }, get roster() { return roster; } };
})();
