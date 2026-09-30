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

  global.UL = global.UL || {};
  global.UL.toast = toast;
  global.UL.confirm = confirmBox;
})(window);
