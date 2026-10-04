/* ULTRALINK — appearance, keybindings and unit preferences */
(function (global) {
  'use strict';

  const DEFAULTS = {
    accent: '#00e5ff',
    warn: '#ffb000',
    bad: '#ff4d6d',
    good: '#7cff5a',
    theme: 'void',                 // void (DARK) | arctic (light grey)
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
    uiSounds: false,               // interface clicks / panel whooshes
    volume: 55,
    offRouteM: 60,
    overlayRoads: false,           // roads & infrastructure drawn over the map
    overlayPlaces: false,          // town / place names drawn over the map
    showCps: true,                 // checkpoint dots on the maps
    snapRoute: true,               // draw units on the route line when GPS puts them within 30 m of it                 // off-route alert threshold (metres from the route)
    gaugeMax: 70,                  // km/h at full scale on speed gauges
    graphWindow: 3,                // km shown when the elevation graph homes in on a unit
    windBand: true,
    keys: {
      pttAll: 'Space',
      follow: 'KeyF',
      settings: 'KeyS',
      clock: 'KeyT',
      layer: 'KeyL',
      master: 'KeyM',              // acknowledge the off-route master alert
      returnLead: 'KeyR',          // fly back to the lead rider
      refreshGps: 'KeyG',          // refresh the live GPS feed of every unit
      units: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']
    },
    colorOverrides: {}             // callsign -> hex
  };

  /* Two appearances only:
   *  DARK   ('void')   — the original ULTRALINK look
   *  ARCTIC ('arctic') — dark-grey text on light-grey slides / widgets            */
  const THEMES = {
    void:   { label: 'DARK',   bg: '#05080a', bg2: '#0a1014', line: '#14323b', line2: '#1d4d59', fg: '#c9f7ff', dim: '#5d8794' },
    arctic: { label: 'ARCTIC', bg: '#e9ebed', bg2: '#d9dde0', line: '#bfc5ca', line2: '#9aa2a9', fg: '#33393e', dim: '#646c73', accent: '#46525c', warn: '#b26b00', bad: '#c62f4b', good: '#2e8b3e' }
  };
  const LEGACY_THEME = { slate: 'void', olive: 'void', ember: 'void', dark: 'void' };

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
      if (!THEMES[this.v.theme]) this.v.theme = LEGACY_THEME[this.v.theme] || 'void';   // old themes (slate / olive / ember) fall back to DARK
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
      /* ARCTIC uses a dark-grey accent unless the user picked their own accent colour */
      const acc = (t.accent && v.accent === DEFAULTS.accent) ? t.accent : v.accent;
      const pick = k => (t[k] && v[k] === DEFAULTS[k]) ? t[k] : v[k];
      r.setProperty('--accent', acc); r.setProperty('--warn', pick('warn'));
      r.setProperty('--bad', pick('bad')); r.setProperty('--good', pick('good'));
      ['bg', 'bg2', 'line', 'line2', 'fg', 'dim'].forEach(k => r.setProperty('--' + k, t[k]));
      const rgb = hexToRgb(t.bg2);
      r.setProperty('--panel', `rgba(${rgb.r},${rgb.g},${rgb.b},${v.panelOpacity / 100})`);
      r.setProperty('--label-scale', v.labelScale / 100);
      r.setProperty('--marker-scale', v.markerScale / 100);
      document.body.style.fontSize = v.fontScale + '%';
      document.body.classList.toggle('scan', !!v.scanlines);
      document.body.classList.toggle('nocorners', !v.cornerAccents);
      document.body.classList.toggle('light', v.theme === 'arctic');
      document.documentElement.classList.toggle('light', v.theme === 'arctic');
      const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = t.bg;
      if (global.UL && global.UL.fx) { global.UL.fx.state.enabled = !!v.sound; global.UL.fx.state.ui = !!v.uiSounds; global.UL.fx.setVolume(v.volume / 100); }
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
  global.UL.themeOptions = cur => Object.keys(THEMES).map(k => `<option value="${k}" ${cur === k ? 'selected' : ''}>${THEMES[k].label}</option>`).join('');
  global.UL.KEY_LABEL = KEY_LABEL;
  global.UL.UI_DEFAULTS = DEFAULTS;
})(window);
