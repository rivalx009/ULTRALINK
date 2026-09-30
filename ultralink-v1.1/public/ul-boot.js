/* ULTRALINK — simple loading screen (escort mode only).
 * Logo, one progress bar and a short system checklist (checks run in parallel). Tap / any key skips. */
(function (global) {
  'use strict';
  const css = `
  #boot{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,#08171d 0%,#020608 70%);transition:opacity .45s}
  #boot.out{opacity:0;pointer-events:none}
  #boot .bx{width:min(420px,86vw);text-align:center}
  #boot .bl{font-size:clamp(22px,4vw,30px);letter-spacing:.55em;padding-left:.55em;color:var(--fg);text-shadow:0 0 22px rgba(0,229,255,.35)}
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
    root.innerHTML = `<div class="bx"><div class="bl">ULTRALINK</div><div class="bs">ESCORT CONSOLE · LOADING</div>
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
  global.UL = global.UL || {};
  global.UL.boot = { run };
})(window);
