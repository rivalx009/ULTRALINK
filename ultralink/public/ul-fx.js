/* ULTRALINK — synthesized sound effects (no audio files). F1-style radio keying + UI feedback. */
(function (global) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  const S = { enabled: true, volume: 0.7 };

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
    click() { tone(1700, 0.03, { type: 'square', gain: 0.06 }); tone(1100, 0.03, { type: 'square', gain: 0.04, at: 0.025 }); },
    tick() { tone(2400, 0.015, { type: 'square', gain: 0.03 }); },
    select() { tone(660, 0.05, { type: 'triangle', gain: 0.14 }); tone(990, 0.08, { type: 'triangle', gain: 0.14, at: 0.05 }); },
    open() { noise(0.22, { freq: 400, to: 3000, q: 0.8, gain: 0.12 }); tone(320, 0.18, { to: 880, type: 'sawtooth', gain: 0.05 }); },
    close() { noise(0.18, { freq: 3000, to: 400, q: 0.8, gain: 0.1 }); tone(880, 0.15, { to: 300, type: 'sawtooth', gain: 0.04 }); },
    success() { tone(880, 0.08, { type: 'triangle', gain: 0.16 }); tone(1320, 0.14, { type: 'triangle', gain: 0.16, at: 0.08 }); },
    error() { tone(220, 0.18, { type: 'sawtooth', gain: 0.12 }); tone(180, 0.22, { type: 'sawtooth', gain: 0.12, at: 0.14 }); },
    alert() { for (let i = 0; i < 3; i++) { tone(760, 0.14, { type: 'square', gain: 0.12, at: i * 0.3 }); tone(520, 0.14, { type: 'square', gain: 0.12, at: i * 0.3 + 0.15 }); } },
    save() { tone(1040, 0.05, { type: 'triangle', gain: 0.14 }); tone(1560, 0.05, { type: 'triangle', gain: 0.14, at: 0.06 }); tone(2080, 0.1, { type: 'triangle', gain: 0.12, at: 0.12 }); },
    remove() { tone(600, 0.1, { to: 200, type: 'sawtooth', gain: 0.1 }); noise(0.1, { freq: 900, gain: 0.08, at: 0.02 }); },

    /* ---- radio (Formula-1 style): key-click + beep + squelch hiss; release = squelch tail + roger beep ---- */
    pttOpen() {
      noise(0.03, { freq: 3800, q: 0.7, gain: 0.35, attack: 0 });
      tone(1250, 0.07, { type: 'sine', gain: 0.22, at: 0.025 });
      tone(1250, 0.07, { type: 'sine', gain: 0.22, at: 0.12 });
      noise(0.22, { freq: 2200, to: 1500, q: 0.9, gain: 0.05, at: 0.2 });
    },
    pttClose() {
      noise(0.16, { freq: 3200, to: 900, q: 0.8, gain: 0.22, attack: 0 });
      tone(880, 0.06, { type: 'sine', gain: 0.18, at: 0.05 });
      noise(0.03, { freq: 4200, q: 0.7, gain: 0.25, at: 0.16 });
    },
    rxOpen() {
      noise(0.03, { freq: 3400, q: 0.7, gain: 0.28, attack: 0 });
      tone(1050, 0.06, { type: 'sine', gain: 0.18, at: 0.03 });
      noise(0.18, { freq: 2000, to: 1400, q: 0.9, gain: 0.05, at: 0.1 });
    },
    rxClose() { noise(0.14, { freq: 3000, to: 800, q: 0.8, gain: 0.2, attack: 0 }); tone(760, 0.05, { gain: 0.14, at: 0.04 }); },

    /* ---- mission ---- */
    countdown(n) { tone(n <= 3 ? 1040 : 780, 0.08, { type: 'square', gain: 0.12 }); },
    go() { tone(880, 0.55, { type: 'sawtooth', gain: 0.14 }); tone(1320, 0.55, { type: 'sawtooth', gain: 0.1 }); tone(1760, 0.6, { type: 'triangle', gain: 0.1, at: 0.02 }); },
    checkpoint() { tone(900, 0.07, { type: 'triangle', gain: 0.18 }); tone(1350, 0.11, { type: 'triangle', gain: 0.18, at: 0.08 }); },
    sectorDone() { [700, 880, 1180, 1400].forEach((f, i) => tone(f, 0.11, { type: 'triangle', gain: 0.17, at: i * 0.075 })); },
    abort() { fx.alert(); noise(0.9, { freq: 200, to: 60, type: 'lowpass', q: 1, gain: 0.25 }); },

    /* ---- boot sequence ---- */
    bootHum() {
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime;
      [55, 82.5, 110].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.03 / (i + 1), t0 + 1.2);
        g.gain.linearRampToValueAtTime(0.0001, t0 + 7.5);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(140, t0); lp.frequency.linearRampToValueAtTime(700, t0 + 6);
        o.connect(lp); lp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 7.6);
      });
    },
    blip() { tone(1900 + Math.random() * 600, 0.02, { type: 'square', gain: 0.04 }); },
    bootStep() { tone(1200, 0.05, { type: 'triangle', gain: 0.1 }); tone(1800, 0.07, { type: 'triangle', gain: 0.09, at: 0.05 }); },
    bootDone() {
      noise(0.9, { freq: 200, to: 5000, q: 0.6, gain: 0.16 });
      [330, 495, 660, 990].forEach((f, i) => tone(f, 0.7, { type: 'triangle', gain: 0.1, at: 0.1 + i * 0.05 }));
    }
  };
  global.UL = global.UL || {};
  global.UL.fx = fx;
})(window);
