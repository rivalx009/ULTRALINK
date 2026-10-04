/* ULTRALINK — LEAD RIDER POWER ENGINE + POWER WIDGET
 *
 * Estimates the live power output of a rider from two live variables:
 *   • the rider's actual ground speed (telemetry from the rider's phone / app)
 *   • the road gradient at the rider's position, read from the uploaded GPX route
 *     (least-squares slope of the GPX elevation over ±40 m around the rider)
 * plus the rider + bike weight and FTP typed into the widget.
 *
 *   P = v · ( m·g·sinθ  +  m·g·cosθ·Crr  +  ½·ρ·CdA·v_air·|v_air|  +  (m + m_wheels)·a ) / η
 *
 *   m      rider + bike mass (kg, from the widget)       θ    atan(gradient)
 *   Crr    rolling resistance 0.004 (good road tyres)    CdA  0.32 m² (hoods, same as the wind model)
 *   ρ      air density, reduced with GPX elevation       a    acceleration from the speed trend
 *   η      drivetrain efficiency 0.976                   v_air = v (+ headwind when "wind" is ticked)
 *
 * Power zones (Coggan, % of FTP): Z1 ≤55 · Z2 56–75 · Z3 76–90 · Z4 91–105 · Z5 106–120 · Z6 121–150 · Z7 >150
 */
