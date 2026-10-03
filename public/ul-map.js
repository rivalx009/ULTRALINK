/* ULTRALINK — shared map widgets: checkpoint dots and the sector card (elevation + gradient graph + notes) */
(function (global) {
  'use strict';
  const UL = global.UL;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cfg = () => UL.cfg || { dist: m => m / 1000, distU: () => 'KM', elev: m => m, elevU: () => 'M', speed: v => v * 3.6, speedU: () => 'KM/H' };

  /* ---------------------------------------------------------- styles */
  const css = document.createElement('style');
  css.textContent = `
  .cpdot{position:relative}
  .cpdot i{position:absolute;left:0;top:0;width:11px;height:11px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.8),0 0 8px rgba(0,0,0,.6);box-sizing:border-box}
  .cpdot.fin i{background:#fff!important;border-color:#ff4d6d}
  .cpdot span{position:absolute;left:15px;top:-2px;white-space:nowrap;font:600 9px/1.3 var(--mono);letter-spacing:.1em;color:#eafcff;background:rgba(3,10,13,.72);padding:0 4px;border-left:2px solid currentColor;pointer-events:none}
  .nolabels .cpdot span{display:none}
  body.nocps .cpdot{display:none!important}
  .cpdot.drag{cursor:grab}
  .cpghost i{position:absolute;left:0;top:0;width:13px;height:13px;border-radius:50%;border:2px dashed #fff;background:rgba(0,229,255,.35);box-sizing:border-box}
  .cpghost span{position:absolute;left:17px;top:-1px;white-space:nowrap;font:600 9px var(--mono);letter-spacing:.1em;color:var(--accent);background:rgba(3,10,13,.85);padding:1px 5px}
  .seccard{position:absolute;z-index:760;width:350px;max-height:calc(100% - 24px);display:flex;flex-direction:column;background:rgba(6,14,18,.95);border:1px solid var(--line2);backdrop-filter:blur(6px);box-shadow:0 10px 40px rgba(0,0,0,.5);opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s;pointer-events:none}
  .seccard.in{opacity:1;transform:none;pointer-events:auto}
  .seccard .sc-h{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line)}
  .seccard .sc-h i{width:12px;height:12px;display:block;flex:0 0 12px}
  .seccard .sc-h b{letter-spacing:.16em;font-size:12px}
  .seccard .sc-h input{flex:1;padding:4px 7px;font-size:11px;text-transform:uppercase;min-width:0}
  .seccard .sc-b{overflow:auto;padding:10px 12px}
  .seccard .sc-sub{font-size:9px;letter-spacing:.14em;color:var(--dim);margin-bottom:8px;line-height:1.6}
  .seccard .sc-g{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line)}
  .seccard .sc-g>div{background:#08181e;padding:5px 7px}
  .seccard .sc-g .k{font-size:7px;letter-spacing:.14em;color:var(--dim)}
  .seccard .sc-g .v{font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .seccard canvas{width:100%;height:176px;display:block;margin-top:10px;background:#050d11;border:1px solid var(--line);touch-action:none}
  .seccard .sc-lg{display:flex;gap:2px;margin-top:5px;font-size:7px;letter-spacing:.08em;color:var(--dim);align-items:center;flex-wrap:wrap}
  .seccard .sc-lg em{display:inline-block;width:14px;height:6px}
  .seccard .sc-n{font-size:9px;letter-spacing:.28em;color:var(--accent);margin:12px 0 6px}
  .seccard textarea{width:100%;min-height:84px;resize:vertical;font-size:11px;line-height:1.5;letter-spacing:.02em;text-transform:none}
  .seccard .sc-nt{font-size:11px;line-height:1.6;white-space:pre-wrap;background:#08181e;border-left:3px solid var(--accent);padding:8px 10px;min-height:20px}
  @media (max-width:760px){ .seccard{left:8px!important;right:8px!important;top:auto!important;bottom:8px!important;width:auto;max-height:62%} }`;
  document.head.appendChild(css);

  /* -------------------------------------------------- checkpoint dots */
  UL.cpIcon = (color, label, o) => {
    o = o || {};
    return L.divIcon({ className: 'cpdot' + (o.finish ? ' fin' : '') + (o.drag ? ' drag' : ''), iconSize: [11, 11], iconAnchor: [5.5, 5.5],
      html: `<i style="background:${color}"></i>${label ? `<span style="color:${o.finish ? '#ff4d6d' : color}">${esc(label)}</span>` : ''}` });
  };
  UL.ghostIcon = label => L.divIcon({ className: 'cpghost', iconSize: [13, 13], iconAnchor: [6.5, 6.5], html: `<i></i><span>${esc(label)}</span>` });

  /** pixel distance from a map container point to the route, with the projected route position */
  UL.routeHit = (map, route, latlng) => {
    const pr = UL.projectToRoute(route, latlng.lat, latlng.lng); if (!pr) return null;
    const a = map.latLngToContainerPoint(latlng), b = map.latLngToContainerPoint([pr.lat, pr.lon]);
    pr.px = Math.hypot(a.x - b.x, a.y - b.y); return pr;
  };
  UL.sectorBounds = (route, s) => L.latLngBounds(route.points.filter(p => p.d >= s.start && p.d <= s.end).map(p => [p.lat, p.lon]).concat([[UL.routeAt(route, s.start).lat, UL.routeAt(route, s.start).lon], [UL.routeAt(route, s.end).lat, UL.routeAt(route, s.end).lon]]));

  /* ------------------------------------------------------ sector card */
  /**
   * host: absolutely-positioned .seccard element.
   * o: { route, sectors, index, editable, onName(v), onNotes(v), onClose() }
   */
  UL.sectorCard = (host, o) => {
    const S = o.sectors, s = S[o.index], st = UL.sectorStats(o.route, s), c = cfg(), next = S[o.index + 1];
    const D = m => c.dist(m).toFixed(2) + ' ' + c.distU(), E = m => Math.round(c.elev(m)) + ' ' + c.elevU();
    const tgtSpeed = s.target ? c.speed(st.len / s.target).toFixed(1) + ' ' + c.speedU() : '--';
    host.innerHTML = `<div class="sc-h"><i style="background:${s.color}"></i>${o.editable ? `<input class="sc-name" value="${esc(s.name)}" title="Sector name">` : `<b style="color:${s.color}">${esc(s.name)}</b>`}<span class="sp"></span><span class="tag">SECTOR ${o.index + 1}/${S.length}</span><button class="ghost sc-x" style="padding:2px 8px">✕</button></div>
      <div class="sc-b">
        <div class="sc-sub">${esc(UL.cpLabel(s))} → ${next ? esc(UL.cpLabel(next)) : 'FINISH'} · ${c.dist(s.start).toFixed(2)}–${c.dist(s.end).toFixed(2)} ${c.distU()}</div>
        <div class="sc-g">
          <div><div class="k">LENGTH</div><div class="v">${D(st.len)}</div></div>
          <div><div class="k">ASCENT</div><div class="v" style="color:var(--warn)">+${E(st.gain)}</div></div>
          <div><div class="k">DESCENT</div><div class="v" style="color:#4dd6ff">−${E(st.loss)}</div></div>
          <div><div class="k">AVG GRADE</div><div class="v">${UL.fmt.pct(st.avg)}%</div></div>
          <div><div class="k">MAX GRADE</div><div class="v" style="color:${UL.gradeColor(st.gmax)}">${UL.fmt.pct(st.gmax)}%</div></div>
          <div><div class="k">MIN GRADE</div><div class="v" style="color:${UL.gradeColor(st.gmin)}">${UL.fmt.pct(st.gmin)}%</div></div>
          <div><div class="k">ELEVATION</div><div class="v" style="font-size:11px">${Math.round(c.elev(st.emin))}–${E(st.emax)}</div></div>
          <div><div class="k">TARGET TIME</div><div class="v">${s.target ? UL.hmsStr(s.target) : '--'}</div></div>
          <div><div class="k">TARGET AVG</div><div class="v" style="font-size:11px">${tgtSpeed}</div></div>
        </div>
        <canvas class="sc-cv"></canvas>
        <div class="sc-lg">GRADIENT ${[[-6, '≤−6'], [-3, '−2'], [0, '0'], [3, '2'], [5, '4'], [7, '6'], [9, '8'], [11, '10+']].map(([g, l]) => `<em style="background:${UL.gradeColor(g)}"></em>${l}`).join(' ')}%</div>
        <div class="sc-n">NOTES</div>
        ${o.editable ? `<textarea class="sc-notes" placeholder="Notes for this sector: road surface, dangerous bends, feed zone, where to pass, tactics…">${esc(s.notes || '')}</textarea>`
          : `<div class="sc-nt">${s.notes ? esc(s.notes) : '<span class="muted">No notes for this sector.</span>'}</div>`}
      </div>`;
    const cv = host.querySelector('.sc-cv');
    let hx = null;
    const draw = () => drawSector(cv, st, s, hx);
    const pos = e => { const r = cv.getBoundingClientRect(); hx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; draw(); };
    cv.onpointermove = pos; cv.onpointerdown = pos; cv.onpointerleave = () => { hx = null; draw(); };
    host.querySelector('.sc-x').onclick = () => o.onClose && o.onClose();
    const nm = host.querySelector('.sc-name'); if (nm) nm.oninput = () => o.onName && o.onName(nm.value.toUpperCase());
    const nt = host.querySelector('.sc-notes'); if (nt) nt.oninput = () => o.onNotes && o.onNotes(nt.value);
    host.classList.add('in');
    requestAnimationFrame(draw);
    return { redraw: draw };
  };

  function drawSector(cv, st, s, hx) {
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    const dpr = devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr;
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const c = cfg(), P = st.pts, L0 = s.start, span = Math.max(1, s.end - s.start);
    const barH = 44, top = 10, eh = h - barH - 26;                         // elevation area height
    let lo = st.emin, hi = st.emax; const pad = Math.max(4, (hi - lo) * 0.15); lo -= pad; hi += pad;
    const X = d => 30 + (d - L0) / span * (w - 36), Y = e => top + eh - (e - lo) / (hi - lo) * eh;
    x.font = '8px monospace'; x.fillStyle = '#5d8794'; x.strokeStyle = 'rgba(0,229,255,.07)';
    for (let i = 0; i <= 3; i++) { const e = lo + (hi - lo) * i / 3, py = Y(e); x.beginPath(); x.moveTo(30, py); x.lineTo(w, py); x.stroke(); x.fillText(Math.round(c.elev(e)), 2, py + 3); }
    /* elevation, filled by gradient */
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], g = b.d - a.d > 0 ? (b.ele - a.ele) / (b.d - a.d) * 100 : 0;
      x.beginPath(); x.moveTo(X(a.d), top + eh); x.lineTo(X(a.d), Y(a.ele)); x.lineTo(X(b.d), Y(b.ele)); x.lineTo(X(b.d), top + eh); x.closePath();
      x.fillStyle = UL.gradeColor((g + (b.grade || 0)) / 2) + 'aa'; x.fill();
    }
    x.beginPath(); P.forEach((p, i) => i ? x.lineTo(X(p.d), Y(p.ele)) : x.moveTo(X(p.d), Y(p.ele))); x.strokeStyle = '#eafcff'; x.lineWidth = 1.3; x.stroke();
    /* gradient bars (binned) */
    const by = h - 16 - barH / 2, bins = Math.max(8, Math.min(60, Math.round((w - 36) / 7))), bw = (w - 36) / bins;
    x.strokeStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.moveTo(30, by); x.lineTo(w, by); x.stroke();
    const gAt = d => { const r = UL.routeAt({ points: P, distance: s.end }, d); return r ? r.ele : 0; };
    let gmax = 4; const vals = [];
    for (let k = 0; k < bins; k++) { const d0 = L0 + span * k / bins, d1 = L0 + span * (k + 1) / bins, g = (gAt(d1) - gAt(d0)) / Math.max(1, d1 - d0) * 100; vals.push(g); gmax = Math.max(gmax, Math.abs(g)); }
    vals.forEach((g, k) => { const hh = Math.abs(g) / gmax * (barH / 2 - 2); x.fillStyle = UL.gradeColor(g); x.fillRect(30 + k * bw + 1, g >= 0 ? by - hh : by, Math.max(1, bw - 2), Math.max(1, hh)); });
    x.fillStyle = '#5d8794'; x.fillText('+' + gmax.toFixed(0) + '%', 2, by - barH / 2 + 8); x.fillText('−' + gmax.toFixed(0) + '%', 2, by + barH / 2 - 2);
    x.fillText(c.dist(s.start).toFixed(1), 30, h - 3); const endT = c.dist(s.end).toFixed(1) + ' ' + c.distU().toLowerCase(); x.fillText(endT, w - x.measureText(endT).width - 2, h - 3);
    /* hover readout */
    if (hx != null && hx >= 30) {
      const d = L0 + (hx - 30) / (w - 36) * span, r = UL.routeAt({ points: P, distance: s.end }, Math.min(s.end, Math.max(L0, d)));
      if (r) {
        x.strokeStyle = 'rgba(255,255,255,.6)'; x.beginPath(); x.moveTo(hx, top); x.lineTo(hx, h - 14); x.stroke();
        x.fillStyle = '#fff'; x.beginPath(); x.arc(hx, Y(r.ele), 3, 0, 7); x.fill();
        const t = `${c.dist(d).toFixed(2)} ${c.distU().toLowerCase()} · ${Math.round(c.elev(r.ele))} ${c.elevU().toLowerCase()} · ${UL.fmt.pct(r.grade)}%`;
        x.font = '600 9px monospace'; const tw = x.measureText(t).width + 8, tx = Math.min(Math.max(30, hx - tw / 2), w - tw);
        x.fillStyle = 'rgba(3,10,13,.9)'; x.fillRect(tx, 1, tw, 13); x.fillStyle = UL.gradeColor(r.grade); x.fillText(t, tx + 4, 11);
      }
    }
  }
})(window);
