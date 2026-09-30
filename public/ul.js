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

  /* ------------------------------------------------ PTT voice: WebRTC P2P + relay fallback
   * - One deterministic initiator per pair (lower id offers) -> no offer glare.
   * - ICE candidates queued until the remote description is set; signalling serialised per peer.
   * - Audio is gated per target with RTCRtpSender.replaceTrack (no renegotiation), so a unit-targeted
   *   transmission only reaches that unit.
   * - Any target that is not P2P-connected (4G/CGNAT, firewalls, relay-only mode) gets the audio
   *   through the relay as 12 kHz mu-law frames over the WebSocket.                                  */
  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }] };
  const RELAY_RATE = 12000;
  function muEnc(x) {
    let s = Math.max(-1, Math.min(1, x)) * 32635, sign = s < 0 ? 0x80 : 0; if (sign) s = -s;
    s += 132; let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; m >>= 1) exp--;
    return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
  }
  const MU = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const u = ~i & 0xff, sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f; let s = ((man << 3) + 132) << exp; s -= 132; MU[i] = (sign ? -s : s) / 32768; }

  class VoiceNet extends EventTarget {
    constructor(link, opts) {
      super();
      opts = opts || {};
      this.link = link; this.peers = new Map(); this.stream = null; this.track = null; this.micError = null;
      this.selfId = null; this.known = new Set(); this.mode = opts.mode || 'auto';
      this.keyed = false; this.targets = 'all'; this.relayTargets = null; this.muted = new Set();
      this.sid = Math.random().toString(36).slice(2, 10);
      this.ice = ICE; this.ctx = null; this.rx = new Map(); this.stats = { relayTx: 0, relayRx: 0 };
      this.blocked = new Set();
      link.on('signal', m => this.onSignal(m));
      link.on('binary', b => this.onRelayAudio(b));
      try { fetch('ice', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.iceServers && j.iceServers.length) this.ice = j; }).catch(() => {}); } catch (e) {}
      const unlock = () => { this.audioCtx(); this.blocked.forEach(a => a.play().then(() => { this.blocked.delete(a); if (!this.blocked.size) this.emit('unblocked'); }).catch(() => {})); };
      ['pointerdown', 'keydown', 'touchend'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
      this._gate = setInterval(() => this.keyed && this.applyGate(), 1000);
    }
    emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
    on(t, fn) { this.addEventListener(t, e => fn(e.detail)); return this; }
    audioCtx() {
      const AC = global.AudioContext || global.webkitAudioContext; if (!AC) return null;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    mic() {
      if (this.stream) return Promise.resolve(this.stream);
      if (!this._micP) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.micError = 'NO AUDIO API (needs HTTPS)'; return Promise.reject(new Error(this.micError)); }
        this._micP = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          .then(s => { this.stream = s; this.track = s.getAudioTracks()[0]; this.track.enabled = true; this.peers.forEach(p => this.gatePeer(p)); return s; })
          .catch(e => { this._micP = null; this.micError = e.message || 'MIC DENIED'; throw e; });
      }
      return this._micP;
    }
    /* ---- roster sync: create peers where I am the initiator, drop peers that left ---- */
    sync(ids) {
      this.known = new Set(ids.filter(id => id !== this.selfId));
      for (const [id, p] of this.peers) if (!this.known.has(id)) this.dropPeer(id);
      if (this.mode === 'relay' || !this.selfId || typeof RTCPeerConnection === 'undefined') return;
      this.known.forEach(id => { if (this.selfId < id && !this.peers.has(id)) this.offerTo(id); });
    }
    connectTo(ids) { this.sync(ids); }          // backwards-compatible name
    dropPeer(id) {
      const p = this.peers.get(id); if (!p) return;
      this.peers.delete(id); clearTimeout(p.retry);
      try { p.rtc.close(); } catch (e) {}
      if (p.audio) { p.audio.srcObject = null; p.audio.remove(); this.blocked.delete(p.audio); }
    }
    newPeer(id, remoteSid) {
      const rtc = new RTCPeerConnection(this.ice);
      const p = { id, rtc, audio: null, sender: null, sent: undefined, pending: [], chain: Promise.resolve(), remoteSid: remoteSid || null };
      this.peers.set(id, p);
      rtc.onicecandidate = e => e.candidate && this.link.send({ t: 'signal', to: id, data: { ice: e.candidate, sid: this.sid } });
      rtc.ontrack = e => {
        let a = p.audio;
        if (!a) { a = document.createElement('audio'); a.id = 'rx-' + id; a.autoplay = true; a.setAttribute('playsinline', ''); a.playsInline = true; document.body.appendChild(a); p.audio = a; }
        a.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
        a.muted = this.muted.has(id);
        const pl = a.play && a.play(); if (pl && pl.catch) pl.catch(() => { this.blocked.add(a); this.emit('blocked'); });
      };
      rtc.onconnectionstatechange = () => {
        const st = rtc.connectionState; this.emit('state', { id, state: st });
        if (st === 'connected' && this.keyed) this.applyGate();
        if (st === 'failed' || (st === 'disconnected' && this.selfId < id)) {
          clearTimeout(p.retry);
          p.retry = setTimeout(() => { if (this.peers.get(id) === p && ['failed', 'disconnected'].includes(rtc.connectionState)) { this.dropPeer(id); if (this.selfId < id && this.known.has(id)) this.offerTo(id); } }, st === 'failed' ? 1500 : 6000);
        }
      };
      return p;
    }
    offerTo(id) {
      const p = this.newPeer(id);
      const tr = p.rtc.addTransceiver('audio', { direction: 'sendrecv' });
      p.sender = tr.sender; this.gatePeer(p);
      p.chain = p.chain.then(async () => {
        await p.rtc.setLocalDescription(await p.rtc.createOffer());
        this.link.send({ t: 'signal', to: id, data: { sdp: p.rtc.localDescription, sid: this.sid } });
      }).catch(e => console.warn('voice offer', e));
    }
    onSignal(m) {
      if (this.mode === 'relay' || typeof RTCPeerConnection === 'undefined') return;
      const d = m.data || {}, from = m.from;
      let p = this.peers.get(from);
      if (p && d.sid && p.remoteSid && d.sid !== p.remoteSid && d.sdp && d.sdp.type === 'offer') { this.dropPeer(from); p = null; }  // peer restarted
      if (!p) { if (!(d.sdp && d.sdp.type === 'offer')) return; p = this.newPeer(from, d.sid); }
      if (d.sid && !p.remoteSid) p.remoteSid = d.sid;
      p.chain = p.chain.then(async () => {
        const rtc = p.rtc;
        if (d.sdp) {
          if (d.sdp.type === 'offer' && rtc.signalingState !== 'stable') { if (this.selfId < from) return; await rtc.setLocalDescription({ type: 'rollback' }); }
          if (d.sdp.type === 'answer' && rtc.signalingState !== 'have-local-offer') return;
          await rtc.setRemoteDescription(d.sdp);
          for (const c of p.pending.splice(0)) { try { await rtc.addIceCandidate(c); } catch (e) {} }
          if (d.sdp.type === 'offer') {
            const tr = rtc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
            if (tr) { tr.direction = 'sendrecv'; p.sender = tr.sender; p.sent = undefined; this.gatePeer(p); }
            await rtc.setLocalDescription(await rtc.createAnswer());
            this.link.send({ t: 'signal', to: from, data: { sdp: rtc.localDescription, sid: this.sid } });
          }
        } else if (d.ice) {
          if (!rtc.remoteDescription) p.pending.push(d.ice);
          else { try { await rtc.addIceCandidate(d.ice); } catch (e) {} }
        }
      }).catch(e => console.warn('voice signal', e));
    }
    /* ---- transmit gating ---- */
    isTarget(id) { return this.targets === 'all' || (Array.isArray(this.targets) && this.targets.includes(id)); }
    p2pUp(id) { const p = this.peers.get(id); return !!(p && this.mode !== 'relay' && p.rtc.connectionState === 'connected' && p.sender); }
    gatePeer(p) {
      if (!p.sender) return;
      const want = this.keyed && this.track && this.isTarget(p.id) && p.rtc.connectionState === 'connected' ? this.track : null;
      if (p.sent === want) return;
      p.sent = want; p.sender.replaceTrack(want).catch(() => {});
    }
    applyGate() {
      this.peers.forEach(p => this.gatePeer(p));
      const list = [...this.known].filter(id => this.isTarget(id));
      const relay = this.keyed ? list.filter(id => !this.p2pUp(id)) : [];
      const sig = relay.slice().sort().join(',');
      if (sig !== this._relaySig) { this._relaySig = sig; this.relayTargets = relay; if (this.keyed) this.link.send({ t: 'ptt.relay', relay }); }
      this.setCapture(this.keyed && relay.length > 0);
      return relay;
    }
    /** open the channel: the ptt banner goes out now, the mic opens after `delay` ms (so the key beep is not sent) */
    transmit(targets, delay) {
      this.targets = targets || 'all'; this.keyed = false; this._relaySig = null;
      const list = [...this.known].filter(id => this.isTarget(id));
      const relay = list.filter(id => !this.p2pUp(id));
      this.link.send({ t: 'ptt', state: 'start', targets: this.targets, relay });
      this._relaySig = relay.slice().sort().join(','); this.relayTargets = relay;
      clearTimeout(this._open);
      this._open = setTimeout(() => { this._openedAt = Date.now(); this.keyed = true; this.applyGate(); }, delay == null ? 120 : delay);
      if (!this.stream) this.mic().then(() => this.keyed && this.applyGate()).catch(() => this.emit('micerror', this.micError));
    }
    release() {
      clearTimeout(this._open);
      const was = this.keyed; this.keyed = false; this.applyGate(); this.setCapture(false);
      this.link.send({ t: 'ptt', state: 'end', targets: this.targets });
      return was;
    }
    key(open) { open ? this.transmit(this.targets) : this.release(); }   // legacy
    async setTargets(ids) { this.targets = ids; if (this.keyed) this.applyGate(); }
    /* ---- relay capture: mic -> 12 kHz mu-law -> WebSocket ---- */
    setCapture(on) {
      this._capOn = on;
      if (!on || this._proc || !this.stream) return;
      const c = this.audioCtx(); if (!c) return;
      const src = c.createMediaStreamSource(this.stream), proc = c.createScriptProcessor(2048, 1, 1);
      const mute = c.createGain(); mute.gain.value = 0;
      let pos = 0, seq = 0; const ratio = c.sampleRate / RELAY_RATE;
      proc.onaudioprocess = e => {
        if (!this._capOn || !this.link.ready) return;
        const inp = e.inputBuffer.getChannelData(0), n = Math.floor((inp.length - pos) / ratio);
        if (n <= 0) return;
        const out = new Uint8Array(4 + n); out[0] = 1; out[1] = (seq >> 8) & 255; out[2] = seq & 255; out[3] = RELAY_RATE / 1000; seq = (seq + 1) & 0xffff;
        let k = 0, t = pos;
        for (; k < n; k++, t += ratio) { const i = t | 0, f = t - i, a = inp[i], b = i + 1 < inp.length ? inp[i + 1] : a; out[4 + k] = muEnc((a + (b - a) * f) * 1.4); }
        pos = t - inp.length; if (pos < 0) pos = 0;
        this.stats.relayTx += out.length; this.link.sendBinary(out.buffer);
      };
      src.connect(proc); proc.connect(mute); mute.connect(c.destination); this._proc = proc;
    }
    onRelayAudio(buf) {
      const u8 = new Uint8Array(buf); if (u8.length < 6) return;
      const L = u8[0], id = new TextDecoder().decode(u8.subarray(1, 1 + L)), body = u8.subarray(1 + L);
      if (body[0] !== 1 || body.length < 5) return;
      this.stats.relayRx += body.length;
      if (this.muted.has(id)) return;
      const c = this.audioCtx(); if (!c) return;
      const rate = body[3] * 1000 || RELAY_RATE, n = body.length - 4;
      const ab = c.createBuffer(1, n, rate), ch = ab.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = MU[body[4 + i]];
      let st = this.rx.get(id);
      if (!st) { const g = c.createGain(); g.gain.value = 1; g.connect(c.destination); st = { next: 0, g }; this.rx.set(id, st); }
      const now = c.currentTime;
      if (st.next < now + 0.02 || st.next > now + 1.0) st.next = now + 0.14;     // jitter buffer
      const s = c.createBufferSource(); s.buffer = ab; s.connect(st.g); s.start(st.next); st.next += ab.duration;
      this.emit('relayrx', id);
    }
    /** mute inbound from a unit (escort "monitor" selection) */
    setMonitor(id, on) {
      on ? this.muted.delete(id) : this.muted.add(id);
      const p = this.peers.get(id); if (p && p.audio) p.audio.muted = !on;
    }
    summary() {
      const ids = [...this.known]; let p2p = 0;
      ids.forEach(id => { if (this.p2pUp(id)) p2p++; });
      return { total: ids.length, p2p, relay: ids.length - p2p, mode: this.mode, mic: !!this.track, micError: this.micError };
    }
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

  const platform = {
    ios: /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    android: /Android/.test(navigator.userAgent),
    touch: ('ontouchstart' in global) || navigator.maxTouchPoints > 0,
    bluetooth: !!navigator.bluetooth,
    secure: global.isSecureContext !== false
  };

  global.UL = { platform, haversine, bearing, parseGPX, buildRoute, snap, Link, VoiceNet, Telemetry, BleSensors, EMA, fmt, COLORS: ['#00e5ff', '#ffb000', '#7cff5a', '#ff4d6d', '#b06bff', '#ff8a3d', '#4dffd5', '#ffe14d'] };
})(window);
