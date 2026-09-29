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

  global.UL = global.UL || {};
  Object.assign(global.UL, { SECTOR_PALETTE: PALETTE, parseHMS, hmsStr: hms, normaliseSectors: normalise, addCut, removeCut, autoSplit, sectorAt, routeAt, SectorTimer });
})(window);
