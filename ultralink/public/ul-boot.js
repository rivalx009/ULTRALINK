/* ULTRALINK — immersive boot / loading screen
 * Procedural topographic contour map + tactical grid with slow zoom in/out, radar sweep, target blips,
 * and a real system-check sequence (GPS, relay, radio, map tiles, mission profiles). */
(function (global) {
  'use strict';

  /* ---------------- procedural terrain ---------------- */
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function makeNoise(seed) {
    const r = rng(seed), N = 256, g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
    const sm = t => t * t * (3 - 2 * t);
    const v = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
    return (x, y) => { let s = 0, a = 0.55, f = 1; for (let o = 0; o < 5; o++) { s += a * v(x * f, y * f); a *= 0.5; f *= 2; } return s; };
  }
  /** marching squares -> {levelIndex: Path2D} in world px */
  function contours(H, W, Hh, cell, levels) {
    const out = levels.map(() => new Path2D());
    const V = (i, j) => H[j * W + i];
    for (let li = 0; li < levels.length; li++) {
      const L = levels[li], P = out[li];
      const lerp = (a, b) => (L - a) / (b - a);
      for (let j = 0; j < Hh - 1; j++) for (let i = 0; i < W - 1; i++) {
        const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
        let m = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (m === 0 || m === 15) continue;
        const x0 = i * cell, y0 = j * cell;
        const T = [x0 + lerp(a, b) * cell, y0], R = [x0 + cell, y0 + lerp(b, c) * cell], B = [x0 + lerp(d, c) * cell, y0 + cell], Lf = [x0, y0 + lerp(a, d) * cell];
        const seg = (p, q) => { P.moveTo(p[0], p[1]); P.lineTo(q[0], q[1]); };
        switch (m) {
          case 1: case 14: seg(Lf, B); break;
          case 2: case 13: seg(B, R); break;
          case 3: case 12: seg(Lf, R); break;
          case 4: case 11: seg(T, R); break;
          case 5: seg(T, Lf); seg(B, R); break;
          case 10: seg(T, R); seg(Lf, B); break;
          case 6: case 9: seg(T, B); break;
          case 7: case 8: seg(T, Lf); break;
        }
      }
    }
    return out;
  }

  const CSS = `
  #boot{position:fixed;inset:0;z-index:10000;background:#020608;overflow:hidden;font-family:var(--mono);color:var(--fg);transition:opacity .9s ease,transform .9s cubic-bezier(.6,0,.9,.4)}
  #boot.out{opacity:0;transform:scale(2.6)}
  #boot canvas{position:absolute;inset:0;width:100%;height:100%}
  #boot .vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 35%,rgba(0,4,6,.85) 100%)}
  #boot .scanl{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 3px);opacity:.5}
  #boot .corner{position:absolute;width:38px;height:38px;border:2px solid var(--accent);opacity:.85}
  #boot .c1{left:26px;top:26px;border-right:0;border-bottom:0}#boot .c2{right:26px;top:26px;border-left:0;border-bottom:0}
  #boot .c3{left:26px;bottom:26px;border-right:0;border-top:0}#boot .c4{right:26px;bottom:26px;border-left:0;border-top:0}
  #boot .tl,#boot .tr{position:absolute;top:34px;font-size:10px;letter-spacing:.25em;color:var(--dim);line-height:1.9}
  #boot .tl{left:84px}#boot .tr{right:84px;text-align:right}
  #boot .mid{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none}
  #boot .ttl{font-size:clamp(26px,4.4vw,64px);letter-spacing:.42em;padding-left:.42em;text-shadow:0 0 30px rgba(0,229,255,.55),0 0 2px #fff;font-weight:600}
  #boot .ttl span{color:var(--accent)}
  #boot .subt{margin-top:18px;font-size:clamp(11px,1.15vw,16px);letter-spacing:.32em;color:#9fe8f6;min-height:1.6em;text-transform:uppercase}
  #boot .subt i{font-style:normal;animation:bl 1s steps(2) infinite}
  #boot .bar{width:min(560px,70vw);height:6px;margin:26px auto 0;border:1px solid var(--line2);display:flex;gap:2px;padding:1px;background:rgba(0,10,14,.6)}
  #boot .bar b{flex:1;background:transparent;transition:background .25s,box-shadow .25s}
  #boot .bar b.on{background:var(--accent);box-shadow:0 0 8px var(--accent)}
  #boot .pct{margin-top:8px;font-size:11px;letter-spacing:.3em;color:var(--dim)}
  #boot .log{position:absolute;left:84px;bottom:36px;font-size:11px;letter-spacing:.14em;line-height:1.85;color:var(--dim);max-width:46vw}
  #boot .log div{white-space:nowrap}
  #boot .log .ok{color:var(--good)}#boot .log .wn{color:var(--warn)}#boot .log .er{color:var(--bad)}
  #boot .skip{position:absolute;right:84px;bottom:36px;font-size:10px;letter-spacing:.3em;color:var(--dim);opacity:0;transition:opacity .5s}
  #boot .skip.show{opacity:.9}
  `;

  function run(opts) {
    opts = opts || {};
    const root = document.getElementById('boot');
    if (!root) return Promise.resolve({});
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root.innerHTML = `<canvas></canvas><div class="vig"></div><div class="scanl"></div>
      <div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div>
      <div class="tl">ULTRALINK // ESCORT OPS<br><span id="bTime">--:--:--Z</span><br><span id="bCoord">LAT --.---- · LON ---.----</span></div>
      <div class="tr">BUILD 1.0 · TRIAL<br>SECURE CHANNEL<br><span id="bZoom">SCALE 1.00×</span></div>
      <div class="mid"><div class="ttl" id="bTitle">ULTRALINK LOADING</div><div class="subt" id="bSub"></div>
        <div class="bar" id="bBar"></div><div class="pct" id="bPct">0%</div></div>
      <div class="log" id="bLog"></div><div class="skip" id="bSkip">PRESS ANY KEY TO SKIP ▸</div>`;
    const cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
    const $ = id => root.querySelector('#' + id);
    const fx = global.UL.fx;
    let W = 0, Hh = 0;
    const resize = () => { const d = Math.min(2, devicePixelRatio || 1); W = cv.width = innerWidth * d; Hh = cv.height = innerHeight * d; };
    resize(); addEventListener('resize', resize);

    /* terrain build (~60ms) */
    const noise = makeNoise(Math.floor(Math.random() * 1e6) + 7), CELL = 12;
    const gw = 270, gh = 160, fw = 540, fh = 320;
    const hf = (x, y) => noise(x * 0.028, y * 0.028) + 0.25 * noise(x * 0.09 + 40, y * 0.09 + 40);
    const Hc = new Float32Array(gw * gh), Hf = new Float32Array(fw * fh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) Hc[j * gw + i] = hf(i, j);
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) Hf[j * fw + i] = hf(i / 2, j / 2);
    let lo = 9, hi = -9; Hc.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; });
    const nC = 26, nF = 60;
    const lvC = Array.from({ length: nC }, (_, i) => lo + (hi - lo) * (i + 1) / (nC + 1));
    const lvF = Array.from({ length: nF }, (_, i) => lo + (hi - lo) * (i + 1) / (nF + 1));
    const pathsC = contours(Hc, gw, gh, CELL, lvC);
    const pathsF = contours(Hf, fw, fh, CELL / 2, lvF);
    const WORLD = { w: gw * CELL, h: gh * CELL };

    /* blips: riders (diamond) & escorts (inverted triangle) appearing on the map */
    const blips = []; let nextBlip = 0.6, blipN = 0;

    let t0 = performance.now(), running = true, skipRequested = false, progress = 0, targetProg = 0, exiting = 0;
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00e5ff';
    function rgba(a) { const n = parseInt(acc.replace('#', ''), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

    function frame(now) {
      if (!running) return;
      const t = (now - t0) / 1000, d = W / innerWidth;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#020608'; ctx.fillRect(0, 0, W, Hh);

      /* camera: slow zoom in / out with drift + gentle rotation; dive on exit */
      const base = 1.25 + 0.7 * Math.sin(t * 0.42 - 1.4);
      const dive = exiting ? Math.pow(Math.min(1, (now - exiting) / 900), 2) * 3.5 : 0;
      const zoom = (base + dive) * d;
      const rot = Math.sin(t * 0.05) * 0.07;
      const cx = WORLD.w / 2 + Math.sin(t * 0.11) * 260, cy = WORLD.h / 2 + Math.cos(t * 0.09) * 150;
      ctx.translate(W / 2, Hh / 2); ctx.rotate(rot); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);
      const lw = px => px / zoom;

      /* terrain contours (coarse always, fine fades in when zoomed) */
      const fineA = Math.max(0, Math.min(1, (base - 1.15) / 0.7));
      ctx.lineJoin = 'round';
      pathsC.forEach((p, i) => {
        const major = i % 5 === 0;
        ctx.strokeStyle = rgba(major ? 0.42 : 0.17 * (1 - fineA * 0.4)); ctx.lineWidth = lw(major ? 1.5 : 0.8); ctx.stroke(p);
      });
      if (fineA > 0.02) pathsF.forEach((p, i) => { if (i % 2) return; ctx.strokeStyle = rgba(0.11 * fineA); ctx.lineWidth = lw(0.6); ctx.stroke(p); });

      /* tactical grid (world space) */
      const G = 240;
      ctx.lineWidth = lw(1);
      for (let x = 0; x <= WORLD.w; x += G / 2) { ctx.strokeStyle = rgba((x / (G / 2)) % 2 === 0 ? 0.28 : 0.09); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.h); ctx.stroke(); }
      for (let y = 0; y <= WORLD.h; y += G / 2) { ctx.strokeStyle = rgba((y / (G / 2)) % 2 === 0 ? 0.28 : 0.09); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.w, y); ctx.stroke(); }
      ctx.font = `${lw(11)}px monospace`; ctx.fillStyle = rgba(0.55);
      for (let x = 0; x <= WORLD.w; x += G) for (let y = 0; y <= WORLD.h; y += G) ctx.fillText(String(Math.round(x / G * 10)).padStart(2, '0') + String(Math.round(y / G * 10)).padStart(2, '0'), x + lw(4), y + lw(13));

      /* blips */
      if (t > nextBlip && blips.length < 9 && !exiting) {
        const rider = blipN % 3 !== 2;
        blips.push({ x: cx + (Math.random() - .5) * 900, y: cy + (Math.random() - .5) * 520, born: t, rider, id: (rider ? 'RDR-' : 'ESC-') + String(++blipN).padStart(2, '0'), vx: (Math.random() - .5) * 8, vy: (Math.random() - .5) * 8 });
        nextBlip = t + 0.9 + Math.random() * 0.8; fx.blip();
      }
      blips.forEach(b => {
        b.x += b.vx * 0.016; b.y += b.vy * 0.016;
        const age = t - b.born, a = Math.min(1, age * 1.5), pr = (age * 0.9) % 1;
        ctx.strokeStyle = rgba(0.6 * (1 - pr) * a); ctx.lineWidth = lw(1.2);
        ctx.beginPath(); ctx.arc(b.x, b.y, lw(8 + pr * 34), 0, 7); ctx.stroke();
        ctx.fillStyle = b.rider ? `rgba(124,255,90,${a})` : `rgba(255,176,0,${a})`;
        ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.lineWidth = lw(1);
        const s = lw(8); ctx.beginPath();
        if (b.rider) { ctx.moveTo(b.x, b.y - s); ctx.lineTo(b.x + s * .8, b.y); ctx.lineTo(b.x, b.y + s); ctx.lineTo(b.x - s * .8, b.y); }
        else { ctx.moveTo(b.x - s, b.y - s * .8); ctx.lineTo(b.x + s, b.y - s * .8); ctx.lineTo(b.x, b.y + s); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = `rgba(210,250,255,${a * .9})`; ctx.font = `${lw(10)}px monospace`; ctx.fillText(b.id, b.x + lw(12), b.y + lw(3));
      });

      /* screen space overlays */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cxs = W / 2, cys = Hh / 2, R = Math.min(W, Hh) * 0.36;
      ctx.strokeStyle = rgba(0.22); ctx.lineWidth = d;
      [R, R * 0.66, R * 0.33].forEach(r => { ctx.beginPath(); ctx.arc(cxs, cys, r, 0, 7); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(cxs - R * 1.15, cys); ctx.lineTo(cxs + R * 1.15, cys); ctx.moveTo(cxs, cys - R * 1.15); ctx.lineTo(cxs, cys + R * 1.15); ctx.stroke();
      const ang = t * 1.5;
      try {
        const cg = ctx.createConicGradient(ang - 1.1, cxs, cys);
        cg.addColorStop(0, rgba(0)); cg.addColorStop(0.17, rgba(0.25)); cg.addColorStop(0.175, rgba(0)); cg.addColorStop(1, rgba(0));
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cxs, cys, R, 0, 7); ctx.fill();
      } catch (e) {}
      ctx.strokeStyle = rgba(0.85); ctx.lineWidth = 1.6 * d; ctx.beginPath(); ctx.moveTo(cxs, cys); ctx.lineTo(cxs + Math.cos(ang) * R, cys + Math.sin(ang) * R); ctx.stroke();
      // edge ruler ticks + scrolling coordinates
      ctx.fillStyle = rgba(0.5); ctx.font = `${10 * d}px monospace`;
      for (let i = 0; i < 40; i++) {
        const x = ((i * 60 - t * 20 * zoom) % (W + 60) + W + 60) % (W + 60) - 30, big = i % 5 === 0;
        ctx.fillRect(x, 0, 1, (big ? 12 : 6) * d);
        if (big) ctx.fillText(String(Math.round(x / d)), x + 3, 24 * d);
      }

      /* HUD text */
      const el = $('bTime'); if (el) el.textContent = new Date().toISOString().slice(11, 19) + 'Z';
      $('bZoom').textContent = 'SCALE ' + (base + dive).toFixed(2) + '×';
      const gp = global.UL.bootState && global.UL.bootState.gps;
      $('bCoord').textContent = gp ? `LAT ${gp.lat.toFixed(4)} · LON ${gp.lon.toFixed(4)}` : `LAT ${(-20.3 + Math.sin(t) * .004).toFixed(4)} · LON ${(57.55 + Math.cos(t) * .004).toFixed(4)}`;

      progress += (targetProg - progress) * 0.06;
      const segs = $('bBar').children, n = segs.length;
      for (let i = 0; i < n; i++) segs[i].classList.toggle('on', (i + 0.5) / n <= progress);
      $('bPct').textContent = Math.round(progress * 100) + '%';
      requestAnimationFrame(frame);
    }
    const bar = $('bBar'); for (let i = 0; i < 40; i++) bar.appendChild(document.createElement('b'));
    fx.bootHum();
    requestAnimationFrame(frame);

    /* title scramble */
    const TITLE = 'ULTRALINK LOADING', chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%/\\';
    let ti = 0; const tt = setInterval(() => {
      ti++; const fixed = Math.floor(ti / 2.2);
      $('bTitle').innerHTML = TITLE.split('').map((c, i) => c === ' ' ? ' ' : i < fixed ? (i < 9 ? c : `<span>${c}</span>`) : chars[Math.random() * chars.length | 0]).join('');
      if (fixed >= TITLE.length) { clearInterval(tt); $('bTitle').innerHTML = 'ULTRALINK <span>LOADING</span>'; }
    }, 50);

    /* typewriter subtitle */
    let typeTimer = null;
    function subtitle(text) {
      clearInterval(typeTimer); let i = 0;
      typeTimer = setInterval(() => { i++; $('bSub').innerHTML = text.slice(0, i) + '<i>▌</i>'; if (i % 3 === 0) fx.blip(); if (i >= text.length) clearInterval(typeTimer); }, 26);
    }
    function logLine(text, cls) {
      const d = document.createElement('div'); d.className = cls || ''; d.textContent = text; $('bLog').appendChild(d);
      while ($('bLog').children.length > 9) $('bLog').firstChild.remove();
    }

    setTimeout(() => $('bSkip').classList.add('show'), 2200);
    let skipResolve = null;
    const skipHandler = e => { if (performance.now() - t0 < 1800) return; skipRequested = true; skipResolve && skipResolve(); };
    addEventListener('keydown', skipHandler); addEventListener('pointerdown', skipHandler);

    const tasks = opts.tasks || [], results = {};
    return (async () => {
      global.UL.bootState = global.UL.bootState || {};
      for (let i = 0; i < tasks.length; i++) {
        const tk = tasks[i];
        subtitle(tk.subtitle);
        logLine('▸ ' + tk.label + ' …');
        const started = performance.now();
        let res;
        const work = Promise.resolve().then(() => tk.run(global.UL.bootState)).catch(e => ({ ok: false, text: 'FAILED' }));
        const skipP = new Promise(r => { skipResolve = r; });
        res = await Promise.race([work, skipP.then(() => null)]);
        if (res === null) { work.then(r => { results[tk.id] = r; }); logLine('  ' + tk.label + ': BACKGROUND', 'wn'); break; }
        const minMs = skipRequested ? 0 : (tk.min || 900);
        const wait = Math.max(0, minMs - (performance.now() - started));
        if (wait) await Promise.race([new Promise(r => setTimeout(r, wait)), new Promise(r => { skipResolve = r; })]);
        results[tk.id] = res;
        const last = $('bLog').lastChild; if (last) { last.textContent = (res.ok ? '✓ ' : res.warn ? '! ' : '✕ ') + tk.label + ' — ' + res.text; last.className = res.ok ? 'ok' : res.warn ? 'wn' : 'er'; }
        fx.bootStep();
        targetProg = (i + 1) / tasks.length;
      }
      targetProg = 1;
      subtitle('Systems nominal — engaging escort console');
      fx.bootDone();
      await new Promise(r => setTimeout(r, skipRequested ? 250 : 900));
      removeEventListener('keydown', skipHandler); removeEventListener('pointerdown', skipHandler);
      exiting = performance.now(); root.classList.add('out');
      await new Promise(r => setTimeout(r, 850));
      running = false; clearInterval(tt); clearInterval(typeTimer);
      root.remove(); st.remove();
      return results;
    })();
  }

  global.UL = global.UL || {};
  global.UL.boot = { run };
})(window);
