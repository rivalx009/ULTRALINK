/* ULTRALINK — small UI helpers: toasts, confirm dialog, click sounds */
(function (global) {
  'use strict';
  let host = null;
  function toast(msg, kind, ms) {
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms || 3200);
    while (host.children.length > 5) host.firstChild.remove();
  }
  function confirmBox(title, text, o) {
    o = o || {};
    return new Promise(res => {
      const d = document.createElement('dialog');
      d.innerHTML = `<div style="padding:20px;min-width:min(380px,86vw)"><h3 style="${o.danger ? 'color:var(--bad)' : ''}">${title}</h3>
        <div class="muted" style="font-size:11px;line-height:1.7;margin:10px 0 16px">${text}</div>
        <div class="row" style="gap:8px"><button class="${o.danger ? 'danger' : 'primary'}" data-y style="flex:1">${o.yes || 'CONFIRM'}</button><button class="ghost" data-n style="flex:1">CANCEL</button></div></div>`;
      document.body.appendChild(d);
      const done = v => { d.close(); d.remove(); res(v); };
      d.querySelector('[data-y]').onclick = () => done(true);
      d.querySelector('[data-n]').onclick = () => done(false);
      d.addEventListener('cancel', () => done(false));
      d.showModal(); global.UL.fx && UL.fx.open();
    });
  }
  /* click feedback on any button; dialogs open/close whoosh */
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button, .pitem, .keycap, .ucard, [data-snd]');
    if (b && !b.dataset.nosnd && global.UL.fx) UL.fx.click();
  }, true);

  /* ---- minimise / maximise button for any widget --------------------------------
   * UL.widget(el, { key, head, before, onToggle })
   *   el    : the widget element (gets .wgt, and .wmin while collapsed)
   *   head  : header element or selector inside el — stays visible while collapsed (.whd)
   *   before: optional element/selector inside the header to place the button in front of
   * Everything inside el except the header is hidden while minimised (CSS: .wgt.wmin > :not(.whd)).
   * The state is remembered per key. Safe to call again after the widget re-renders its header. */
  const wState = k => { try { const v = localStorage['ulW:' + k]; return v == null ? null : v === '1'; } catch (e) { return null; } };
  function widget(el, o) {
    if (!el) return null;
    o = o || {};
    const q = x => typeof x === 'string' ? el.querySelector(x) : x;
    const head = q(o.head) || el.firstElementChild; if (!head) return null;
    el.classList.add('wgt'); head.classList.add('whd');
    const w = el.__w || (el.__w = {
      key: o.key, onToggle: o.onToggle,
      get min() { return el.classList.contains('wmin'); },
      set(min, quiet) {
        el.classList.toggle('wmin', !!min);
        el.querySelectorAll('.wmin-btn').forEach(b => { b.textContent = min ? '+' : '–'; b.title = min ? 'Maximise' : 'Minimise'; b.setAttribute('aria-expanded', min ? 'false' : 'true'); });
        try { localStorage['ulW:' + w.key] = min ? '1' : ''; } catch (e) {}
        if (!quiet && global.UL.fx) { try { min ? UL.fx.close() : UL.fx.open(); } catch (e) {} }
        w.onToggle && w.onToggle(!!min);
      },
      toggle() { w.set(!w.min); }
    });
    if (o.onToggle) w.onToggle = o.onToggle;
    let b = head.querySelector(':scope > .wmin-btn');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'wmin-btn'; b.dataset.nosnd = '1';
      const ref = q(o.before);
      ref && ref.parentNode === head ? head.insertBefore(b, ref) : head.appendChild(b);
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); w.toggle(); });
    }
    if (!w.init) { w.init = true; const st = wState(o.key); w.set(o.min != null ? o.min : st != null ? st : !!o.defMin, true); }
    else w.set(w.min, true);
    return w;
  }

  /* save a text file: native save dialog inside the desktop / Android apps, normal download in a browser */
  function saveFile(name, text, mime) {
    const app = global.UltraApp;
    try { if (app && app.saveFile) { app.saveFile(String(name), String(text), mime || 'application/octet-stream'); return; } } catch (e) {}
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/octet-stream' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  global.UL = global.UL || {};
  global.UL.saveFile = saveFile;
  global.UL.widget = widget;
  global.UL.toast = toast;
  global.UL.confirm = confirmBox;
})(window);
