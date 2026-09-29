/* ULTRALINK — appearance, keybindings and unit preferences */
(function (global) {
  'use strict';

  const DEFAULTS = {
    accent: '#00e5ff',
    warn: '#ffb000',
    bad: '#ff4d6d',
    good: '#7cff5a',
    theme: 'void',                 // void | slate | olive | arctic | ember
    panelOpacity: 82,
    scanlines: true,
    cornerAccents: true,
    fontScale: 100,
    labelScale: 100,
    markerScale: 100,
    trailLength: 600,
    gridOverlay: true,
    mapLayer: 'SAT',
    units: 'metric',               // metric | imperial
    clock: 'local',                // local | zulu
    zoomFollow: 17,
    sound: true,
    volume: 70,
    gaugeMax: 70,                  // km/h at full scale on speed gauges
    graphWindow: 3,                // km shown when the elevation graph homes in on a unit
    windBand: true,
    keys: {
      pttAll: 'Space',
      follow: 'KeyF',
      settings: 'KeyS',
      clock: 'KeyT',
      layer: 'KeyL',
      units: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']
    },
    colorOverrides: {}             // callsign -> hex
  };

  const THEMES = {
    void:   { bg: '#05080a', bg2: '#0a1014', line: '#14323b', line2: '#1d4d59', fg: '#c9f7ff', dim: '#5d8794' },
    slate:  { bg: '#0b0e12', bg2: '#12171d', line: '#243039', line2: '#35485a', fg: '#dde7f0', dim: '#7b8b9c' },
    olive:  { bg: '#080a06', bg2: '#101408', line: '#2a3315', line2: '#41501f', fg: '#e2f2c4', dim: '#8a9a6a' },
    arctic: { bg: '#f2f6f8', bg2: '#e4ebef', line: '#b9c7cf', line2: '#8fa4b0', fg: '#12242c', dim: '#5c7481' },
    ember:  { bg: '#0b0605', bg2: '#150b08', line: '#3a1c12', line2: '#59291a', fg: '#ffe6d4', dim: '#a87c68' }
  };

  const KEY_LABEL = c => c === 'Space' ? 'SPACE' : String(c || '').replace(/^Key|^Digit/, '').toUpperCase() || '—';

  class Settings {
    constructor() { this.load(); }
    load() {
      let saved = {};
      try { saved = JSON.parse(localStorage.ulUi || '{}'); } catch (e) {}
      this.v = Object.assign({}, DEFAULTS, saved);
      this.v.keys = Object.assign({}, DEFAULTS.keys, saved.keys || {});
      this.v.keys.units = (saved.keys && saved.keys.units) || DEFAULTS.keys.units.slice();
      this.v.colorOverrides = Object.assign({}, saved.colorOverrides || {});
      return this.v;
    }
    save() { localStorage.ulUi = JSON.stringify(this.v); this.apply(); this.onchange && this.onchange(this.v); }
    reset() { this.v = JSON.parse(JSON.stringify(DEFAULTS)); this.save(); }
    set(path, val) {
      const p = path.split('.');
      let o = this.v;
      while (p.length > 1) o = o[p.shift()];
      o[p[0]] = val;
      this.save();
    }
    apply() {
      const v = this.v, t = THEMES[v.theme] || THEMES.void, r = document.documentElement.style;
      r.setProperty('--accent', v.accent); r.setProperty('--warn', v.warn);
      r.setProperty('--bad', v.bad); r.setProperty('--good', v.good);
      Object.entries(t).forEach(([k, val]) => r.setProperty('--' + k, val));
      const rgb = hexToRgb(t.bg2);
      r.setProperty('--panel', `rgba(${rgb.r},${rgb.g},${rgb.b},${v.panelOpacity / 100})`);
      r.setProperty('--label-scale', v.labelScale / 100);
      r.setProperty('--marker-scale', v.markerScale / 100);
      document.body.style.fontSize = v.fontScale + '%';
      document.body.classList.toggle('scan', !!v.scanlines);
      document.body.classList.toggle('nocorners', !v.cornerAccents);
      document.body.classList.toggle('light', v.theme === 'arctic');
      if (global.UL && global.UL.fx) { global.UL.fx.state.enabled = !!v.sound; global.UL.fx.setVolume(v.volume / 100); }
    }
    /* unit conversion helpers honouring the units preference */
    speed(ms) { return this.v.units === 'imperial' ? (ms * 2.23694) : (ms * 3.6); }
    speedU() { return this.v.units === 'imperial' ? 'MPH' : 'KM/H'; }
    dist(m) { return this.v.units === 'imperial' ? (m / 1609.344) : (m / 1000); }
    distU() { return this.v.units === 'imperial' ? 'MI' : 'KM'; }
    elev(m) { return this.v.units === 'imperial' ? (m * 3.28084) : m; }
    elevU() { return this.v.units === 'imperial' ? 'FT' : 'M'; }
    time(ts) {
      if (!ts) return '--:--';
      const d = new Date(ts);
      return this.v.clock === 'zulu'
        ? d.toISOString().slice(11, 16) + 'Z'
        : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    colorFor(callsign, fallback) { return this.v.colorOverrides[callsign] || fallback; }
  }

  function hexToRgb(h) {
    const n = parseInt(String(h).replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  global.UL = global.UL || {};
  global.UL.Settings = Settings;
  global.UL.THEMES = THEMES;
  global.UL.KEY_LABEL = KEY_LABEL;
  global.UL.UI_DEFAULTS = DEFAULTS;
})(window);
