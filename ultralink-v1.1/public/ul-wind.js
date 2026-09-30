/* ULTRALINK — wind tracking + drafting advisor.
 * Wind model data: Open-Meteo (keyless). Sampled along the route and interpolated to each unit's position.
 * Manual override lets the escort enter locally observed wind when offline. */
(function (global) {
  'use strict';
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = d => DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const norm180 = a => ((a % 360) + 540) % 360 - 180;
  const norm360 = a => ((a % 360) + 360) % 360;

  class WindField extends EventTarget {
    constructor() {
      super();
      this.samples = [];          // [{lat,lon,speed,dir,gust}]
      this.manual = null;         // {speed, dir, gust}  (m/s at rider height, direction FROM)
      this.factor = 0.65;         // 10 m model wind -> ~rider height (~1.2 m) estimate
      this.status = 'idle';       // idle | ok | error
      this.last = 0; this.error = '';
    }
    /** sample the route (~every 8 km, max 12 points) in one request */
    async loadRoute(route, force) {
      if (!route || !route.points.length) return;
      if (!force && Date.now() - this.last < 600000 && this.samples.length) return;
      const P = route.points, n = Math.max(2, Math.min(12, Math.round(route.distance / 8000) + 1));
      const pts = Array.from({ length: n }, (_, i) => P[Math.min(P.length - 1, Math.round(i * (P.length - 1) / (n - 1)))]);
      return this.loadPoints(pts);
    }
    async loadPoints(pts) {
      const lat = pts.map(p => p.lat.toFixed(3)).join(','), lon = pts.map(p => p.lon.toFixed(3)).join(',');
      const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=auto';
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let j = await r.json(); if (!Array.isArray(j)) j = [j];
        this.samples = j.map((o, i) => ({ lat: pts[i].lat, lon: pts[i].lon, speed: o.current.wind_speed_10m, dir: o.current.wind_direction_10m, gust: o.current.wind_gusts_10m }));
        this.status = 'ok'; this.last = Date.now(); this.error = '';
      } catch (e) { this.status = 'error'; this.error = e.message; }
      this.dispatchEvent(new CustomEvent('update'));
    }
    setManual(speed, dir, gust) { this.manual = speed == null ? null : { speed, dir, gust: gust == null ? speed * 1.3 : gust }; this.dispatchEvent(new CustomEvent('update')); }
    get source() { return this.manual ? 'MANUAL' : this.status === 'ok' ? 'MODEL' : 'NONE'; }
    /** wind at a position: {speed (m/s @rider), speed10, gust, dir (FROM, deg), src} */
    at(lat, lon) {
      if (this.manual) return { speed: this.manual.speed, speed10: this.manual.speed / this.factor, gust: this.manual.gust, dir: this.manual.dir, src: 'MANUAL' };
      if (!this.samples.length || lat == null) return null;
      let su = 0, sv = 0, sg = 0, sw = 0;
      for (const s of this.samples) {
        const dy = (s.lat - lat) * 111, dx = (s.lon - lon) * 111 * Math.cos(rad(lat));
        const w = 1 / (dx * dx + dy * dy + 4);                       // 2 km softening
        const to = rad(s.dir + 180);
        su += w * s.speed * Math.sin(to); sv += w * s.speed * Math.cos(to); sg += w * s.gust; sw += w;
      }
      const u = su / sw, v = sv / sw, sp10 = Math.hypot(u, v);
      const dir = norm360(deg(Math.atan2(u, v)) + 180);
      return { speed: sp10 * this.factor, speed10: sp10, gust: (sg / sw) * this.factor, dir, src: 'MODEL' };
    }
  }

  /**
   * Drafting advice for a rider.
   * Research basis: drafting saves ~27-40% power at 30-50 cm behind on flat/fast roads (Blocken et al.), the sheltered
   * zone slides to the lee side as the apparent wind moves off-axis (~30-40 cm lee offset at 30 deg, almost alongside at 45 deg,
   * only beside at 90 deg), and gains shrink on slow climbs and in tailwinds.
   */
  function advise(o) {
    const { speed: v0, heading, wind, grade } = o;
    if (!wind || heading == null) return null;
    const v = Math.max(0, v0 || 0), h = heading;
    // vectors (N, E)
    const toW = rad(wind.dir + 180);
    const aN = wind.speed * Math.cos(toW) - v * Math.cos(rad(h));
    const aE = wind.speed * Math.sin(toW) - v * Math.sin(rad(h));
    const appSpeed = Math.hypot(aN, aE);
    const appFrom = norm360(deg(Math.atan2(aE, aN)) + 180);
    const beta = appSpeed < 0.3 ? 0 : norm180(appFrom - h);              // + = from the right
    const trueRel = norm180(wind.dir - h);
    const head = Math.cos(rad(trueRel)) * wind.speed, cross = Math.sin(rad(trueRel)) * wind.speed;
    const ab = Math.abs(beta), s = beta >= 0 ? 1 : -1;
    const wSide = s > 0 ? 'RIGHT' : 'LEFT', lee = s > 0 ? 'LEFT' : 'RIGHT';

    let zone, position, value, pos;   // pos: [dx, dy] px in the 160px diagram (y+ = behind)
    if (appSpeed < 1.0) { zone = 'CALM'; position = 'Wind is negligible — normal wheel-following, no lateral shelter needed.'; value = 'LOW'; pos = [0, 34]; }
    else if (ab < 30 && Math.abs(trueRel) > 100) { zone = 'TAILWIND'; position = 'Wind is behind him but he is faster than it, so he still feels a light apparent headwind: normal wheel-following works, gain is modest.'; value = 'MEDIUM'; pos = [-s * 6, 30]; }
    else if (ab < 10) { zone = 'HEADWIND'; position = 'Sit directly behind the wheel ahead, 30–50 cm off its rear wheel.'; value = 'HIGH'; pos = [0, 40]; }
    else if (ab < 30) { zone = 'HEAD-QUARTER'; position = `Behind the wheel ahead, nudged slightly to the ${lee} (lee) side.`; value = 'HIGH'; pos = [-s * 10, 38]; }
    else if (ab < 50) { zone = 'ECHELON'; position = `Echelon: take the ${lee} side of the rider ahead, roughly 30–40 cm off-line, half a wheel back.`; value = 'MEDIUM'; pos = [-s * 26, 28]; }
    else if (ab < 110) { zone = 'CROSSWIND'; position = `Full echelon: ride almost alongside on the ${lee} side of the rider ahead. Directly behind gives little shelter.`; value = 'MEDIUM'; pos = [-s * 36, 12]; }
    else if (ab < 150) { zone = 'TAIL-QUARTER'; position = `Shelter is weak: hold the ${lee} side, level with or just behind the rider ahead.`; value = 'LOW'; pos = [-s * 34, -2]; }
    else { zone = 'TAILWIND'; position = 'Wind is behind him: drafting gain is minimal. Stay compact, keep speed steady, save effort.'; value = 'LOW'; pos = [0, 14]; }

    const notes = [];
    if (zone !== 'CALM' && ab >= 10 && ab < 150) notes.push(`Avoid the ${wSide} (windward) side — fully exposed.`);
    if ((grade || 0) > 5 && v < 7) notes.push(`Climbing ${grade.toFixed(1)}%: low speed means small drafting gain (~7% at 6 m/s); pace by effort.`);
    if ((grade || 0) < -4 && v > 12 && wind.gust > 8) notes.push('Fast descent with gusty crosswind: stay low, hands on the hoods, keep clear of the group edge.');
    if (wind.gust >= 10) notes.push('Gusts above 36 km/h: expect sudden sideways pushes, hold a wider gap.');
    if (ab >= 45 && ab < 110) notes.push('In a rotating echelon the lead takes the windward end; rotate up the windward side and drop back along the lee.');
    notes.push('Sheltering behind vehicles is prohibited in most sanctioned races — use riders, and roadside walls/hedges on the lee side.');

    // aero power cost of wind vs still air (CdA .32, rho 1.2): + = extra watts, − = free watts
    const along = appSpeed * Math.cos(rad(beta));              // air speed along heading relative to rider
    const k = 0.5 * 1.2 * 0.32;
    const cost = k * (along * Math.abs(along)) * v - k * v * v * v;

    return {
      zone, position, value, notes, pos, beta, ab, side: s > 0 ? 'R' : 'L', lee, wSide,
      appSpeed, appFrom, trueSpeed: wind.speed, trueDir: wind.dir, trueLabel: compass(wind.dir), gust: wind.gust,
      trueRel, head, cross, costW: Math.round(cost), src: wind.src,
      relLabel: relPhrase(beta)
    };
  }
  function relPhrase(b) {
    const a = Math.abs(b), side = b >= 0 ? 'RIGHT' : 'LEFT';
    if (a < 10) return 'HEAD-ON';
    if (a < 80) return side + '-FRONT ' + Math.round(a) + '°';
    if (a < 100) return side + ' SIDE';
    if (a < 170) return side + '-REAR ' + Math.round(180 - a) + '°';
    return 'FROM BEHIND';
  }
  /** headwind component along a bearing (for route wind band): + = headwind */
  function headComponent(wind, bearingDeg) { return wind ? Math.cos(rad(norm180(wind.dir - bearingDeg))) * wind.speed : 0; }

  global.UL = global.UL || {};
  Object.assign(global.UL, { WindField, advise, compass, headComponent });
})(window);