(function (global) {
  'use strict';
  const UL = global.UL = global.UL || {};
  const G = 9.80665, CRR = 0.004, CDA = 0.32, ETA = 0.976, M_WHEELS = 1.0, RHO0 = 1.225;
  const ZONES = [
    { z: 1, name: 'ACTIVE RECOVERY', short: 'RECOVERY',  lo: 0,    hi: 0.55, color: '#8c959d' },
    { z: 2, name: 'ENDURANCE',       short: 'ENDURANCE', lo: 0.55, hi: 0.75, color: '#2f80ed' },
    { z: 3, name: 'TEMPO',           short: 'TEMPO',     lo: 0.75, hi: 0.90, color: '#27ae60' },
    { z: 4, name: 'THRESHOLD',       short: 'THRESHOLD', lo: 0.90, hi: 1.05, color: '#f2c94c' },
    { z: 5, name: 'VO2 MAX',         short: 'VO2 MAX',   lo: 1.05, hi: 1.20, color: '#f2994a' },
    { z: 6, name: 'ANAEROBIC',       short: 'ANAEROBIC', lo: 1.20, hi: 1.50, color: '#eb5757' },
    { z: 7, name: 'NEUROMUSCULAR',   short: 'SPRINT',    lo: 1.50, hi: 99,   color: '#9b51e0' }
  ];
  const zoneOf = (w, ftp) => { if (!ftp || w == null) return null; const f = w / ftp; return ZONES.find(z => f <= z.hi) || ZONES[6]; };

  /* ------------------------------------------------------------ GPX helpers */
  function eleAt(route, d) {
    const P = route.points; if (!P.length) return 0;
    if (d <= 0) return P[0].ele; if (d >= route.distance) return P[P.length - 1].ele;
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].d < d) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    return a.ele + (b.ele - a.ele) * t;
  }
  /** road gradient (%) from the GPX: least-squares slope of elevation over ±half metres around d */
  function gpxGrade(route, d, half) {
    if (!route || !route.points || route.points.length < 2) return 0;
    half = half || 40;
    let a = Math.max(0, d - half), b = Math.min(route.distance, d + half);
    if (b - a < 20) { a = Math.max(0, b - 20); b = Math.min(route.distance, a + 20); }
    const n = 9; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const x = a + (b - a) * i / (n - 1), y = eleAt(route, x); sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const den = n * sxx - sx * sx; if (!den) return 0;
    const g = (n * sxy - sx * sy) / den * 100;
    return Math.max(-25, Math.min(25, g));
  }

  /* --------------------------------------------------------- the engine */
  class PowerEngine {
    constructor() { this.route = null; this.reset(); }
    setRoute(r) { this.route = r; }
    reset() {
      this.last = null; this.hist = [];          // speed history for acceleration
      this.inst = null; this.p3 = null; this.out = null;
      this.sec = [];                              // 1-Hz power series (last 30 min) for the live graph + NP
      this.acc = 0; this.accW = 0;                // fractional-second resampler
      this.zoneSec = ZONES.map(() => 0);
      this.totSec = 0; this.sumW = 0; this.maxW = 0; this.kj = 0;
      this.np4 = 0; this.npN = 0; this.roll30 = [];
    }
    /**
     * s: rider telemetry {speed m/s, covered m, ts ms, ele m}
     * o: {mass kg, ftp W, headwind m/s|null}
     */
    push(s, o) {
      if (!s || s.speed == null) return this.out;
      const ts = s.ts || Date.now(), v = Math.max(0, +s.speed || 0);
      const dt = this.last ? (ts - this.last.ts) / 1000 : 0;
      if (this.last && dt <= 0.05) return this.out;                 // duplicate packet
      if (this.last && dt > 15) { this.hist = []; }                 // long gap: restart the acceleration estimate
      /* acceleration: least-squares slope of speed over the last ~4 s */
      this.hist.push({ t: ts / 1000, v }); while (this.hist.length > 2 && this.hist[this.hist.length - 1].t - this.hist[0].t > 4.5) this.hist.shift();
      let a = 0;
      if (this.hist.length >= 2) {
        const H = this.hist, n = H.length, t0 = H[0].t; let sx = 0, sy = 0, sxx = 0, sxy = 0;
        H.forEach(p => { const x = p.t - t0; sx += x; sy += p.v; sxx += x * x; sxy += x * p.v; });
        const den = n * sxx - sx * sx; a = den ? (n * sxy - sx * sy) / den : 0;
        a = Math.max(-2.5, Math.min(2.5, a));
      }
      const grade = this.route && s.covered != null ? gpxGrade(this.route, s.covered) : (+s.grade || 0);
      const th = Math.atan(grade / 100), m = Math.max(30, o.mass || 78);
      const ele = this.route && s.covered != null ? eleAt(this.route, s.covered) : (s.ele || 0);
      const rho = RHO0 * Math.exp(-Math.max(-400, ele) / 8434);
      const hw = o.headwind != null && isFinite(o.headwind) ? o.headwind : 0;
      const va = v + hw;
      const fG = m * G * Math.sin(th), fR = v > 0.3 ? m * G * Math.cos(th) * CRR : 0, fA = 0.5 * rho * CDA * va * Math.abs(va), fK = (m + M_WHEELS) * a;
      let p = v * (fG + fR + fA + fK) / ETA;
      if (v < 0.8) p = 0;                                           // stopped / walking pace
      p = Math.max(0, Math.min(2500, p));
      this.inst = p;
      /* 3-second time-weighted smoothing for the big number */
      this.p3 = this.p3 == null ? p : this.p3 + (p - this.p3) * Math.min(1, (dt || 1) / 3);
      /* statistics: only real, continuous samples (gaps > 10 s are skipped) */
      if (this.last && dt > 0 && dt <= 10) this.integrate(this.last.p, p, dt, o.ftp);
      this.last = { ts, v, p };
      this.out = { power: p, p3: this.p3, grade, accel: a, speed: v, headwind: hw, rho, mass: m,
        parts: { gravity: v * fG / ETA, rolling: v * fR / ETA, aero: v * fA / ETA, accel: v * fK / ETA } };
      return this.out;
    }
    integrate(p0, p1, dt, ftp) {
      const pm = (p0 + p1) / 2;
      this.totSec += dt; this.sumW += pm * dt; this.kj += pm * dt / 1000; this.maxW = Math.max(this.maxW, p1);
      const z = zoneOf(p1, ftp); if (z) this.zoneSec[z.z - 1] += dt;
      /* resample to 1 Hz */
      this.acc += dt; this.accW += pm * dt;
      while (this.acc >= 1) {
        const w = this.accW / this.acc; this.acc -= 1; this.accW = w * this.acc;
        this.sec.push(w); if (this.sec.length > 1800) this.sec.shift();
        this.roll30.push(w); if (this.roll30.length > 30) this.roll30.shift();
        if (this.roll30.length === 30) { const r = this.roll30.reduce((s, x) => s + x, 0) / 30; this.np4 += r ** 4; this.npN++; }
      }
    }
    avgLast(n) { const a = this.sec.slice(-n); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
    get avg() { return this.totSec > 0 ? this.sumW / this.totSec : null; }
    get np() { return this.npN ? Math.pow(this.np4 / this.npN, 0.25) : null; }
    recompute(ftp) { /* zones after an FTP change: rebuild from the 1-Hz series we still have */
      this.zoneSec = ZONES.map(() => 0); if (!ftp) return;
      this.sec.forEach(w => { const z = zoneOf(w, ftp); if (z) this.zoneSec[z.z - 1] += 1; });
    }
  }

  /* --------------------------------------------------------- the widget */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtT = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const KEY = cs => 'ulPwr:' + String(cs || '').toUpperCase();
  function loadCfg(cs) { let v = {}; try { v = JSON.parse(localStorage[KEY(cs)] || '{}'); } catch (e) {} return { ftp: v.ftp || null, rider: v.rider || 70, bike: v.bike || 8, wind: !!v.wind }; }
  function saveCfg(cs, v) { try { localStorage[KEY(cs)] = JSON.stringify(v); } catch (e) {} }

  class PowerPanel {
    /** el: container; o.wind(data) -> headwind m/s (or null) */
    constructor(el, o) {
      this.el = el; this.o = o || {}; this.route = null; this.engines = new Map(); this.lead = null; this.unit = null; this.lastDraw = 0;
      el.classList.add('pwr');
      el.innerHTML = `
        <div class="pw-h"><span class="pw-ico">⚡</span><b>LEAD POWER</b><span class="pw-who"></span><span class="sp"></span><span class="tag pw-live">--</span></div>
        <div class="pw-b">
          <div class="pw-none hint">Set a ★ lead rider to see the live power estimate.</div>
          <div class="pw-main">
            <div class="pw-big"><b class="pw-w">--</b><small>W · 3 S</small></div>
            <div class="pw-side">
              <div class="pw-zone"><i></i><span>ZONE --</span></div>
              <div class="pw-kv"><span>W/KG <b class="pw-wkg">--</b></span><span>%FTP <b class="pw-pct">--</b></span></div>
            </div>
          </div>
          <div class="pw-stats">
            <div><div class="k">10 S</div><div class="v pw-s10">--</div></div><div><div class="k">30 S</div><div class="v pw-s30">--</div></div>
            <div><div class="k">AVG</div><div class="v pw-avg">--</div></div><div><div class="k">NP</div><div class="v pw-np">--</div></div>
            <div><div class="k">MAX</div><div class="v pw-max">--</div></div><div><div class="k">KJ</div><div class="v pw-kj">--</div></div>
          </div>
          <div class="pw-cap"><span>LIVE POWER · LAST 5 MIN</span><span class="sp"></span><span class="pw-meter"></span></div>
          <canvas class="pw-live-cv"></canvas>
          <div class="pw-cap"><span>TIME IN ZONE</span><span class="sp"></span><span class="pw-tot"></span></div>
          <div class="pw-hist"></div>
          <div class="pw-in">
            <div class="pw-f"><label>FTP (W)</label><input class="pw-ftp" type="number" inputmode="numeric" min="50" max="600" step="1" placeholder="e.g. 280"></div>
            <div class="pw-f"><label>RIDER (KG)</label><input class="pw-rk" type="number" inputmode="decimal" min="30" max="150" step="0.1"></div>
            <div class="pw-f"><label>BIKE (KG)</label><input class="pw-bk" type="number" inputmode="decimal" min="4" max="30" step="0.1"></div>
            <button class="primary pw-save">SAVE</button>
          </div>
          <div class="pw-opts"><label class="pw-chk"><input type="checkbox" class="pw-wind"> INCLUDE WIND</label><span class="sp"></span><button class="ghost pw-reset">RESET STATS</button></div>
          <div class="pw-src hint"></div>
        </div>`;
      const q = c => el.querySelector(c); this.q = q;
      q('.pw-save').onclick = () => this.save();
      ['.pw-ftp', '.pw-rk', '.pw-bk'].forEach(c => q(c).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.save(); } }));
      q('.pw-wind').onchange = () => { if (!this.lead) return; const c = loadCfg(this.lead); c.wind = q('.pw-wind').checked; saveCfg(this.lead, c); this.draw(true); };
      q('.pw-reset').onclick = () => { const e = this.lead && this.engines.get(this.lead); if (e) { e.reset(); this.draw(true); UL.toast && UL.toast('POWER STATS RESET', 'ok'); } };
      this.renderHist();
      this.setLead(null);
    }
    engine(cs) { let e = this.engines.get(cs); if (!e) { e = new PowerEngine(); e.setRoute(this.route); this.engines.set(cs, e); } return e; }
    setRoute(r) { this.route = r; this.engines.forEach(e => e.setRoute(r)); }
    setLead(cs) {
      if (cs === this.lead && this.inited) return; this.inited = true;
      this.lead = cs || null;
      const q = this.q, c = loadCfg(this.lead);
      this.el.classList.toggle('nolead', !this.lead);
      q('.pw-who').textContent = this.lead ? '★ ' + this.lead : '';
      q('.pw-ftp').value = c.ftp || ''; q('.pw-rk').value = c.rider; q('.pw-bk').value = c.bike; q('.pw-wind').checked = c.wind;
      this.unit = null; this.draw(true);
    }
    save() {
      if (!this.lead) { UL.toast && UL.toast('SET A LEAD RIDER FIRST', 'warn'); return; }
      const q = this.q, ftp = Math.round(+q('.pw-ftp').value), rider = +q('.pw-rk').value, bike = +q('.pw-bk').value;
      if (!(ftp >= 50 && ftp <= 600)) { UL.toast && UL.toast('FTP MUST BE 50–600 W', 'warn'); q('.pw-ftp').focus(); return; }
      if (!(rider >= 30 && rider <= 150)) { UL.toast && UL.toast('RIDER WEIGHT MUST BE 30–150 KG', 'warn'); q('.pw-rk').focus(); return; }
      if (!(bike >= 4 && bike <= 30)) { UL.toast && UL.toast('BIKE WEIGHT MUST BE 4–30 KG', 'warn'); q('.pw-bk').focus(); return; }
      const c = loadCfg(this.lead), ftpChanged = c.ftp !== ftp;
      Object.assign(c, { ftp, rider, bike }); saveCfg(this.lead, c);
      if (ftpChanged) this.engine(this.lead).recompute(ftp);
      q('.pw-save').textContent = 'SAVED ✓'; setTimeout(() => { q('.pw-save').textContent = 'SAVE'; }, 1400);
      UL.fx && UL.fx.save && UL.fx.save();
      UL.toast && UL.toast(this.lead + ' · FTP ' + ftp + ' W · ' + (rider + bike).toFixed(1) + ' KG SAVED', 'ok');
      this.draw(true);
    }
    /** feed every rider's telemetry; the engine of each rider keeps running so switching the lead keeps the history */
    feed(u) {
      if (!u || u.role !== 'rider' || !u.data) return;
      const c = loadCfg(u.callsign), e = this.engine(u.callsign);
      const hw = c.wind && this.o.wind ? this.o.wind(u.data) : null;
      e.push(u.data, { mass: c.rider + c.bike, ftp: c.ftp, headwind: hw });
      if (u.callsign === this.lead) { this.unit = u; this.draw(); }
    }
    tick() { this.draw(); }
    renderHist() {
      this.q('.pw-hist').innerHTML = ZONES.map(z => `<div class="pw-zr" data-z="${z.z}"><i style="background:${z.color}"></i><span class="pw-zn">Z${z.z} ${z.name}</span><span class="pw-zb"><em style="background:${z.color}"></em></span><span class="pw-zt">0:00</span><span class="pw-zp">0%</span></div>`).join('');
    }
    draw(force) {
      const now = Date.now(); if (!force && now - this.lastDraw < 250) return; this.lastDraw = now;
      const q = this.q, cs = this.lead, e = cs ? this.engines.get(cs) : null, c = loadCfg(cs), out = e && e.out;
      const stale = !this.unit || now - (this.unit.ts || 0) > 12000;
      q('.pw-live').textContent = !cs ? '--' : stale ? 'NO SIGNAL' : 'LIVE'; q('.pw-live').className = 'tag pw-live ' + (!cs ? '' : stale ? 'bad' : 'ok');
      const mass = c.rider + c.bike, p3 = out && !stale ? out.p3 : null;
      q('.pw-w').textContent = p3 == null ? '--' : Math.round(p3);
      q('.pw-wkg').textContent = p3 == null ? '--' : (p3 / c.rider).toFixed(2);
      q('.pw-pct').textContent = p3 == null || !c.ftp ? '--' : Math.round(p3 / c.ftp * 100) + '%';
      const z = zoneOf(p3, c.ftp), zb = q('.pw-zone');
      zb.querySelector('i').style.background = z ? z.color : 'var(--line2)';
      zb.querySelector('span').textContent = !c.ftp ? 'ENTER FTP → ZONES' : z ? 'Z' + z.z + ' · ' + z.name : 'ZONE --';
      zb.style.borderColor = z ? z.color : 'var(--line2)';
      q('.pw-w').style.color = z ? z.color : '';
      const W = x => x == null ? '--' : Math.round(x);
      q('.pw-s10').textContent = W(e && e.avgLast(10)); q('.pw-s30').textContent = W(e && e.avgLast(30));
      q('.pw-avg').textContent = W(e && e.avg); q('.pw-np').textContent = W(e && e.np);
      q('.pw-max').textContent = e && e.maxW ? Math.round(e.maxW) : '--'; q('.pw-kj').textContent = e && e.kj ? Math.round(e.kj) : '--';
      const meter = this.unit && this.unit.data && this.unit.data.power;
      q('.pw-meter').textContent = meter != null && !stale ? 'POWER METER ' + Math.round(meter) + ' W' : '';
      /* zone histogram */
      const tot = e ? e.zoneSec.reduce((s, x) => s + x, 0) : 0, mx = e ? Math.max(1, ...e.zoneSec) : 1;
      q('.pw-tot').textContent = tot ? fmtT(tot) : '';
      q('.pw-hist').classList.toggle('off', !c.ftp);
      q('.pw-hist').querySelectorAll('.pw-zr').forEach((r, i) => {
        const s = e ? e.zoneSec[i] : 0;
        r.querySelector('em').style.width = (s / mx * 100).toFixed(1) + '%';
        r.querySelector('.pw-zt').textContent = fmtT(s);
        r.querySelector('.pw-zp').textContent = tot ? Math.round(s / tot * 100) + '%' : '0%';
        r.classList.toggle('cur', !!(z && z.z === i + 1));
      });
      /* model inputs */
      q('.pw-src').innerHTML = !cs ? '' : out ? `SPEED <b>${(out.speed * 3.6).toFixed(1)}</b> KM/H · GPX GRADE <b>${out.grade >= 0 ? '+' : ''}${out.grade.toFixed(1)}%</b> · ACCEL <b>${out.accel >= 0 ? '+' : ''}${out.accel.toFixed(2)}</b> M/S²${c.wind ? ` · HEADWIND <b>${(out.headwind * 3.6).toFixed(0)}</b> KM/H` : ''} · MASS <b>${mass.toFixed(1)}</b> KG<br>Estimate from speed + GPX gradient (CdA 0.32 m², Crr 0.004). Drafting lowers the real power.` : (this.route ? 'Waiting for telemetry from ' + esc(cs) + '…' : 'No GPX route loaded — gradient unavailable, the estimate assumes flat road.');
      this.drawLive(e, c);
    }
    drawLive(e, c) {
      const cv = this.q('.pw-live-cv'), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
      const dpr = global.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      const cssv = n => getComputedStyle(this.el).getPropertyValue(n).trim() || '#5d8794';
      const dim = cssv('--dim'), line = cssv('--line');
      const bars = 60, per = 5, data = e ? e.sec.slice(-bars * per) : [];
      const vals = []; for (let i = 0; i < bars; i++) { const sl = data.slice(Math.max(0, data.length - (bars - i) * per), data.length - (bars - i - 1) * per); vals.push(sl.length ? sl.reduce((s, v) => s + v, 0) / sl.length : null); }
      const top = Math.max(c.ftp ? c.ftp * 1.6 : 400, ...vals.filter(v => v != null).map(v => v * 1.1)), bw = w / bars, Y = v => h - 12 - v / top * (h - 16);
      /* zone bands */
      if (c.ftp) ZONES.forEach(z => { const a = Y(Math.min(top, z.hi * c.ftp)), b = Y(z.lo * c.ftp); if (b < 0) return; x.fillStyle = z.color + '14'; x.fillRect(0, Math.max(0, a), w, b - Math.max(0, a)); });
      x.strokeStyle = line; x.lineWidth = 1; x.beginPath(); x.moveTo(0, h - 12.5); x.lineTo(w, h - 12.5); x.stroke();
      vals.forEach((v, i) => { if (v == null) return; const zz = zoneOf(v, c.ftp); x.fillStyle = zz ? zz.color : dim; const y = Y(v); x.fillRect(i * bw + 0.5, y, Math.max(1, bw - 1.2), h - 12 - y); });
      x.font = '8px monospace'; x.fillStyle = dim;
      if (c.ftp) { const y = Y(c.ftp); x.setLineDash([4, 3]); x.strokeStyle = dim; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); x.setLineDash([]); x.fillText('FTP ' + c.ftp, 3, y - 3); }
      x.fillText('-5 MIN', 2, h - 2); x.fillText('NOW', w - 20, h - 2);
      if (!data.length) { x.fillStyle = dim; x.font = '9px monospace'; x.fillText('NO POWER DATA YET', w / 2 - 50, h / 2); }
    }
  }

  UL.ZONES = ZONES; UL.zoneOf = zoneOf; UL.gpxGrade = gpxGrade; UL.PowerEngine = PowerEngine; UL.PowerPanel = PowerPanel;
})(typeof window !== 'undefined' ? window : globalThis);
