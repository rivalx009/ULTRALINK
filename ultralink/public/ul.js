/* ULTRALINK shared core — link, geo math, GPX, telemetry, WebRTC PTT net */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------- geo math */
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  function haversine(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /* ----------------------------------------------------------------- GPX  */
  function parseGPX(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    let nodes = [...xml.getElementsByTagName('trkpt')];
    if (!nodes.length) nodes = [...xml.getElementsByTagName('rtept')];
    const pts = nodes.map(n => ({
      lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'),
      ele: +(n.getElementsByTagName('ele')[0]?.textContent || 0)
    })).filter(p => isFinite(p.lat) && isFinite(p.lon));
    return buildRoute(pts, xml.getElementsByTagName('name')[0]?.textContent || '');
  }
  /** adds cumulative distance + smoothed gradient; downsamples to <=4000 pts */
  function buildRoute(pts, name) {
    if (pts.length > 4000) {
      const step = Math.ceil(pts.length / 4000);
      pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    }
    let d = 0;
    pts.forEach((p, i) => {
      if (i) d += haversine(pts[i - 1], p);
      p.d = d;
    });
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)];
      const run = b.d - a.d;
      p.grade = run > 5 ? ((b.ele - a.ele) / run) * 100 : 0;
    });
    let gain = 0;
    for (let i = 1; i < pts.length; i++) { const dz = pts[i].ele - pts[i - 1].ele; if (dz > 0) gain += dz; }
    return { name, points: pts, distance: d, gain };
  }
  /** nearest route point (windowed search around lastIdx for speed) */
  function snap(route, pos, lastIdx) {
    const P = route.points; if (!P || !P.length) return null;
    let from = 0, to = P.length - 1;
    if (lastIdx != null) { from = Math.max(0, lastIdx - 120); to = Math.min(P.length - 1, lastIdx + 400); }
    let best = from, bestD = Infinity;
    for (let i = from; i <= to; i++) {
      const dd = (P[i].lat - pos.lat) ** 2 + (P[i].lon - pos.lon) ** 2;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    const p = P[best];
    const off = haversine(p, pos);
    return { idx: best, point: p, covered: p.d, remaining: route.distance - p.d, offRoute: off, ele: p.ele, grade: p.grade };
  }

  /* ------------------------------------------------------------- filters  */
  class EMA {
    constructor(a) { this.a = a; this.v = null; }
    push(x) { if (!isFinite(x)) return this.v; this.v = this.v == null ? x : this.a * x + (1 - this.a) * this.v; return this.v; }
  }

  /* ---------------------------------------------------------------- link  */
  class Link extends EventTarget {
    constructor() {
      super();
      this.ws = null; this.url = null; this.queue = [];
      this.retry = 0; this.id = null; this.rtt = null;
    }
    connect(url) {
      this.url = url || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      const ws = this.ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.retry = 0;
        this.emit('open');
        this.queue.splice(0).forEach(m => this.send(m));
        clearInterval(this._hb);
        this._hb = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 5000);
      };
      ws.onclose = () => {
        clearInterval(this._hb);
        this.emit('close');
        const wait = Math.min(8000, 500 * 2 ** this.retry++);
        setTimeout(() => this.connect(this.url), wait);
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return this.emit('binary', e.data);
        const m = JSON.parse(e.data);
        if (m.t === 'pong') { this.rtt = Date.now() - m.ts; this.emit('rtt', this.rtt); return; }
        this.emit(m.t, m);
        this.emit('*', m);
      };
    }
    get ready() { return this.ws && this.ws.readyState === 1; }
    send(m) { this.ready ? this.ws.send(JSON.stringify(m)) : this.queue.push(m); }
    sendBinary(b) { if (this.ready) this.ws.send(b); }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    on(type, fn) { this.addEventListener(type, e => fn(e.detail)); return this; }
  }

  /* ------------------------------------------------ WebRTC PTT voice mesh */
  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }] };
  class VoiceNet {
    constructor(link) {
      this.link = link; this.peers = new Map(); this.stream = null; this.onlevel = null;
      link.on('signal', m => this.onSignal(m));
    }
    async mic() {
      if (this.stream) return this.stream;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this.stream.getAudioTracks().forEach(t => t.enabled = false);   // PTT closed by default
      return this.stream;
    }
    async pc(id, initiator) {
      let p = this.peers.get(id);
      if (p) return p;
      const rtc = new RTCPeerConnection(ICE);
      p = { rtc, audio: null };
      this.peers.set(id, p);
      const s = await this.mic();
      s.getTracks().forEach(t => rtc.addTrack(t, s));
      rtc.onicecandidate = e => e.candidate && this.link.send({ t: 'signal', to: id, data: { ice: e.candidate } });
      rtc.ontrack = e => {
        let a = document.getElementById('rx-' + id);
        if (!a) { a = document.createElement('audio'); a.id = 'rx-' + id; a.autoplay = true; document.body.appendChild(a); }
        a.srcObject = e.streams[0]; p.audio = a;
      };
      rtc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(rtc.connectionState)) { this.peers.delete(id); }
      };
      if (initiator) {
        const offer = await rtc.createOffer();
        await rtc.setLocalDescription(offer);
        this.link.send({ t: 'signal', to: id, data: { sdp: rtc.localDescription } });
      }
      return p;
    }
    async onSignal(m) {
      const p = await this.pc(m.from, false);
      const d = m.data;
      if (d.sdp) {
        await p.rtc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          const ans = await p.rtc.createAnswer();
          await p.rtc.setLocalDescription(ans);
          this.link.send({ t: 'signal', to: m.from, data: { sdp: p.rtc.localDescription } });
        }
      } else if (d.ice) {
        try { await p.rtc.addIceCandidate(d.ice); } catch (e) {}
      }
    }
    async connectTo(ids) { for (const id of ids) if (!this.peers.has(id)) await this.pc(id, true); }
    key(open) { if (this.stream) this.stream.getAudioTracks().forEach(t => t.enabled = open); }
    /** route my TX only to selected peers (mute tracks toward others) */
    async setTargets(ids) {
      for (const [id, p] of this.peers) {
        const send = p.rtc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (send && send.track) { /* track shared; gate via renegotiation-free param */ }
        p.tx = ids === 'all' || ids.includes(id);
      }
      this._targets = ids;
    }
    /** mute inbound from a unit (escort "monitor" selection) */
    setMonitor(id, on) { const p = this.peers.get(id); if (p && p.audio) p.audio.muted = !on; }
  }

  /* ---------------------------------------------------- telemetry engine  */
  class Telemetry extends EventTarget {
    constructor() {
      super();
      this.route = null; this.lastIdx = null;
      this.spd = new EMA(0.35); this.grd = new EMA(0.25);
      this.state = {
        lat: null, lon: null, speed: 0, avg: 0, max: 0, heading: 0, acc: null,
        covered: 0, remaining: 0, eta: null, ele: 0, grade: 0, hr: null,
        cad: null, power: null, source: 'GPS', moving: 0, ts: 0, offRoute: null, gain: 0
      };
      this._tripStart = null; this._movingMs = 0; this._tripDist = 0; this._last = null;
    }
    setRoute(r) { this.route = r; this.lastIdx = null; }
    onPosition(p) {
      const s = this.state, now = p.timestamp || Date.now();
      const cur = { lat: p.coords.latitude, lon: p.coords.longitude };
      s.lat = cur.lat; s.lon = cur.lon; s.acc = p.coords.accuracy;
      let v = p.coords.speed;
      if (v == null || !isFinite(v)) {
        if (this._last) {
          const dt = (now - this._last.ts) / 1000;
          if (dt > 0.3) v = haversine(this._last, cur) / dt;
        }
      }
      if (this._last) {
        const dt = (now - this._last.ts) / 1000;
        const dd = haversine(this._last, cur);
        if (dd > 1.5) { this._tripDist += dd; this._movingMs += dt * 1000; }
        if (p.coords.heading != null && isFinite(p.coords.heading)) s.heading = p.coords.heading;
        else if (dd > 3) s.heading = bearing(this._last, cur);
      }
      this._last = { ...cur, ts: now };
      if (!this._tripStart) this._tripStart = now;
      s.speed = Math.max(0, this.spd.push(v || 0) || 0);
      s.max = Math.max(s.max, s.speed);
      s.moving = this._movingMs / 1000;
      s.avg = s.moving > 5 ? this._tripDist / s.moving : 0;
      s.tripDist = this._tripDist;

      if (this.route && this.route.points.length) {
        const sn = snap(this.route, cur, this.lastIdx);
        if (sn) {
          this.lastIdx = sn.idx;
          s.covered = sn.covered; s.remaining = Math.max(0, sn.remaining);
          s.ele = sn.ele; s.offRoute = sn.offRoute;
          s.grade = this.grd.push(sn.grade) || 0;
          const ref = s.avg > 1 ? (0.4 * s.speed + 0.6 * s.avg) : s.speed;
          s.eta = ref > 0.8 ? now + (s.remaining / ref) * 1000 : null;
          s.etaSec = ref > 0.8 ? s.remaining / ref : null;
        }
      } else {
        s.covered = this._tripDist; s.remaining = 0; s.eta = null;
      }
      s.ts = now;
      this.dispatchEvent(new CustomEvent('update', { detail: s }));
    }
    setSensor(k, v) { this.state[k] = v; this.state.ts = Date.now(); }
  }

  /* ---------------------------------------------------- BLE sensor bridge */
  const BLE_SVC = {
    hr: { svc: 0x180D, chr: 0x2A37 },
    csc: { svc: 0x1816, chr: 0x2A5B },
    power: { svc: 0x1818, chr: 0x2A63 }
  };
  class BleSensors extends EventTarget {
    constructor() { super(); this.devices = []; }
    async pair() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth unavailable (use Chrome on Android/Windows)');
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SVC.hr.svc] }, { services: [BLE_SVC.csc.svc] }, { services: [BLE_SVC.power.svc] }],
        optionalServices: [BLE_SVC.hr.svc, BLE_SVC.csc.svc, BLE_SVC.power.svc, 0x180F]
      });
      const gatt = await dev.gatt.connect();
      this.devices.push(dev);
      dev.addEventListener('gattserverdisconnected', () => this.emit('status', { name: dev.name, state: 'lost' }));
      let bound = 0;
      for (const [kind, def] of Object.entries(BLE_SVC)) {
        try {
          const svc = await gatt.getPrimaryService(def.svc);
          const chr = await svc.getCharacteristic(def.chr);
          await chr.startNotifications();
          chr.addEventListener('characteristicvaluechanged', e => this.decode(kind, e.target.value));
          bound++;
        } catch (e) {}
      }
      this.emit('status', { name: dev.name || 'SENSOR', state: 'linked', bound });
      return dev.name;
    }
    decode(kind, dv) {
      if (kind === 'hr') {
        const flags = dv.getUint8(0);
        const hr = (flags & 1) ? dv.getUint16(1, true) : dv.getUint8(1);
        this.emit('data', { hr });
      } else if (kind === 'csc') {
        const f = dv.getUint8(0); let o = 1;
        if (f & 1) {
          const rev = dv.getUint32(o, true), t = dv.getUint16(o + 4, true); o += 6;
          if (this._w) {
            let dr = rev - this._w.rev, dt = (t - this._w.t + 65536) % 65536 / 1024;
            if (dr < 0) dr += 4294967296;
            if (dt > 0) this.emit('data', { wheelRpm: (dr / dt) * 60 });
          }
          this._w = { rev, t };
        }
        if (f & 2) {
          const rev = dv.getUint16(o, true), t = dv.getUint16(o + 2, true);
          if (this._c) {
            let dr = (rev - this._c.rev + 65536) % 65536, dt = (t - this._c.t + 65536) % 65536 / 1024;
            if (dt > 0) this.emit('data', { cad: Math.round((dr / dt) * 60) });
          }
          this._c = { rev, t };
        }
      } else if (kind === 'power') {
        this.emit('data', { power: dv.getInt16(2, true) });
      }
    }
    emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
    on(t, fn) { this.addEventListener(t, e => fn(e.detail)); return this; }
  }

  /* --------------------------------------------------------------- format */
  const fmt = {
    kmh: v => (v == null ? '--' : (v * 3.6).toFixed(1)),
    km: v => (v == null ? '--' : (v / 1000).toFixed(2)),
    m: v => (v == null ? '--' : Math.round(v)),
    pct: v => (v == null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(1)),
    hms: s => {
      if (s == null || !isFinite(s)) return '--:--';
      s = Math.max(0, Math.round(s));
      const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
      return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
    },
    clock: ts => { if (!ts) return '--:--'; const d = new Date(ts); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); },
    zulu: ts => new Date(ts || Date.now()).toISOString().slice(11, 19) + 'Z'
  };

  global.UL = { haversine, bearing, parseGPX, buildRoute, snap, Link, VoiceNet, Telemetry, BleSensors, EMA, fmt, COLORS: ['#00e5ff', '#ffb000', '#7cff5a', '#ff4d6d', '#b06bff', '#ff8a3d', '#4dffd5', '#ffe14d'] };
})(window);
