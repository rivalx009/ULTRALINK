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
  #boot .sk{margin-top:18px;font-size:8px;letter-spacing:.3em;color:var(--dim);opacity:.7}`;

  function run(opts) {
    const root = document.getElementById('boot'); if (!root) return Promise.resolve({});
    const st = global.UL.bootState = global.UL.bootState || {};
    const tasks = opts.tasks || [];
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    root.innerHTML = `<div class="bx"><div class="bl"><span class="wm" role="img" aria-label="ULTRALINK"></span></div><div class="bs">${opts.subtitle || 'SYSTEM CHECK · LOADING'}</div>
      <div class="pb"><i></i></div><ul>${tasks.map(t => `<li class="run" data-t="${t.id}"><b>${t.label}</b><span>…</span></li>`).join('')}</ul>
      <div class="sk">TAP OR PRESS ANY KEY TO SKIP</div></div>`;
    const bar = root.querySelector('.pb i'); let done = 0;
    return new Promise(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        removeEventListener('keydown', finish); root.removeEventListener('pointerdown', finish);
        bar.style.width = '100%';
        setTimeout(() => { root.classList.add('out'); setTimeout(() => { root.remove(); s.remove(); }, 460); resolve(st); }, 250);
        try { sessionStorage.ulBooted = '1'; } catch (e) {}
      };
      addEventListener('keydown', finish); root.addEventListener('pointerdown', finish);
      const t0 = Date.now();
      Promise.all(tasks.map(t => Promise.resolve().then(() => t.run(st)).catch(() => ({ warn: true, text: 'FAILED' })).then(r => {
        r = r || {}; const li = root.querySelector(`[data-t="${t.id}"]`);
        if (li) { li.className = r.ok ? 'ok' : 'warn'; li.querySelector('span').textContent = r.text || (r.ok ? 'OK' : '—'); }
        done++; bar.style.width = (done / tasks.length * 100) + '%';
      }))).then(() => setTimeout(finish, Math.max(300, 1400 - (Date.now() - t0))));
    });
  }
  function tasks() { return [
    { id: 'core', label: 'TACTICAL CORE', subtitle: 'Initialising tactical core', min: 300,
      run: async () => { try { localStorage.ulBoot = Date.now(); } catch (e) {} return { ok: true, text: 'ONLINE' }; } },
    { id: 'gps', label: 'SATELLITE LINK', subtitle: 'Connecting to satellites', min: 400,
      run: st => new Promise(res => {
        if (!navigator.geolocation) return res({ warn: true, text: 'NO GEOLOCATION' });
        const t = setTimeout(() => res({ warn: true, text: 'NO FIX — CONTINUING' }), 5000);
        navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); st.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; res({ ok: true, text: 'GPS LOCK ±' + Math.round(p.coords.accuracy) + ' M' }); },
          () => { clearTimeout(t); res({ warn: true, text: 'GPS DENIED / NO FIX' }); }, { enableHighAccuracy: false, timeout: 4800, maximumAge: 300000 });
      }) },
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
    { id: 'prof', label: 'MISSION PROFILES', subtitle: 'Loading mission profiles', min: 200,
      run: async () => { let n = 0; try { n = JSON.parse(localStorage.ulProfiles || '[]').length; } catch (e) {} return { ok: true, text: n + ' PROFILE' + (n === 1 ? '' : 'S') + ' LOADED' }; } }
  ];}
  const seen = () => { try { return sessionStorage.ulBooted === '1'; } catch (e) { return false; } };
  global.UL = global.UL || {};
  global.UL.boot = { run, tasks, seen };
})(window);
