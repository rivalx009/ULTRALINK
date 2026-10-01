/* ULTRALINK — sector model, route helpers and checkpoint stopwatch */
(function (global) {
  'use strict';
  const PALETTE = ['#00e5ff', '#7cff5a', '#ffb000', '#ff4d6d', '#b06bff', '#ff8a3d', '#4dffd5', '#ffe14d', '#4d9dff', '#ff6bd6'];

  /** parse "1:23:45" | "23:45" | "90" (minutes) -> seconds, null if blank/invalid */
  function parseHMS(str) {
    str = String(str == null ? '' : str).trim();
    if (!str) return null;
    if (!str.includes(':')) { const m = parseFloat(str); return isFinite(m) && m > 0 ? Math.round(m * 60) : null; }
    const p = str.split(':').map(Number);
    if (p.some(x => !isFinite(x) || x < 0)) return null;
    const s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    return s > 0 ? Math.round(s) : null;
  }
  function hms(s) {
    if (s == null || !isFinite(s)) return '';
    s = Math.max(0, Math.round(s));
    const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
  }

  /** sectors: [{name,color,start(m),target(sec|null)}] ascending; end of i = start of i+1 or total */
  function normalise(sectors, total) {
    let s = (sectors || []).slice().sort((a, b) => a.start - b.start);
    if (!s.length) s = [{ name: 'SECTOR 1', color: PALETTE[0], start: 0, target: null }];
    s[0].start = 0;
    s.forEach((x, i) => { x.end = i + 1 < s.length ? s[i + 1].start : total; x.idx = i; });
    return s;
  }
  function addCut(sectors, at, total) {
    const s = normalise(sectors, total);
    if (at < 300 || at > total - 300) return s;               // too close to an end
    if (s.some(x => Math.abs(x.start - at) < 300)) return s;  // too close to an existing cut
    const host = s.find(x => at > x.start && at < x.end);
    if (!host) return s;
    const n = { name: 'SECTOR ' + (s.length + 1), color: PALETTE[s.length % PALETTE.length], start: at, target: null };
    // split host target proportionally
    if (host.target) { const frac = (at - host.start) / (host.end - host.start); n.target = Math.round(host.target * (1 - frac)); host.target = Math.round(host.target * frac); }
    s.push(n);
    s.sort((a, b) => a.start - b.start);
    s.forEach((x, i) => { if (/^SECTOR \d+$/.test(x.name)) x.name = 'SECTOR ' + (i + 1); });
    return normalise(s, total);
  }
  function removeCut(sectors, i, total) {
    const s = normalise(sectors, total);
    if (i <= 0 || i >= s.length) return s;
    const gone = s.splice(i, 1)[0];
    if (gone.target && s[i - 1].target != null) s[i - 1].target += gone.target;
    if (gone.notes) s[i - 1].notes = [s[i - 1].notes, gone.notes].filter(Boolean).join('\n');
    s.forEach((x, k) => { if (/^SECTOR \d+$/.test(x.name)) x.name = 'SECTOR ' + (k + 1); });
    return normalise(s, total);
  }
  function autoSplit(n, total) {
    n = Math.max(1, Math.min(12, n | 0));
    return normalise(Array.from({ length: n }, (_, i) => ({ name: 'SECTOR ' + (i + 1), color: PALETTE[i % PALETTE.length], start: Math.round(total * i / n), target: null })), total);
  }
  const sectorAt = (sectors, d) => { for (let i = sectors.length - 1; i >= 0; i--) if (d >= sectors[i].start) return sectors[i]; return sectors[0]; };

  /* ---- route interpolation ---- */
  function routeAt(route, d) {
    const P = route.points; if (!P.length) return null;
    if (d <= 0) return Object.assign({ i: 0 }, P[0]);
    if (d >= route.distance) return Object.assign({ i: P.length - 1 }, P[P.length - 1]);
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; P[m].d <= d ? lo = m : hi = m; }
    const a = P[lo], b = P[hi], f = (d - a.d) / Math.max(0.001, b.d - a.d);
    return { i: lo, d, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, ele: a.ele + (b.ele - a.ele) * f, grade: a.grade + (b.grade - a.grade) * f,
      bearing: UL.bearing(a, b) };
  }

  /** polyline of one sector that starts and ends exactly at its checkpoints (no gaps between sectors) */
  function sectorLine(route, s) {
    const a = routeAt(route, s.start), b = routeAt(route, s.end);
    return [[a.lat, a.lon]].concat(route.points.filter(p => p.d > s.start && p.d < s.end).map(p => [p.lat, p.lon]), [[b.lat, b.lon]]);
  }
  /** Per-unit checkpoint stopwatch. Feed (covered metres, timestamp ms). Emits via callbacks. */
  class SectorTimer {
    constructor(sectors, total, cb) {
      this.total = total; this.cb = cb || {}; this.set(sectors);
      this.units = new Map();
    }
    set(sectors) { this.sectors = normalise(sectors, this.total); }
    get(id) {
      let u = this.units.get(id);
      if (!u) { u = { last: null, max: 0, cur: -1, startTs: null, times: [], nowTs: null, done: false }; this.units.set(id, u); }
      return u;
    }
    feed(id, covered, ts) {
      if (covered == null || !isFinite(covered) || !ts) return;
      const u = this.get(id), S = this.sectors;
      u.nowTs = ts;
      if (u.last == null) {
        u.last = { d: covered, ts };
        // joined at/near the start line: treat as a start crossing
        if (covered < S[0].start + 250) this._enter(u, id, 0, ts);
        u.max = covered; return;
      }
      if (covered < u.max) return;                       // monotonic: ignore GPS back-jitter
      const p = u.last;
      for (let i = 0; i < S.length; i++) {
        const bound = S[i].start;
        if (i === 0 && u.cur < 0) continue;
        if (i > 0 && p.d < bound && covered >= bound) {
          const f = (bound - p.d) / Math.max(0.001, covered - p.d);
          const t = p.ts + (ts - p.ts) * f;
          if (u.cur >= 0 && u.cur === i - 1) this._finish(u, id, i - 1, t);
          this._enter(u, id, i, t);
        }
      }
      if (u.cur === S.length - 1 && !u.done && covered >= this.total - 15) this._finish(u, id, u.cur, ts, true);
      u.last = { d: covered, ts }; u.max = Math.max(u.max, covered);
    }
    _enter(u, id, i, t) {
      u.cur = i; u.startTs = t; u.done = false;
      this.cb.checkpoint && this.cb.checkpoint(id, i, this.sectors[i]);
    }
    _finish(u, id, i, t, isEnd) {
      const dur = Math.max(0, (t - u.startTs) / 1000);
      u.times[i] = dur;
      if (isEnd) { u.done = true; u.cur = -1; }
      this.cb.finish && this.cb.finish(id, i, dur, this.sectors[i], isEnd);
    }
    /** running stopwatch (sec) of the sector the unit is currently in */
    running(id) { const u = this.units.get(id); return u && u.cur >= 0 && u.startTs ? Math.max(0, (u.nowTs - u.startTs) / 1000) : null; }
    reset() { this.units.clear(); }
    remove(id) { this.units.delete(id); }
  }

  /** checkpoint designation shown on the map (the checkpoint sits at the start of its sector) */
  const cpLabel = s => (s && s.cp) ? s.cp : (s && s.idx === 0 ? 'START' : 'CP' + (s ? s.idx : ''));

  /** move checkpoint i (i>0) to distance d, keeping 300 m from neighbours; returns true if moved */
  function moveCut(sectors, i, d, total) {
    const s = normalise(sectors, total);
    if (i <= 0 || i >= s.length) return false;
    const lo = s[i - 1].start + 300, hi = (i + 1 < s.length ? s[i + 1].start : total) - 300;
    if (d < lo || d > hi) return false;
    s[i].start = Math.round(d); normalise(s, total); return true;
  }

  /** closest point on the route polyline to (lat,lon): {d along route, lat, lon, off metres} */
  function projectToRoute(route, lat, lon) {
    const P = route.points; if (!P || P.length < 2) return null;
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
    let best = null;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky, bx = (b.lon - lon) * kx, by = (b.lat - lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t, py = ay + dy * t, off = Math.hypot(px, py);
      if (!best || off < best.off) best = { off, d: a.d + (b.d - a.d) * t, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, i };
    }
    return best;
  }

  /** statistics of one sector for the sector card */
  function sectorStats(route, s) {
    const pts = route.points.filter(p => p.d >= s.start && p.d <= s.end);
    const a = routeAt(route, s.start), b = routeAt(route, s.end);
    if (!pts.length || pts[0].d > s.start) pts.unshift(Object.assign({}, a, { d: s.start }));
    if (pts[pts.length - 1].d < s.end) pts.push(Object.assign({}, b, { d: s.end }));
    let gain = 0, loss = 0, gmax = -99, gmin = 99, emin = Infinity, emax = -Infinity;
    pts.forEach((p, i) => {
      if (i) { const dz = p.ele - pts[i - 1].ele; if (dz > 0) gain += dz; else loss -= dz; }
      gmax = Math.max(gmax, p.grade || 0); gmin = Math.min(gmin, p.grade || 0); emin = Math.min(emin, p.ele); emax = Math.max(emax, p.ele);
    });
    const len = s.end - s.start;
    return { pts, len, gain, loss, avg: len > 0 ? (b.ele - a.ele) / len * 100 : 0, gmax, gmin, emin, emax, startEle: a.ele, endEle: b.ele };
  }

  /* ---- sector target times from an overall target ----
   * 'effort'  : constant-power physics model (85 kg rider+bike, CdA 0.32 m², Crr 0.004, descents capped at 65 km/h).
   *             The power is solved so the whole route takes exactly the overall target; climbs get more time.
   * 'distance': time proportional to sector length.                                                            */
  const PHYS = { m: 85, g: 9.81, crr: 0.004, cda: 0.32, rho: 1.2, vmax: 65 / 3.6, vmin: 1.2 };
  function speedAt(P, grade) {
    const th = Math.atan(Math.max(-0.25, Math.min(0.25, grade / 100)));
    const F = PHYS.m * PHYS.g * (Math.sin(th) + PHYS.crr * Math.cos(th)), k = 0.5 * PHYS.rho * PHYS.cda;
    let lo = 0.2, hi = 40;
    for (let n = 0; n < 40; n++) { const v = (lo + hi) / 2; (k * v * v * v + F * v - P > 0) ? hi = v : lo = v; }
    return Math.max(PHYS.vmin, Math.min(PHYS.vmax, lo));
  }
  function autoTargets(route, sectors, overallSec, mode) {
    const S = normalise(sectors, route.distance);
    if (!overallSec || overallSec <= 0) return { sectors: S, watts: null };
    let raw, watts = null;
    if (mode === 'distance') raw = S.map(s => (s.end - s.start) / route.distance * overallSec);
    else {
      const P = route.points, segs = [];
      for (let i = 1; i < P.length; i++) { const dd = P[i].d - P[i - 1].d; if (dd > 0) segs.push({ mid: (P[i].d + P[i - 1].d) / 2, dd, grade: (P[i].grade + P[i - 1].grade) / 2 }); }
      const total = W => segs.reduce((a, s) => a + s.dd / speedAt(W, s.grade), 0);
      let lo = 5, hi = 3000;
      for (let n = 0; n < 50; n++) { const W = (lo + hi) / 2; total(W) > overallSec ? lo = W : hi = W; }
      watts = (lo + hi) / 2;
      raw = S.map(() => 0);
      segs.forEach(sg => { const k = S.findIndex(s => sg.mid >= s.start && sg.mid < s.end); raw[k < 0 ? S.length - 1 : k] += sg.dd / speedAt(watts, sg.grade); });
    }
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    const t = raw.map(x => Math.max(1, Math.round(x / sum * overallSec)));
    const diff = overallSec - t.reduce((a, b) => a + b, 0);
    t[t.indexOf(Math.max(...t))] += diff;                       // make the sum exact
    S.forEach((s, i) => s.target = t[i]);
    return { sectors: S, watts: watts && watts < 2990 ? Math.round(watts) : null };
  }

  /** gradient colour scale (percent) */
  function gradeColor(g) {
    if (g <= -6) return '#3fa9ff'; if (g <= -2) return '#4dd6ff'; if (g < 2) return '#7cff5a';
    if (g < 4) return '#d6f53b'; if (g < 6) return '#ffd21f'; if (g < 8) return '#ffb000'; if (g < 10) return '#ff6a2b'; return '#ff2d55';
  }

  global.UL = global.UL || {};
  Object.assign(global.UL, { sectorLine, cpLabel, moveCut, projectToRoute, sectorStats, autoTargets, gradeColor, SECTOR_PALETTE: PALETTE, parseHMS, hmsStr: hms, normaliseSectors: normalise, addCut, removeCut, autoSplit, sectorAt, routeAt, SectorTimer });
})(window);
