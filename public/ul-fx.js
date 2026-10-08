/* ULTRALINK — synthesized sound effects (+ radio-open.mp3 for the line-open sound). F1-style radio keying + UI feedback. */
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
  /* line-open sound: radio-open.mp3, decoded once into the shared audio context */
  let clip = null, clipLoading = false;
  function loadClip() {
    if (clip || clipLoading || !ctx) return; clipLoading = true;
    fetch('radio-open.mp3').then(r => r.ok ? r.arrayBuffer() : Promise.reject())
      .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)))
      .then(buf => { clip = buf; }).catch(() => { clipLoading = false; });
  }
  function playClip(fallback) {
    const c = ensure(); if (!c) return;
    if (!clip) { loadClip(); return fallback(); }   // not loaded yet: use the old beep this once
    const src = c.createBufferSource(); src.buffer = clip; src.connect(master); src.start();
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
