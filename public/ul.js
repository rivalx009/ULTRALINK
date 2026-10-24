/* ULTRALINK shared core — link, geo math, GPX, telemetry, WebRTC PTT net */
/* Desktop app: positions come from the Windows Location service through the app (UltraApp.nativeGeo).
 * navigator.geolocation is wrapped so every page keeps using the normal browser API; if the native
 * provider fails the browser's own geolocation is used instead. */
(function () {
  const A = typeof window !== 'undefined' && window.UltraApp;
  if (!A || typeof A.nativeGeo !== 'function' || !navigator.geolocation) return;
  const orig = navigator.geolocation, ow = orig.watchPosition.bind(orig), og = orig.getCurrentPosition.bind(orig), oc = orig.clearWatch.bind(orig);
  const W = new Map(); let seq = 1, last = null, failed = false, started = false; const once = [];
  const mk = p => ({ coords: { latitude: p.lat, longitude: p.lon, accuracy: p.acc || 30, altitude: p.alt == null ? null : p.alt, altitudeAccuracy: null, heading: p.hdg == null || p.hdg < 0 ? null : p.hdg, speed: p.spd == null || p.spd < 0 ? null : p.spd }, timestamp: p.ts || Date.now() });
  const fallback = () => { if (failed) return; failed = true; W.forEach(w => { if (w.oid == null) w.oid = ow(w.ok, w.err, w.opt); }); once.splice(0).forEach(o => og(o.ok, o.err, o.opt)); };
  const start = () => {
    if (started) return; started = true;
    try {
      A.nativeGeo(p => { if (!p || p.lat == null) return; last = mk(p); W.forEach(w => { if (w.oid == null) w.ok(last); }); once.splice(0).forEach(o => { clearTimeout(o.t); o.ok(last); }); },
        e => { console.warn('native GPS unavailable, using browser geolocation:', e); fallback(); });
    } catch (e) { fallback(); }
  };
  const shim = {
    watchPosition(ok, err, opt) { const id = seq++, w = { ok, err: err || (() => {}), opt }; W.set(id, w); start(); if (failed) w.oid = ow(ok, err, opt); else if (last) setTimeout(() => ok(last), 0); return id; },
    clearWatch(id) { const w = W.get(id); if (w && w.oid != null) oc(w.oid); W.delete(id); },
    getCurrentPosition(ok, err, opt) {
      start(); opt = opt || {};
      if (failed) return og(ok, err, opt);
      if (last && opt.maximumAge !== 0 && Date.now() - last.timestamp < (opt.maximumAge || 0)) return setTimeout(() => ok(last), 0);
      if (opt.maximumAge === 0 && A.nativeGeoFresh) { try { A.nativeGeoFresh(); } catch (e) {} }
      const o = { ok, err: err || (() => {}), opt };
      o.t = setTimeout(() => { const i = once.indexOf(o); if (i >= 0) once.splice(i, 1); last ? ok(last) : og(ok, err, opt); }, Math.min(opt.timeout || 10000, 12000));
      once.push(o);
    }
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: shim, configurable: true }); } catch (e) {}
})();
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
  /** exact position on the route: perpendicular projection onto the nearest route segment
      (windowed search around lastIdx for speed, full search if the window looks wrong) */
  function snap(route, pos, lastIdx) {
    const P = route.points; if (!P || !P.length) return null;
    if (P.length === 1) return { idx: 0, point: P[0], covered: 0, remaining: route.distance, offRoute: haversine(P[0], pos), ele: P[0].ele, grade: P[0].grade, lat: P[0].lat, lon: P[0].lon };
    const kx = 111320 * Math.cos(pos.lat * Math.PI / 180), ky = 110540;
    const pref = lastIdx;
    const search = (from, to) => {
      let best = null;
      for (let i = Math.max(1, from); i <= to; i++) {
        const A = P[i - 1], B = P[i];
        const ax = (A.lon - pos.lon) * kx, ay = (A.lat - pos.lat) * ky, dx = (B.lon - A.lon) * kx, dy = (B.lat - A.lat) * ky, L2 = dx * dx + dy * dy;
        let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = ax + dx * t, oy = ay + dy * t, off = Math.sqrt(ox * ox + oy * oy);
        /* lap routes repeat the same road: equal distance → keep the copy nearest the last position */
        if (!best || off < best.off - 0.5 || (pref != null && off <= best.off + 0.5 && Math.abs(i - pref) < Math.abs(best.i - pref))) best = { i, t, off };
      }
      return best;
    };
    let r = lastIdx != null ? search(lastIdx - 120, Math.min(P.length - 1, lastIdx + 400)) : null;
    if (!r || r.off > 150) { const f = search(1, P.length - 1); if (!r || f.off < r.off) r = f; }
    const A = P[r.i - 1], B = P[r.i], t = r.t;
    const d = A.d + (B.d - A.d) * t, idx = t < 0.5 ? r.i - 1 : r.i;
    return { idx, point: P[idx], covered: d, remaining: route.distance - d, offRoute: r.off,
      ele: A.ele + (B.ele - A.ele) * t, grade: B.grade != null ? B.grade : A.grade, lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (B.lon - A.lon) * t };
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
      clearTimeout(this._rt); this.lastPong = Date.now();
      const ws = this.ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.retry = 0;
        this.emit('open');
        this.queue.splice(0).forEach(m => this.send(m));
        clearInterval(this._hb);
        this._hb = setInterval(() => {if(Date.now()-this.lastPong>15000)return this.kick();this.send({t:'ping',ts:Date.now()});},5000);
      };
      ws.onclose = () => {
        if (ws !== this.ws) return;            // an old socket replaced by kick()
        clearInterval(this._hb);
        this.emit('close');
        const wait = Math.min(8000, 500 * 2 ** this.retry++);
        clearTimeout(this._rt); this._rt = setTimeout(() => this.connect(this.url), wait);
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return this.emit('binary', e.data);
        const m = JSON.parse(e.data);
        if (m.t === 'pong') { this.lastPong = Date.now(); this.rtt = Date.now() - m.ts; this.emit('rtt', this.rtt); return; }
        this.emit(m.t, m);
        this.emit('*', m);
      };
    }
    get ready() { return this.ws && this.ws.readyState === 1; }
    /** called when the app comes back to the screen: reconnect now if the socket died or went silent */
    kick() {
      if (!this.url) return;
      const st = this.ws ? this.ws.readyState : 3;
      if (st === 1 && Date.now() - (this.lastPong || 0) < 12000) return;
      if (st === 0) return;
      const old = this.ws; this.ws = null; try { old && old.close(); } catch (e) {}
      clearInterval(this._hb);this.emit('close');this.retry=0;this.connect(this.url);
    }
    send(m) {if(this.ready){this.ws.send(JSON.stringify(m));return true;}if(!['ptt','ptt.relay','signal','voice.receipt','battery'].includes(m.t))this.queue.push(m);return false;}
    sendBinary(b) {if(!this.ready||this.ws.bufferedAmount>262144)return false;this.ws.send(b);return true;}
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
      this.inputDeviceId = ''; this._micGeneration = 0;
      try { this.inputDeviceId = localStorage.ulAudioInput || ''; } catch(e) {}
      this.selfId = null; this.known = new Set(); this.mode = opts.mode || 'auto';
      this.keyed = false; this.targets = 'all'; this.relayTargets = null; this.muted = new Set();
      this.sid = Math.random().toString(36).slice(2, 10);
      this.ice = ICE; this.ctx = null; this.rx = new Map(); this.stats = { relayTx: 0, relayRx: 0 };
      this.blocked=new Set();this.receipts=new Map();this.inbound=new Map();this.radioLog=[];this.warning='';this.lastFault='';this._txGeneration=0;this._recoverAttempts=0;this._requested=false;this.level=0;
      link.on('signal', m => this.onSignal(m));
      link.on('binary',b=>this.onRelayAudio(b));link.on('ptt',m=>this.receivePtt(m));link.on('voice.receipt',m=>this.receiveReceipt(m));link.on('close',()=>{this.release();this.setWarning('RADIO LINK LOST — PTT CLOSED');});
      try { fetch('ice', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.iceServers && j.iceServers.length) this.ice = j; }).catch(() => {}); } catch (e) {}
      const unlock = () => { this.audioCtx(); this.blocked.forEach(a => a.play().then(() => { this.blocked.delete(a); if (!this.blocked.size) this.emit('unblocked'); }).catch(() => {})); };
      ['pointerdown', 'keydown', 'touchend'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
      this._gate=setInterval(()=>this.healthTick().catch(()=>this.setWarning('RADIO HEALTH CHECK FAILED — TAP REPAIR RADIO')),750);
    }
    emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
    on(t, fn) { this.addEventListener(t, e => fn(e.detail)); return this; }
    audioCtx() {
      const AC=global.AudioContext||global.webkitAudioContext;if(!AC)return null;
      if(this.ctx?.state==='closed'){
        this.clearMicCapture();this.rx.forEach(s=>{try{s.g.disconnect();}catch{}});this.rx.clear();this.ctx=null;this._resuming=null;
      }
      if(!this.ctx){this.ctx=new AC();this.ctx.addEventListener('statechange',()=>{if(this.ctx.state==='running'&&!this.blocked.size){if(this.warning==='AUDIO PAUSED — TAP REPAIR RADIO')this.warning='';this.emit('unblocked');}this.emit('health',this.summary());});}
      const c=this.ctx;
      if(c.state!=='running'&&!this._resuming){
        this._resuming=Promise.resolve(c.resume()).catch(()=>{this.setWarning('AUDIO PAUSED — TAP REPAIR RADIO');}).finally(()=>{this._resuming=null;});
      }
      return c;
    }
    logRadio(kind, detail) {
      this.radioLog.push({time:new Date().toISOString(),kind,detail:String(detail).slice(0,180)});
      if(this.radioLog.length>100)this.radioLog.shift();
    }
    micHealthy() { return !!(this.track && this.track.readyState==='live' && this.track.enabled && !this.track.muted); }
    setWarning(message) { if(this.warning===message)return;this.warning=message;this.logRadio('warning',message);this.emit('health',this.summary()); }
    txFault(reason) {
      this.lastFault=reason;this.logRadio('tx-fault',reason);this.release();
      this.emit('txfault',reason);this.emit('health',this.summary());
    }
    async ensureAudio() {
      const c=this.audioCtx();if(!c)throw Error('AUDIO PROCESSING IS NOT AVAILABLE');
      if(c.state!=='running')await Promise.race([this._resuming,new Promise((_,reject)=>setTimeout(()=>reject(Error('AUDIO PAUSED — TAP REPAIR RADIO')),1800))]);
      if(c.state!=='running')throw Error('AUDIO PAUSED — TAP REPAIR RADIO');
      return c;
    }
    scheduleRecovery() {
      clearTimeout(this._recoverTimer);
      if(this._recoverAttempts>=3)return;
      const delay=[1000,3000,8000][this._recoverAttempts++];
      this._recoverTimer=setTimeout(async()=>{
        if(document.hidden||this.micHealthy())return;
        const ok=await this.recover(true);if(!ok&&!this.micHealthy())this.scheduleRecovery();
      },delay);
    }
    async repair() {
      this.release();this.lastFault='';this.warning='';this.logRadio('repair','USER REQUESTED; PTT REMAINS CLOSED');
      const audio=this.ensureAudio();audio.catch(()=>{});
      for(const id of [...this.peers.keys()])this.dropPeer(id);
      await this.selectMicrophone(this.inputDeviceId);await audio;if(!this.micHealthy())throw Error('SELECTED MICROPHONE STILL UNAVAILABLE');this.sync([...this.known]);
      this.emit('health',this.summary());return this.micHealthy();
    }
    stopClone(p) { if(p.clone){p.clone.enabled=false;p.clone.stop();}p.clone=null;p.cloneSource=null; }
    forceRelay(p,reason) {
      if(this.peers.get(p.id)!==p||p.forceRelay)return;
      p.forceRelay=true;if(p.clone)p.clone.enabled=false;
      this.logRadio('relay-fallback',reason);this.setWarning('DIRECT AUDIO FAILED — USING RELAY');
      this.applyGate();
    }
    async healthTick() {
      if(this._healthBusy)return;this._healthBusy=true;
      try{
        const now=Date.now();
        if(this.keyed){
          if(!this.link.ready){this.txFault('RADIO LINK LOST');return;}
          if(!this.micHealthy()){this.txFault('MICROPHONE INTERRUPTED — RELEASE AND RETRY');return;}
          if(now-this._openedAt>60000){this.txFault('60-SECOND TRANSMIT LIMIT — RELEASE AND PRESS AGAIN');return;}
          this.audioCtx();this.applyGate();
          if(now-this._lastCapture>3500){this.txFault('NO AUDIO PROCESSING — TAP REPAIR RADIO');return;}
          if(now-this._lastCapture>1400&&now-(this._graphRepairAt||0)>2500){this._graphRepairAt=now;this.clearMicCapture();this.setCapture(true);this.logRadio('capture-rebuild','NO PROCESSOR CALLBACKS');}
          if(now-this._lastSignalAt>4000)this.setWarning('NO MIC SIGNAL — SPEAK / CHECK INPUT');
          const txid=this.txid;
          await Promise.all([...this.peers.values()].filter(p=>this.isTarget(p.id)&&this.p2pUp(p.id)&&p.sender?.getStats).map(async p=>{
            try{
              const reports=await Promise.race([p.sender.getStats(),new Promise((_,reject)=>setTimeout(()=>reject(Error('STATS TIMEOUT')),700))]);
              if(!this.keyed||this.txid!==txid||this.peers.get(p.id)!==p)return;let count=0;
              reports.forEach(r=>{if(r.type==='outbound-rtp'&&!r.isRemote)count+=Number(r.bytesSent||r.packetsSent||0);});
              if(p.rtpCount===null||p.rtpCount===undefined){p.rtpCount=count;p.rtpAt=now;}
              else if(count>p.rtpCount){p.rtpCount=count;p.rtpAt=now;}
              else if(now-p.rtpAt>2500)this.forceRelay(p,'OUTBOUND RTP STALLED');
            }catch{ /* unavailable stats never count as verified audio */ }
          }));
        }
        await this.checkReceivers(now);this.emit('health',this.summary());
      }finally{this._healthBusy=false;}
    }
    receivePtt(m) {
      if(m.state==='start'&&m.from&&m.txid){
        this.inbound.set(m.from,{txid:m.txid,since:Date.now(),last:0,relayPackets:0,oldRelay:0,oldRtp:null,rtpTotal:0});
      }else if(m.state==='end')this.inbound.delete(m.from);
    }
    async checkReceivers(now) {
      await Promise.all([...this.inbound].map(async([id,s])=>{
        if(now-s.since>65000){this.inbound.delete(id);return;}
        if(!this.link.ready||now-s.last<1000)return;
        let packets=s.relayPackets-s.oldRelay;s.oldRelay=s.relayPackets;
        let via=packets?'relay':'p2p',blocked=false,muted=this.muted.has(id);const p=this.peers.get(id);
        if(!packets&&p?.rtc?.getStats){
          try{const reports=await Promise.race([p.rtc.getStats(),new Promise((_,reject)=>setTimeout(()=>reject(Error('STATS TIMEOUT')),700))]);let total=0;
            reports.forEach(r=>{if(r.type==='inbound-rtp'&&(r.kind==='audio'||r.mediaType==='audio'))total+=Number(r.packetsReceived||0);});
            packets=s.oldRtp==null?0:Math.max(0,total-s.oldRtp);s.oldRtp=total;
            blocked=!!(p.audio&&(this.blocked.has(p.audio)||p.audio.paused));
          }catch{}
        }
        if(this.inbound.get(id)!==s||!this.link.ready)return;
        if(via==='relay')blocked=this.ctx?.state!=='running';
        const state=muted?'muted':blocked?'blocked':packets>0?'flowing':'noaudio';
        s.last=now;this.link.send({t:'voice.receipt',to:id,txid:s.txid,state,via,packets:Math.min(1000000,packets)});
      }));
    }
    receiveReceipt(m) {
      if(!this.keyed||m.txid!==this.txid||!this.isTarget(m.from)||!this.known.has(m.from))return;
      this.receipts.set(m.from,{state:m.state,via:m.via,at:Date.now(),packets:m.packets});
      if(m.state==='noaudio'&&Date.now()-this._openedAt>3500){const p=this.peers.get(m.from);if(p&&this.p2pUp(p.id))this.forceRelay(p,'RECEIVER REPORTS NO MEDIA');}
      this.emit('health',this.summary());
    }
    diagnostics() {
      return{version:'1.12.3',at:new Date().toISOString(),context:this.ctx?.state||'not-started',mic:this.micHealthy(),trackState:this.track?.readyState||'none',trackMuted:!!this.track?.muted,mode:this.mode,keyed:this.keyed,stats:{...this.stats},status:this.summary().status,captureAgeMs:this._lastCapture?Date.now()-this._lastCapture:null,inputLevel:this.level,peers:[...this.peers.values()].map(p=>({id:p.id,connection:p.rtc.connectionState,relay:!!p.forceRelay,attached:!!p.sent})),events:this.radioLog.slice()};
    }
    inputConstraints(id) {
      return { audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true, ...(id ? {deviceId:{exact:id}} : {}) } };
    }
    clearMicCapture() {
      this._capOn = false;
      for (const node of [this._micSource,this._proc,this._micMute]) { try { node && node.disconnect(); } catch(e) {} }
      if (this._proc) this._proc.onaudioprocess = null;
      this._micSource = this._proc = this._micMute = null;
    }
    installMic(stream,id) {
      const track=stream.getAudioTracks()[0];
      if(!track||track.readyState!=='live'){stream.getTracks().forEach(t=>t.stop());throw Error('MICROPHONE HAS NO LIVE AUDIO TRACK');}
      const old=this.stream;this.clearMicCapture();this.stream=stream;this.track=track;this.inputDeviceId=id;
      track.enabled=true;this.micError=track.muted?'MICROPHONE MUTED / INTERRUPTED':null;
      track.addEventListener('ended',()=>{
        if(this.track!==track)return;
        this.invalidateMicrophone('MICROPHONE DISCONNECTED');this.scheduleRecovery();
      });
      track.addEventListener('mute',()=>{
        if(this.track!==track)return;
        this.micError='MICROPHONE MUTED / INTERRUPTED';this.txFault(this.micError);
        this.emit('micstate',{ready:false,reason:this.micError,id});this.scheduleRecovery();
      });
      track.addEventListener('unmute',()=>{
        if(this.track!==track||!this.micHealthy())return;
        clearTimeout(this._recoverTimer);this._recoverAttempts=0;this.micError=null;
        this.emit('micstate',{ready:true,label:track.label||'Microphone',id});
      });
      this.peers.forEach(p=>{this.stopClone(p);p.sent=undefined;this.gatePeer(p);});
      if(old&&old!==stream)old.getTracks().forEach(t=>t.stop());
      if(!track.muted){this._recoverAttempts=0;clearTimeout(this._recoverTimer);}
      this.emit('micstate',{ready:this.micHealthy(),label:track.label||'Microphone',reason:this.micError,id});
      if(track.muted)this.scheduleRecovery();return stream;
    }
    mic() {
      if(this.micHealthy())return Promise.resolve(this.stream);
      if(this.track?.readyState==='live'&&this.track.muted)return Promise.reject(Error('MICROPHONE MUTED / INTERRUPTED'));
      if(this._micP)return this._micP;
      if(!navigator.mediaDevices?.getUserMedia){this.micError='NO AUDIO API (needs HTTPS)';return Promise.reject(Error(this.micError));}
      const generation=++this._micGeneration,id=this.inputDeviceId;
      const request=navigator.mediaDevices.getUserMedia(this.inputConstraints(id)).then(stream=>{
        if(generation!==this._micGeneration){stream.getTracks().forEach(t=>t.stop());throw Error('MIC REQUEST SUPERSEDED');}
        return this.installMic(stream,id);
      }).catch(e=>{
        if(generation===this._micGeneration){this.micError=e.message||'MIC DENIED';this.emit('micstate',{ready:false,reason:this.micError,id});}throw e;
      }).finally(()=>{if(generation===this._micGeneration)this._micP=null;});
      this._micP=request;return request;
    }
    invalidateMicrophone(reason) {
      this.release();++this._micGeneration;this.clearMicCapture();
      const old=this.stream;this.stream=null;this.track=null;this._micP=null;this.micError=reason;
      this.peers.forEach(p=>this.stopClone(p));if(old)old.getTracks().forEach(t=>t.stop());
      this.logRadio('mic-fault',reason);this.emit('micstate',{ready:false,reason,id:this.inputDeviceId});
    }
    async selectMicrophone(id='') {
      if(!navigator.mediaDevices?.getUserMedia)throw Error('MICROPHONE SELECTION REQUIRES HTTPS / AUDIO PERMISSION');
      this.release();clearTimeout(this._recoverTimer);const generation=++this._micGeneration;
      const request=navigator.mediaDevices.getUserMedia(this.inputConstraints(id)).then(stream=>{
        if(generation!==this._micGeneration){stream.getTracks().forEach(t=>t.stop());throw Error('MIC REQUEST SUPERSEDED');}
        this.installMic(stream,id);try{localStorage.ulAudioInput=id;}catch{}return stream;
      }).finally(()=>{if(generation===this._micGeneration)this._micP=null;});
      this._micP=request;return request;
    }
    /** Recover the selected input only; it must not reopen PTT or select a different mic. */
    async recover(force=false) {
      this.audioCtx();if(this.micHealthy())return false;
      if(this._recoverPromise)return this._recoverPromise;
      this._recoverPromise=(async()=>{
        this.release();if(force&&this.track?.muted)this.invalidateMicrophone('RECONNECTING SELECTED MICROPHONE');
        try{await this.mic();if(!this.micHealthy())return false;this.emit('recovered');return true;}catch{return false;}
      })().finally(()=>{this._recoverPromise=null;});return this._recoverPromise;
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
      this.peers.delete(id);clearTimeout(p.retry);this.stopClone(p);
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
    p2pUp(id) {
      const p=this.peers.get(id);
      return !!(p&&this.mode!=='relay'&&!p.forceRelay&&p.rtc.connectionState==='connected'&&p.sender);
    }
    gatePeer(p) {
      if(!p.sender)return;
      const allowed=this.keyed&&this.micHealthy()&&this.isTarget(p.id)&&this.p2pUp(p.id);
      if(allowed&&(!p.clone||p.cloneSource!==this.track)){
        this.stopClone(p);p.clone=this.track.clone();p.cloneSource=this.track;p.clone.enabled=false;
      }
      if(p.clone)p.clone.enabled=!!allowed;
      p.wantTrack=allowed?p.clone:null;
      if(p.attachBusy)return;
      p.attachBusy=true;
      const drain=async()=>{
        try{
          while(this.peers.get(p.id)===p&&p.sent!==p.wantTrack){
            const want=p.wantTrack;let timer;
            try{
              await Promise.race([Promise.resolve(p.sender.replaceTrack(want)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TRACK ATTACH TIMEOUT')),2000);})]);
              p.sent=want; // only record a successful attachment
              if(this.peers.get(p.id)===p)this.applyGate();
            }catch(e){
              if(p.clone)p.clone.enabled=false;
              // A late failed/stalled attachment can only attach a disabled clone.
              p.attachBusy=false;this.forceRelay(p,'MIC TRACK ATTACHMENT FAILED');return;
            }finally{clearTimeout(timer);}
          }
        }finally{p.attachBusy=false;}
      };drain().catch(()=>{p.attachBusy=false;this.forceRelay(p,'MIC TRACK ATTACHMENT FAILED');});
    }
    applyGate() {
      this.peers.forEach(p=>this.gatePeer(p));
      const list=[...this.known].filter(id=>this.isTarget(id));
      const relay=this.keyed?list.filter(id=>!this.p2pUp(id)||this.peers.get(id)?.sent!==this.peers.get(id)?.clone):[];
      const sig=relay.slice().sort().join(',');
      if(sig!==this._relaySig){this._relaySig=sig;this.relayTargets=relay;if(this.keyed&&this.link.ready)this.link.send({t:'ptt.relay',relay});}
      // Process/measure the input during ALL transmissions, including direct P2P.
      try{this.setCapture(this.keyed);}catch{if(this.keyed)this.txFault('AUDIO CAPTURE FAILED — TAP REPAIR RADIO');}return relay;
    }
    /** prepare audio, then announce PTT after the key-beep delay; release cancels preparation */
    transmit(targets,delay) {
      this.audioCtx(); // synchronous user-gesture unlock, including consumed hardware keys
      if(!this.link.ready){this.txFault('RADIO LINK OFFLINE — NOT TRANSMITTED');return false;}
      this.release();this.targets=targets||'all';this._requested=true;this.lastFault='';this.warning='';this.receipts.clear();
      const token=++this._txGeneration,start=Date.now();
      this.txid=this.sid+'-'+token+'-'+Date.now().toString(36);this.emit('txstate',{state:'preparing'});
      const prepare=async()=>{
        try{
          await Promise.all([this.mic(),this.ensureAudio()]);
          if(!this._requested||token!==this._txGeneration)return;
          if(!this.micHealthy())throw Error('MICROPHONE NOT READY');
          this._open=setTimeout(()=>{
            if(!this._requested||token!==this._txGeneration)return;
            if(!this.link.ready||!this.micHealthy()){this.txFault('MICROPHONE OR LINK LOST — NOT TRANSMITTED');return;}
            this._openedAt=Date.now();this.logRadio('tx-start','REQUESTED AUDIO; WAITING FOR SOFTWARE RECEIPTS');this._lastSignalAt=this._openedAt;this._lastCapture=this._openedAt;this.keyed=true;
            this.peers.forEach(p=>{p.rtpAt=this._openedAt;p.rtpCount=null;});
            const relay=[...this.known].filter(id=>this.isTarget(id)&&!this.p2pUp(id));
            this._pttAnnounced=true;this.link.send({t:'ptt',state:'start',targets:this.targets,relay,txid:this.txid});
            this._relaySig=null;this.applyGate();this.emit('txstate',{state:'sending'});
          },Math.max(0,(delay==null?120:delay)-(Date.now()-start)));
        }catch(e){if(token===this._txGeneration){this.micError=this.micHealthy()?null:(e.message||'MICROPHONE UNAVAILABLE');this.txFault(e.message||'RADIO COULD NOT START');}}
      };prepare();return true;
    }
    release() {
      ++this._txGeneration;this._requested=false;clearTimeout(this._open);this._open=null;
      const was=this.keyed;this.keyed=false;this.peers.forEach(p=>{if(p.clone)p.clone.enabled=false;});
      this.applyGate();this.setCapture(false);
      if(this._pttAnnounced&&this.link.ready)this.link.send({t:'ptt',state:'end',targets:this.targets,txid:this.txid});
      this._pttAnnounced=false;this.emit('txstate',{state:'idle'});return was;
    }
    key(open) { open ? this.transmit(this.targets) : this.release(); }   // legacy
    async setTargets(ids) { this.targets = ids; if (this.keyed) this.applyGate(); }
    /* ---- relay capture: mic -> 12 kHz mu-law -> WebSocket ---- */
    setCapture(on) {
      this._capOn = on;
      if(!on||!this.stream)return;
      const c=this.audioCtx();if(!c||this._proc)return;
      const src = c.createMediaStreamSource(this.stream), proc = c.createScriptProcessor(2048, 1, 1);
      const mute = c.createGain(); mute.gain.value = 0;
      let pos = 0, seq = 0; const ratio = c.sampleRate / RELAY_RATE;
      proc.onaudioprocess = e => {
        if(!this._capOn||!this.keyed||!this.link.ready)return;
        const inp=e.inputBuffer.getChannelData(0);this._lastCapture=Date.now();let energy=0;for(const x of inp)energy+=x*x;this.level=Math.sqrt(energy/inp.length);if(this.level>.001){this._lastSignalAt=Date.now();if(this.warning==='NO MIC SIGNAL — SPEAK / CHECK INPUT')this.warning='';}
        if(!this.relayTargets?.length)return;const n=Math.floor((inp.length-pos)/ratio);
        if (n <= 0) return;
        const out = new Uint8Array(4 + n); out[0] = 1; out[1] = (seq >> 8) & 255; out[2] = seq & 255; out[3] = RELAY_RATE / 1000; seq = (seq + 1) & 0xffff;
        let k = 0, t = pos;
        for (; k < n; k++, t += ratio) { const i = t | 0, f = t - i, a = inp[i], b = i + 1 < inp.length ? inp[i + 1] : a; out[4 + k] = muEnc((a + (b - a) * f) * 1.4); }
        pos = t - inp.length; if (pos < 0) pos = 0;
        if(this.link.sendBinary(out.buffer)!==false)this.stats.relayTx+=out.length;else this.setWarning('AUDIO NETWORK CONGESTED — SOME PACKETS DROPPED');
      };
      src.connect(proc); proc.connect(mute); mute.connect(c.destination); this._proc = proc; this._micSource = src; this._micMute = mute;
    }
    onRelayAudio(buf) {
      const u8 = new Uint8Array(buf); if (u8.length < 6) return;
      const L = u8[0], id = new TextDecoder().decode(u8.subarray(1, 1 + L)), body = u8.subarray(1 + L);
      if (body[0] !== 1 || body.length < 5) return;
      this.stats.relayRx+=body.length;const inbound=this.inbound.get(id);if(inbound)inbound.relayPackets++;
      if (this.muted.has(id)) return;
      const c=this.audioCtx();if(!c)return;if(c.state!=='running'){this.emit('blocked');return;}
      const rate=body[3] * 1000 || RELAY_RATE, n = body.length - 4;
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
      const now=Date.now(),targets=ids.filter(id=>this.isTarget(id));let received=0,blocked=0;
      for(const id of targets){const r=this.receipts.get(id);if(r&&now-r.at<4000){if(r.state==='flowing')received++;if(r.state==='blocked'||r.state==='muted')blocked++;}}
      const status=this.lastFault||(!this.micHealthy()?'MIC NOT READY':this._requested&&!this.keyed?'PREPARING AUDIO':this.keyed?('TX ACTIVE · MEDIA RECEIVED '+received+'/'+targets.length+(blocked?' · BLOCKED/MUTED '+blocked:'')+(this.warning?' · '+this.warning:'')):this.warning||'RADIO IDLE');
      return{total:ids.length,p2p,relay:ids.length-p2p,mode:this.mode,mic:this.micHealthy(),micError:this.micError,requested:this._requested,keyed:this.keyed,received,targets:targets.length,level:this.level,status,warning:this.warning,fault:this.lastFault};
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

  function batteryView(b,now=Date.now()){
    if(!b)return{text:'BAT — WAITING',color:'var(--dim)'};
    if(b.status!=='ok'||!Number.isFinite(b.percent))return{text:'BATTERY UNAVAILABLE',color:'var(--dim)'};
    const age=Math.max(0,Math.floor((now-b.at)/1000)),stale=!Number.isFinite(age)||age>90;
    return{text:'BAT '+b.percent+'%'+(b.charging?' · CHARGING':'')+' · '+(stale?'STALE':age+'s ago'),color:stale?'var(--dim)':b.percent<=15?'var(--bad)':b.percent<=30?'var(--warn)':'var(--good)'};
  }
  global.UL = { batteryView, platform, haversine, bearing, parseGPX, buildRoute, snap, Link, VoiceNet, Telemetry, BleSensors, EMA, fmt, COLORS: ['#00e5ff', '#ffb000', '#7cff5a', '#ff4d6d', '#b06bff', '#ff8a3d', '#4dffd5', '#ffe14d'] };
})(window);

;
/* ULTRALINK hardware setup: OS-paired Bluetooth/USB microphones and standard
   keyboard/HID PTT buttons. No proprietary Bluetooth protocol or background hotkeys. */
(function(global){'use strict';
class HardwarePTT {
  constructor(opts){
    this.opts=opts;this.config={key:'',mode:'hold',limit:60};
    try{Object.assign(this.config,JSON.parse(localStorage.ulHardwarePTT||'{}'));}catch(e){}
    if(!['hold','toggle'].includes(this.config.mode))this.config.mode='hold';this.config.limit=60;
    this.root=null;this.learning=false;this.testing=false;this.down=false;this.active=false;this.status='PAIR IN WINDOWS / macOS FIRST, THEN REFRESH THE DEVICE LIST.';
    addEventListener('keydown',e=>this.keyDown(e),true);addEventListener('keyup',e=>this.keyUp(e),true);
    addEventListener('blur',()=>this.release('WINDOW LOST FOCUS — PTT RELEASED'));
    document.addEventListener('focusin',e=>{if(this.active&&this.blockedTarget(e))this.release('INPUT OR DIALOG FOCUSED — PTT RELEASED');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release('PAGE HIDDEN — PTT RELEASED');});
    navigator.mediaDevices?.addEventListener('devicechange',()=>{clearTimeout(this.deviceTimer);this.deviceTimer=setTimeout(()=>this.devicesChanged(),1200);});
  }
  async reset(){this.release('HARDWARE SETTINGS RESET');this.config={key:'',mode:'hold',limit:60};this.save();this.drawBinding();if(this.opts.getVoice())await this.chooseInput('');else{try{localStorage.ulAudioInput='';}catch(e){}}}
  save(){try{localStorage.ulHardwarePTT=JSON.stringify(this.config);}catch(e){}}
  el(id){return this.root?.querySelector('[data-hw="'+id+'"]');}
  show(text){this.status=text;const e=this.el('status');if(e)e.textContent=text;}
  attachVoice(voice){voice.on('micstate',s=>{if(!s.ready){this.release('MICROPHONE UNAVAILABLE — PTT RELEASED');this.show(s.reason+' — RECONNECT OR SELECT A DIFFERENT INPUT.');}else this.show('MIC READY: '+s.label);});}
  blockedTarget(e){return e.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)||!!document.querySelector('dialog[open]');}
  consume(e){e.preventDefault();e.stopImmediatePropagation();}
  keyDown(e){
    if(this.learning){
      this.consume(e);if(e.repeat)return;
      if(e.code==='Escape'){this.cancelLearn();return;}
      if(!e.code||e.code==='Unidentified'||/^(Shift|Control|Alt|Meta)/.test(e.code)||['Tab','CapsLock','NumLock'].includes(e.code)||e.ctrlKey||e.altKey||e.metaKey){this.show('PRESS THE PTT BUTTON ALONE — NOT A MODIFIER OR SYSTEM SHORTCUT.');return;}
      this.config.key=e.code;if(/^Media|^Audio/.test(e.code))this.config.mode='toggle';this.save();this.learning=false;clearTimeout(this.learnTimer);this.down=true;this.justLearned=true;
      this.drawBinding();this.show('LEARNED '+e.code+'. RELEASE IT, THEN TEST. LEARNING DID NOT TRANSMIT.');return;
    }
    if(!this.config.key||e.code!==this.config.key)return;
    if(!this.testing&&this.blockedTarget(e))return;
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    this.consume(e);if(e.repeat||this.down)return;this.down=true;
    if(this.config.mode==='toggle')setTimeout(()=>{this.down=false;},150);
    if(this.testing){this.show('TEST: BUTTON PRESSED ('+e.code+') — NO RADIO TRANSMISSION.');return;}
    if(this.config.mode==='toggle'&&this.active){this.release('PTT CLOSED');this.down=true;return;}
    const voice=this.opts.getVoice();
    if(!this.opts.canTransmit()||!voice?.micHealthy()){this.show('PTT NOT OPENED — CHECK MIC, LINK AND NORMAL RADIO MODE.');return;}
    this.opts.start();this.active=!!this.opts.transmitting();
    if(this.active){this.show('PHYSICAL PTT TRANSMITTING TO ALL UNITS');this.timer=setTimeout(()=>{this.release('60-SECOND SAFETY LIMIT — RELEASE AND PRESS AGAIN');this.down=this.config.mode==='hold';},this.config.limit*1000);}
  }
  keyUp(e){
    if(!this.config.key||e.code!==this.config.key)return;
    if(!this.down&&!this.active&&!this.testing)return;this.consume(e);this.down=false;
    if(this.justLearned){this.justLearned=false;this.show('BUTTON LEARNED AND RELEASED — USE DRY TEST BEFORE LIVE PTT.');return;}
    if(this.testing){this.show('TEST: BUTTON RELEASED — PRESS/RELEASE EVENTS RECEIVED. NO TRANSMISSION.');return;}
    if(this.config.mode==='hold')this.release('PTT CLOSED');
  }
  release(reason){clearTimeout(this.timer);this.timer=null;this.active=false;this.down=false;this.opts.stop();if(reason)this.show(reason);}
  drawBinding(){if(this.el('binding'))this.el('binding').textContent=this.config.key||'NO PHYSICAL BUTTON LEARNED';if(this.el('mode'))this.el('mode').value=this.config.mode;if(this.el('learn'))this.el('learn').textContent=this.learning?'WAITING FOR BUTTON…':'LEARN PTT BUTTON';}
  cancelLearn(){this.learning=false;this.down=false;clearTimeout(this.learnTimer);this.drawBinding();this.show('LEARNING CANCELLED — CURRENT BINDING KEPT.');}
  async listDevices(permission=false){
    if(!navigator.mediaDevices?.enumerateDevices){this.show('AUDIO DEVICE LIST UNAVAILABLE — USE HTTPS AND A SUPPORTED BROWSER.');return;}
    try{
      if(permission){const voice=this.opts.getVoice();if(voice)await voice.mic();else{const id=localStorage.ulAudioInput||'';const stream=await navigator.mediaDevices.getUserMedia({audio:id?{deviceId:{exact:id}}:true});stream.getTracks().forEach(t=>t.stop());}}
      const all=await navigator.mediaDevices.enumerateDevices();this.devices=all.filter(d=>d.kind==='audioinput');
      const select=this.el('input');if(!select)return;select.replaceChildren();select.append(new Option('Default — system microphone',''));
      this.devices.filter(d=>d.deviceId&&d.deviceId!=='default').forEach((d,i)=>select.append(new Option(d.label||'Microphone '+(i+1)+' — allow access to show its name',d.deviceId)));
      const id=this.opts.getVoice()?.inputDeviceId||localStorage.ulAudioInput||'';
      if(id&&!this.devices.some(d=>d.deviceId===id)){const live=this.opts.getVoice()?.track?.readyState==='live';select.append(new Option(live?'Connected microphone — inventory updating':'Saved microphone — currently unavailable',id));}select.value=id;
      if(permission)this.show('DEVICE LIST REFRESHED. SELECT A MICROPHONE TO CONNECT IT.');
    }catch(e){this.show('DEVICE ACCESS FAILED: '+(e.message||e.name));}
  }
  async chooseInput(id){
    const selection = this.selectionSeq = (this.selectionSeq || 0) + 1;
    this.release('CHANGING MICROPHONE — PTT RELEASED');this.stopMeter();
    const old=this.opts.getVoice()?.inputDeviceId||localStorage.ulAudioInput||'';
    try{
      const voice=this.opts.getVoice();
      if(voice){await voice.selectMicrophone(id);if(selection!==this.selectionSeq)return;if(this.el('input'))this.el('input').value=id;this.show('CONNECTED MICROPHONE: '+(voice.track?.label||'system default'));}
      else{const stream=await navigator.mediaDevices.getUserMedia({audio:id?{deviceId:{exact:id}}:true});stream.getTracks().forEach(t=>t.stop());if(selection!==this.selectionSeq)return;localStorage.ulAudioInput=id;if(this.el('input'))this.el('input').value=id;this.show('MICROPHONE SAVED — USED WHEN YOU ENTER A MISSION.');}
    }catch(e){if(selection!==this.selectionSeq)return;if(this.el('input'))this.el('input').value=old;this.show('MIC CHANGE FAILED: '+(e.message||e.name)+'. PREVIOUS INPUT KEPT; NO SILENT FALLBACK.');}
  }
  async devicesChanged(){
    const sequence=this.deviceSequence=(this.deviceSequence||0)+1;
    const voice=this.opts.getVoice(),id=voice?.inputDeviceId||localStorage.ulAudioInput||'';
    try{
      let devices=await navigator.mediaDevices.enumerateDevices();
      const present=()=>devices.some(d=>d.kind==='audioinput'&&d.deviceId===id);
      if(id&&!present()){
        // Enumeration may be incomplete during permission/profile transitions.
        // A live track is stronger evidence than a missing inventory entry.
        if(voice?.track?.readyState==='live'){await this.listDevices(false);return;}
        await new Promise(resolve=>setTimeout(resolve,1000));
        if(sequence!==this.deviceSequence)return;
        devices=await navigator.mediaDevices.enumerateDevices();
        if(voice!==this.opts.getVoice()||id!==(voice?.inputDeviceId||localStorage.ulAudioInput||''))return;
        if(!present()&&voice?.track?.readyState!=='live'){
          this.release('SELECTED MICROPHONE UNAVAILABLE — PTT RELEASED');
          voice?.invalidateMicrophone('SELECTED MICROPHONE UNAVAILABLE');
          this.show('SELECTED MICROPHONE UNAVAILABLE. RECONNECT IT OR EXPLICITLY CHOOSE ANOTHER INPUT.');
        }
      }
      if(id&&present()&&voice&&voice.track?.readyState!=='live')await voice.recover();
      await this.listDevices(false);
    }catch(e){this.show('DEVICE LIST CHECK FAILED: '+(e.message||e.name)+'. EXISTING INPUT KEPT.');}
  }
  async startMeter(){
    this.release('LOCAL MICROPHONE TEST — NO RADIO TRANSMISSION');this.stopMeter();
    try{const voice=this.opts.getVoice();if(!voice)throw new Error('ENTER A MISSION FIRST');const stream=await voice.mic();const c=voice.audioCtx();this.meterSource=c.createMediaStreamSource(stream);this.analyser=c.createAnalyser();this.analyser.fftSize=512;this.meterSource.connect(this.analyser);const data=new Uint8Array(512);
      const tick=()=>{if(!this.root?.isConnected||!this.analyser){this.stopMeter();return;}this.analyser.getByteTimeDomainData(data);let sum=0;for(const x of data)sum+=((x-128)/128)**2;const value=Math.min(100,Math.round(Math.sqrt(sum/data.length)*250));const meter=this.el('meter');if(meter)meter.value=value;this.meterFrame=requestAnimationFrame(tick);};tick();this.show('SPEAK INTO THE SELECTED MIC. THE LEVEL METER IS LOCAL; NOTHING IS TRANSMITTED.');
    }catch(e){this.show('MIC TEST FAILED: '+(e.message||e.name));}
  }
  stopMeter(){cancelAnimationFrame(this.meterFrame);try{this.meterSource?.disconnect();}catch(e){}this.meterSource=null;this.analyser=null;const meter=this.el('meter');if(meter)meter.value=0;}
  unmount(){this.stopMeter();this.testing=false;this.learning=false;clearTimeout(this.learnTimer);this.root=null;}
  mount(root){this.unmount();this.root=root;
    root.innerHTML='<section class="hw-panel"><h3>BLUETOOTH / USB AUDIO &amp; PHYSICAL PTT</h3><p class="hw-note">Pair your device in Windows/macOS first. ULTRALINK supports microphones exposed as standard audio inputs and PTT buttons that send keyboard/HID key events to this page. Proprietary radio-only buttons need device-specific integration.</p><button type="button" data-hw="refresh">ALLOW MIC ACCESS / REFRESH DEVICES</button><label for="hwInput">Audio input</label><select id="hwInput" data-hw="input"><option value="">Default — system microphone</option></select><div class="hw-row"><button type="button" data-hw="default">USE SYSTEM DEFAULT</button><button type="button" data-hw="micTest">TEST MIC LEVEL</button><button type="button" data-hw="meterStop">STOP MIC TEST</button></div><meter data-hw="meter" min="0" max="100" value="0" aria-label="Local microphone level"></meter><div class="hw-divider"><label>Physical PTT button · broadcasts to all units</label><div class="hw-key" data-hw="binding"></div><div class="hw-row"><button type="button" data-hw="learn">LEARN PTT BUTTON</button><button type="button" data-hw="clear">CLEAR BUTTON</button><button type="button" data-hw="test" aria-pressed="false">TEST BUTTON — NO TX</button></div><label for="hwMode">Button behavior</label><select id="hwMode" data-hw="mode"><option value="hold">Hold — press / release</option><option value="toggle">Toggle — tap on / off</option></select><p class="hw-note">The learned key overrides any shortcut using that same key; prefer an unused key. Keep this window focused. Typing and dialogs cannot start transmission. Loss of focus, link loss, mic loss or the 60-second safety limit closes PTT. Media buttons work only when the browser receives their events; OS-intercepted buttons cannot be learned here.</p></div><div class="hw-row"><button type="button" data-hw="repair">REPAIR RADIO</button><button type="button" data-hw="export">EXPORT RADIO DIAGNOSTICS</button></div><p class="hw-note">Repair reconnects the selected microphone and voice paths with PTT closed. Diagnostics contain status/counters, not recorded audio or account credentials.</p><div class="hw-status" data-hw="status" role="status" aria-live="polite"></div></section>';
    this.drawBinding();this.show(this.status);this.listDevices(false);
    this.el('repair').onclick=async()=>{this.stopMeter();this.release('REPAIRING RADIO — PTT CLOSED');const v=this.opts.getVoice();if(!v)return this.show('ENTER A MISSION FIRST');try{await v.repair();this.show('RADIO REPAIRED — TEST WITH A RIDER BEFORE CONTINUING');}catch(e){this.show('REPAIR FAILED: '+e.message);}};
    this.el('export').onclick=()=>{const v=this.opts.getVoice();if(!v)return this.show('ENTER A MISSION FIRST');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(v.diagnostics(),null,2)],{type:'application/json'}));a.href=url;a.download='ultralink-radio-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    this.el('refresh').onclick=()=>this.listDevices(true);this.el('input').onchange=e=>this.chooseInput(e.target.value);this.el('default').onclick=()=>this.chooseInput('');
    this.el('micTest').onclick=()=>this.startMeter();this.el('meterStop').onclick=()=>{this.stopMeter();this.show('LOCAL MIC TEST STOPPED');};
    this.el('learn').onclick=()=>{this.release();this.stopMeter();this.testing=false;this.el('test').setAttribute('aria-pressed','false');this.learning=true;this.drawBinding();this.show('PRESS AND RELEASE YOUR PHYSICAL PTT BUTTON NOW. ESCAPE CANCELS. NO TRANSMISSION.');this.learnTimer=setTimeout(()=>{if(this.learning){this.cancelLearn();this.show('NO BUTTON EVENT RECEIVED. CHECK PAIRING / FOCUS; THIS BUTTON MAY USE AN UNSUPPORTED PROTOCOL.');}},15000);};
    this.el('clear').onclick=()=>{this.release();this.cancelLearn();this.config.key='';this.save();this.drawBinding();this.show('PHYSICAL BINDING CLEARED. NORMAL SPACE / ON-SCREEN PTT STILL WORK.');};
    this.el('test').onclick=()=>{this.release();this.testing=!this.testing;this.el('test').setAttribute('aria-pressed',String(this.testing));this.show(this.testing?'DRY BUTTON TEST ACTIVE — PRESS/RELEASE THE LEARNED BUTTON. NO TX.':'BUTTON TEST STOPPED');};
    this.el('mode').onchange=e=>{this.release();this.config.mode=e.target.value;this.save();this.show('BUTTON MODE: '+this.config.mode.toUpperCase());};
    const dialog=root.closest('dialog');if(dialog){this.dialogClose=()=>{this.unmount();};dialog.addEventListener('close',this.dialogClose,{once:true});}
  }
}
global.UL.HardwarePTT=HardwarePTT;
})(window);
