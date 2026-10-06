/* ULTRALINK — loading screen. Shown first, on the start page, every time the link / app is opened
 * (once per session; escort mode shows it itself only when opened directly).
 * Logo, one progress bar and a short system checklist (checks run in parallel). Tap / any key skips. */
(function (global) {
  'use strict';
  const css = `
  #boot{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,#08171d 0%,#020608 70%);transition:opacity .45s}
  #boot.out{opacity:0;pointer-events:none}
  #boot .bx{width:min(420px,86vw);text-align:center}
  #boot .bl{font-size:clamp(22px,4vw,30px);color:var(--fg);line-height:1;filter:drop-shadow(0 0 10px rgba(0,229,255,.35))}
  body.light #boot .bl{filter:none}
  #boot .bs{font-size:9px;letter-spacing:.4em;color:var(--dim);margin-top:10px}
  #boot .pb{height:2px;background:rgba(0,229,255,.12);margin:26px 0 18px;overflow:hidden}
  #boot .pb i{display:block;height:100%;width:0;background:var(--accent);box-shadow:0 0 10px var(--accent);transition:width .35s ease}
  #boot ul{list-style:none;margin:0;padding:0;text-align:left;font-size:10px;letter-spacing:.16em}
  #boot li{display:flex;gap:10px;padding:4px 0;color:var(--dim);border-bottom:1px solid rgba(29,77,89,.35)}
  #boot li b{font-weight:400;flex:1}
  #boot li span{font-size:9px}
  #boot li.ok span{color:var(--good)} #boot li.warn span{color:var(--warn)} #boot li.run span{color:var(--accent)}
  #boot .sk{margin-top:18px;font-size:8px;letter-spacing:.3em;color:var(--dim);opacity:.7}
  #boot .gate{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,8,.72);padding:20px;animation:gateIn .25s ease}
  @keyframes gateIn{from{opacity:0}to{opacity:1}}
  #boot .gate .gb{width:min(380px,92vw);background:var(--bg2,#071216);border:1px solid var(--bad,#ff3b3b);box-shadow:0 0 24px rgba(255,59,59,.25);padding:22px 20px;text-align:center}
  #boot .gate .gi{width:44px;height:44px;margin:0 auto 12px;border:2px solid var(--bad,#ff3b3b);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--bad,#ff3b3b);font-weight:700}
  #boot .gate h3{margin:0 0 10px;font-size:15px;letter-spacing:.3em;color:var(--bad,#ff3b3b);font-weight:600}
  #boot .gate p{margin:0 0 8px;font-size:11px;line-height:1.6;letter-spacing:.04em;color:var(--fg)}
  #boot .gate .gs{font-size:9px;letter-spacing:.2em;color:var(--dim);margin:12px 0 14px}
  #boot .gate button{width:100%;padding:12px;font-size:12px;letter-spacing:.2em}
  body.light #boot .gate{background:rgba(233,235,237,.8)!important}
  body.light #boot .gate .gb{background:#f4f5f6!important;box-shadow:0 6px 24px rgba(0,0,0,.15)!important}`;

  function run(opts) {
    const root = document.getElementById('boot'); if (!root) return Promise.resolve({});
    const st = global.UL.bootState = global.UL.bootState || {};
    const tasks = opts.tasks || [];
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    root.innerHTML = `<div class="bx"><div class="bl"><span class="wm" role="img" aria-label="ULTRALINK"></span></div><div class="bs">${opts.subtitle || 'SYSTEM CHECK · LOADING'}</div>
      <div class="pb"><i></i></div><ul>${tasks.map(t => `<li class="run" data-t="${t.id}"><b>${t.label}</b><span>…</span></li>`).join('')}</ul>
      <div class="sk">TAP OR PRESS ANY KEY TO SKIP · LOCATION REQUIRED</div></div>`;
    const bar = root.querySelector('.pb i'); let done = 0;
    return new Promise(resolve => {
      let finished = false, tasksDone = false, skip = false, gate = null, poll = null;
      const gpsOk = () => !!st.gps;
      const finish = () => {
        if (finished) return;
        if (!tasksDone) { skip = true; return; }             // skip waits for the GPS check
        if (!gpsOk()) return showGate();                      // no location → stay on the loading screen
        finished = true; hideGate();
        removeEventListener('keydown', onSkip); root.removeEventListener('pointerdown', onSkip);
        bar.style.width = '100%';
        setTimeout(() => { root.classList.add('out'); setTimeout(() => { root.remove(); s.remove(); }, 460); resolve(st); }, 250);
        try { sessionStorage.ulBooted = '1'; } catch (e) {}
      };
      const onSkip = e => { if (gate && gate.contains(e.target)) return; finish(); };
      const gpsLi = () => root.querySelector('[data-t="gps"]');
      const setGpsLi = (cls, txt) => { const li = gpsLi(); if (li) { li.className = cls; li.querySelector('span').textContent = txt; } };
      /* ---- "LOCATION DISABLED" box: re-checks every 3 s and closes by itself once a fix arrives */
      function showGate() {
        if (gate) return;
        const why = st.gpsErr === 'denied' ? 'ULTRALINK is not allowed to use your location. Allow location for this app / site in your browser or phone settings.'
          : st.gpsErr === 'none' ? 'This device or browser has no location service.'
          : 'Turn on Location (GPS) on your device. ULTRALINK needs your position to track riders and escorts.';
        gate = document.createElement('div'); gate.className = 'gate'; gate.setAttribute('role', 'alertdialog');
        gate.innerHTML = `<div class="gb"><div class="gi">!</div><h3>LOCATION DISABLED</h3><p>${why}</p>
          <p style="color:var(--dim);font-size:10px">On a phone: swipe down from the top of the screen and tap <b>Location</b>. On Windows: Settings → Privacy &amp; security → Location.</p>
          <div class="gs" id="gateSt">WAITING FOR LOCATION…</div><button class="primary" type="button">RETRY</button></div>`;
        root.appendChild(gate);
        gate.querySelector('button').onclick = e => { e.stopPropagation(); check(true); };
        poll = setInterval(() => check(false), 3000);
      }
      function hideGate() { if (poll) clearInterval(poll); poll = null; if (gate) gate.remove(); gate = null; }
      let checking = false;
      function check(manual) {
        if (checking || finished) return; checking = true;
        const g = gate && gate.querySelector('#gateSt'); if (g && manual) g.textContent = 'CHECKING…';
        locate(st, 8000).then(r => {
          checking = false;
          if (r.ok) { setGpsLi('ok', r.text); if (g) g.textContent = 'LOCATION FOUND'; setTimeout(finish, 400); }
          else if (g) g.textContent = (manual ? 'STILL NO LOCATION — ' : '') + 'WAITING FOR LOCATION…';
        });
      }
      addEventListener('keydown', onSkip); root.addEventListener('pointerdown', onSkip);
      const t0 = Date.now();
      Promise.all(tasks.map(t => Promise.resolve().then(() => t.run(st)).catch(() => ({ warn: true, text: 'FAILED' })).then(r => {
        r = r || {}; const li = root.querySelector(`[data-t="${t.id}"]`);
        if (li) { li.className = r.ok ? 'ok' : 'warn'; li.querySelector('span').textContent = r.text || (r.ok ? 'OK' : '—'); }
        done++; bar.style.width = (done / tasks.length * 100) + '%';
      }))).then(() => { tasksDone = true; setTimeout(finish, skip ? 0 : Math.max(300, 1400 - (Date.now() - t0))); });
    });
  }
  /* one location attempt → {ok,text}; records st.gps / st.gpsErr ('off' | 'denied' | 'none' | 'timeout') */
  function locate(st, ms) {
    return new Promise(res => {
      if (!navigator.geolocation) { st.gpsErr = 'none'; return res({ warn: true, text: 'NO GEOLOCATION' }); }
      let done = false; const end = r => { if (!done) { done = true; clearTimeout(t); res(r); } };
      const t = setTimeout(() => { st.gpsErr = 'timeout'; end({ warn: true, text: 'LOCATION DISABLED' }); }, ms);
      try {
        navigator.geolocation.getCurrentPosition(p => {
          st.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; st.gpsErr = null;
          end({ ok: true, text: 'GPS LOCK ±' + Math.round(p.coords.accuracy) + ' M' });
        }, e => { st.gpsErr = e && e.code === 1 ? 'denied' : 'off'; end({ warn: true, text: e && e.code === 1 ? 'LOCATION BLOCKED' : 'LOCATION DISABLED' }); },
        { enableHighAccuracy: false, timeout: ms - 200, maximumAge: 30000 });
      } catch (e) { st.gpsErr = 'off'; end({ warn: true, text: 'LOCATION DISABLED' }); }
    });
  }
  function tasks() { return [
    { id: 'core', label: 'TACTICAL CORE', subtitle: 'Initialising tactical core', min: 300,
      run: async () => { try { localStorage.ulBoot = Date.now(); } catch (e) {} return { ok: true, text: 'ONLINE' }; } },
    { id: 'gps', label: 'SATELLITE LINK', subtitle: 'Connecting to satellites', min: 400,
      run: st => locate(st, 8000) },
    { id: 'relay', label: 'RELAY NETWORK', subtitle: 'Bringing up the relays', min: 300,
      run: async () => {
        const t0 = performance.now();
        try { const r = await fetch('health', { cache: 'no-store' }); if (!r.ok) throw 0; } catch (e) { return { warn: true, text: 'RELAY OFFLINE' }; }
        const ms = Math.round(performance.now() - t0);
        const ws = await new Promise(res => { try { const w = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host); const t = setTimeout(() => { try { w.close(); } catch (e) {} res(false); }, 3500); w.onopen = () => { clearTimeout(t); w.close(); res(true); }; w.onerror = () => { clearTimeout(t); res(false); }; } catch (e) { res(false); } });
        return ws ? { ok: true, text: 'LINK OPEN · ' + ms + ' MS' } : { warn: true, text: 'HTTP OK · SOCKET BLOCKED' };
      } },
    { id: 'radio', label: 'RADIO SUITE', subtitle: 'Calibrating radio channels', min: 300,
      run: async () => {
        try { global.UL.fx && global.UL.fx.unlock(); } catch (e) {}
        if (!navigator.mediaDevices) return { warn: true, text: 'NO AUDIO API' };
        const p = navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return { ok: true, text: 'MIC READY · PTT ARMED' }; }).catch(() => ({ warn: true, text: 'MIC DENIED — PTT TX OFF' }));
        return Promise.race([p, new Promise(r => setTimeout(() => r({ warn: true, text: 'MIC PERMISSION PENDING' }), 5000))]);
      } },
    { id: 'tiles', label: 'MAP LAYERS', subtitle: 'Downloading terrain and map layers', min: 300,
      run: st => new Promise(res => {
        const c = st.gps || { lat: -20.35, lon: 57.55 }, z = 12, n = 2 ** z;
        const x = Math.floor((c.lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(c.lat * Math.PI / 180) + 1 / Math.cos(c.lat * Math.PI / 180)) / Math.PI) / 2 * n);
        const img = new Image(), t = setTimeout(() => res({ warn: true, text: 'OFFLINE — CACHED ONLY' }), 3500);
        img.onload = () => { clearTimeout(t); res({ ok: true, text: 'SAT · VECTOR · TERRAIN' }); };
        img.onerror = () => { clearTimeout(t); res({ warn: true, text: 'TILE SERVER UNREACHABLE' }); };
        img.src = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
      }) },
    { id: 'prof', label: 'RACE & TRAINING PROFILES', subtitle: 'Loading profiles', min: 200,
      run: async () => { let a = []; try { a = JSON.parse(localStorage.ulProfiles || '[]'); } catch (e) {} const t = a.filter(p => p && p.kind === 'training').length; return { ok: true, text: (a.length - t) + ' RACE · ' + t + ' TRAINING' }; } }
  ];}
  const seen = () => { try { return sessionStorage.ulBooted === '1'; } catch (e) { return false; } };
  global.UL = global.UL || {};
  global.UL.boot = { run, tasks, seen };
})(window);
