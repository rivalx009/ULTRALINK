/* ULTRALINK — synthesized sound effects (+ radio-open.mp3 line-open sound, off-course-alert.mp3 off-course alarm). F1-style radio keying + UI feedback. */
(function (global) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  const S = { enabled: true, volume: 0.55, ui: false };   // ui = optional interface clicks / whooshes (off by default)

  function ensure() {
    if (!S.enabled) return null;
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = S.volume;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      const n = ctx.sampleRate * 1.5;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      loadClip();
    }
    if (ctx.state === 'suspended' && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) ctx.resume().catch(() => {});
    return ctx;
  }
  /* browsers require a gesture: unlock on first interaction */
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    addEventListener(ev, () => { if (S.enabled) ensure(); }, { once: false, passive: true, capture: true }));

  function tone(freq, dur, o) {
    const c = ensure(); if (!c) return;
    o = o || {};
    const t0 = c.currentTime + (o.at || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const peak = (o.gain == null ? 0.25 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  /* audio clips, decoded once into the shared audio context */
  const CLIPS = { open: { url: 'radio-open.mp3' }, offCourse: { url: 'off-course-alert.mp3' }, riderDown: { url: 'rider-down-alert.mp3' }, mechanical: { url: 'mechanical-alert.mp3' }, emergencyYes: { url: 'emergency-yes.mp3' }, emergencyNo: { url: 'emergency-no.mp3' }, emergencyUnderstood: { url: 'emergency-understood.mp3' } };
  function loadClip() {
    if (!ctx) return;
    Object.values(CLIPS).forEach(k => {
      if (k.buf || k.loading) return; k.loading = true;
      fetch(k.url).then(r => r.ok ? r.arrayBuffer() : Promise.reject())
        .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)))
        .then(buf => { k.buf = buf; if (k === CLIPS[alarm.kind] && alarm.on && !alarm.src) startAlarmClip(); })
        .catch(() => { k.loading = false; });
    });
  }
  function playClip(fallback) {
    const c = ensure(); if (!c) return;
    if (!CLIPS.open.buf) { loadClip(); return fallback(); }   // not loaded yet: use the old beep this once
    const src = c.createBufferSource(); src.buffer = CLIPS.open.buf; src.connect(master); src.start();
  }
  /* off-course alarm: "WARNING. OFF COURSE. OFF COURSE. WARNING." on a loop until stopped (MASTER ALERT) */
  const alarm = { on: false, kind: 'offCourse', src: null, gain: null, beepT: null };
  function startAlarmClip() {
    const c = ensure(); if (!c || !CLIPS[alarm.kind].buf) return false;
    clearInterval(alarm.beepT); alarm.beepT = null;
    const g = c.createGain(); g.gain.value = 1; g.connect(master);
    const src = c.createBufferSource(); src.buffer = CLIPS[alarm.kind].buf; src.loop = true; src.connect(g); src.start();
    alarm.src = src; alarm.gain = g; return true;
  }
  function noise(dur, o) {
    const c = ensure(); if (!c) return;
    o = o || {};
    const t0 = c.currentTime + (o.at || 0);
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = o.type || 'bandpass';
    bp.frequency.setValueAtTime(o.freq || 2200, t0);
    if (o.to) bp.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    bp.Q.value = o.q || 1.2;
    const g = c.createGain();
    const peak = o.gain == null ? 0.3 : o.gain;
    g.gain.setValueAtTime(o.attack === 0 ? peak : 0.0001, t0);
    if (o.attack !== 0) g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.02);
  }

  const fx = {
    state: S,
    setEnabled(v) { S.enabled = !!v; if (v) ensure(); },
    setVolume(v) { S.volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = S.volume; },
    unlock() { ensure(); },

    /* ---- generic UI ---- */
    click() { if (!S.ui) return; tone(1700, 0.03, { type: 'square', gain: 0.06 }); tone(1100, 0.03, { type: 'square', gain: 0.04, at: 0.025 }); },
    tick() { if (!S.ui) return; tone(2400, 0.015, { type: 'square', gain: 0.03 }); },
    select() { if (!S.ui) return; tone(660, 0.05, { type: 'triangle', gain: 0.14 }); tone(990, 0.08, { type: 'triangle', gain: 0.14, at: 0.05 }); },
    open() { if (!S.ui) return; noise(0.22, { freq: 400, to: 3000, q: 0.8, gain: 0.12 }); tone(320, 0.18, { to: 880, type: 'sawtooth', gain: 0.05 }); },
    close() { if (!S.ui) return; noise(0.18, { freq: 3000, to: 400, q: 0.8, gain: 0.1 }); tone(880, 0.15, { to: 300, type: 'sawtooth', gain: 0.04 }); },
    success() { if (!S.ui) return; tone(880, 0.08, { type: 'triangle', gain: 0.16 }); tone(1320, 0.14, { type: 'triangle', gain: 0.16, at: 0.08 }); },
    error() { tone(300, 0.12, { type: 'triangle', gain: 0.1 }); tone(220, 0.16, { type: 'triangle', gain: 0.1, at: 0.11 }); },
    alert() { tone(880, 0.16, { type: 'square', gain: 0.07 }); tone(660, 0.2, { type: 'square', gain: 0.07, at: 0.2 }); },
    alarmStart(kind = 'offCourse') {
      if (!CLIPS[kind]) return;
      if (alarm.on && alarm.kind === kind) return;
      fx.alarmStop(); alarm.kind = kind; alarm.on = true;
      if (startAlarmClip()) return;
      loadClip(); fx.alert(); alarm.beepT = setInterval(() => { if (alarm.on && !alarm.src) fx.alert(); }, 1500);   // until the voice clip has loaded
    },
    alarmStop() {
      alarm.on = false; clearInterval(alarm.beepT); alarm.beepT = null;
      if (alarm.src) { try { alarm.src.stop(); } catch (e) {} try { alarm.gain.disconnect(); } catch (e) {} }
      alarm.src = null; alarm.gain = null;
    },
    get alarmOn() { return alarm.on; },
    get alarmKind() { return alarm.on ? alarm.kind : null; },
    async emergencyPreset(word) {
      const key = { YES:'emergencyYes', NO:'emergencyNo', UNDERSTOOD:'emergencyUnderstood' }[word];
      const c = ensure(); if (!c || !key || S.volume === 0) throw new Error('muted');
      if (c.state === 'suspended') { try { await c.resume(); } catch(e) { throw new Error('blocked'); } }
      if (c.state !== 'running') throw new Error('blocked');
      const clip = CLIPS[key];
      if (!clip.buf) { const response = await fetch(clip.url); if (!response.ok) throw new Error('failed'); clip.buf = await c.decodeAudioData(await response.arrayBuffer()); }
      return new Promise((resolve, reject) => {
        const src = c.createBufferSource(); src.buffer = clip.buf; src.connect(master);
        src.onended = () => { src.disconnect(); resolve(); };
        try { src.start(); } catch(e) { reject(e); }
      });
    },
    save() { if (!S.ui) return; tone(1040, 0.05, { type: 'triangle', gain: 0.14 }); tone(1560, 0.05, { type: 'triangle', gain: 0.14, at: 0.06 }); tone(2080, 0.1, { type: 'triangle', gain: 0.12, at: 0.12 }); },
    remove() { if (!S.ui) return; tone(600, 0.1, { to: 200, type: 'sawtooth', gain: 0.1 }); noise(0.1, { freq: 900, gain: 0.08, at: 0.02 }); },

    /* ---- radio: line open = radio-open.mp3, soft squelch tail on close ---- */
    pttOpen() { playClip(() => { tone(1250, 0.05, { type: 'sine', gain: 0.1 }); tone(1250, 0.05, { type: 'sine', gain: 0.1, at: 0.08 }); }); },
    pttClose() { noise(0.08, { freq: 2600, to: 1000, q: 0.8, gain: 0.08, attack: 0 }); tone(880, 0.05, { type: 'sine', gain: 0.08, at: 0.03 }); },
    rxOpen() { playClip(() => tone(1050, 0.05, { type: 'sine', gain: 0.09 })); },
    rxClose() { noise(0.07, { freq: 2400, to: 900, q: 0.8, gain: 0.07, attack: 0 }); },

    /* ---- mission ---- */
    countdown(n) { if (n <= 5) tone(n <= 1 ? 1040 : 880, 0.06, { type: 'sine', gain: 0.1 }); },
    go() { tone(880, 0.18, { type: 'triangle', gain: 0.12 }); tone(1320, 0.28, { type: 'triangle', gain: 0.1, at: 0.16 }); },
    checkpoint() { tone(1100, 0.08, { type: 'sine', gain: 0.1 }); },
    sectorDone() { tone(880, 0.08, { type: 'sine', gain: 0.1 }); tone(1320, 0.1, { type: 'sine', gain: 0.09, at: 0.09 }); },
    abort() { fx.alert(); },

    /* boot sounds removed (kept as no-ops for compatibility) */
    bootHum() {}, blip() {}, bootStep() {}, bootDone() {}
  };
  global.UL = global.UL || {};
  global.UL.fx = fx;
})(window);
