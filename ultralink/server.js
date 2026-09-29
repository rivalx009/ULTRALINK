/**
 * ULTRALINK relay server — zero dependencies (Node 18+).
 * Serves the PWA and relays mission state, telemetry and WebRTC signalling.
 *
 *   node server.js            -> http  on :8080
 *   PORT=3000 node server.js
 *   node server.js --tls      -> https on :8443 using ./certs/cert.pem + key.pem
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || (process.argv.includes('--tls') ? 8443 : 8080);
const USE_TLS = process.argv.includes('--tls');
const PUBLIC = path.join(__dirname, 'public');
const STORE = path.join(__dirname, 'missions.json');

/* ---------------------------------------------------------------- storage */
let missions = {};           // code -> { code, name, createdAt, route, riders[], waypoints[] }
try { missions = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (_) {}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STORE, JSON.stringify(missions), () => {});
  }, 500);
}

/* ------------------------------------------------------------ http static */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.gpx': 'application/gpx+xml'
};

function serve(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  const file = path.join(PUBLIC, path.normalize(url).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    res.end(buf);
  });
}

const server = USE_TLS
  ? https.createServer({
      cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')),
      key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem'))
    }, serve)
  : http.createServer(serve);

/* -------------------------------------------------- minimal websocket impl */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  const c = new Client(socket);
  clients.add(c);
});

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.alive = true;
    this.id = crypto.randomUUID();
    this.mission = null; this.role = null; this.callsign = null;
    this.telemetry = null;
    socket.on('data', (d) => this.onData(d));
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
    this.ping = setInterval(() => { if (this.alive) this.frame(0x9, Buffer.alloc(0)); }, 20000);
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (true) {
      const f = this.decode();
      if (!f) break;
      if (f.opcode === 0x8) { this.close(); return; }
      if (f.opcode === 0x9) { this.frame(0xA, f.payload); continue; }
      if (f.opcode === 0xA) continue;
      if (f.opcode === 0x0) { this.frags.push(f.payload); }
      else { this.frags = [f.payload]; this.opcode = f.opcode; }
      if (f.fin) {
        const payload = Buffer.concat(this.frags); this.frags = [];
        if (this.opcode === 0x1) {
          try { handle(this, JSON.parse(payload.toString('utf8'))); } catch (e) {}
        } else if (this.opcode === 0x2) {
          handleBinary(this, payload);
        }
      }
    }
  }
  decode() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) === 0x80, opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) === 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const maskLen = masked ? 4 : 0;
    if (b.length < off + maskLen + len) return null;
    const mask = masked ? b.slice(off, off + 4) : null;
    const payload = Buffer.from(b.slice(off + maskLen, off + maskLen + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.slice(off + maskLen + len);
    return { fin, opcode, payload };
  }
  frame(opcode, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { this.close(); }
  }
  send(obj) { this.frame(0x1, Buffer.from(JSON.stringify(obj))); }
  sendBinary(buf) { this.frame(0x2, buf); }
  close() {
    if (!this.alive) return;
    this.alive = false;
    clearInterval(this.ping);
    clients.delete(this);
    try { this.socket.destroy(); } catch (e) {}
    if (this.mission) broadcastRoster(this.mission);
  }
}

/* -------------------------------------------------------------- protocol  */
function peers(code, exclude) {
  return [...clients].filter(c => c.mission === code && c.alive && c !== exclude);
}
function roster(code) {
  return peers(code, null).map(c => ({
    id: c.id, role: c.role, callsign: c.callsign, color: c.color, telemetry: c.telemetry
  }));
}
function broadcastRoster(code) {
  const r = roster(code);
  peers(code, null).forEach(c => c.send({ t: 'roster', units: r }));
}
function broadcast(code, msg, exclude) {
  peers(code, exclude).forEach(c => c.send(msg));
}

function handle(c, m) {
  switch (m.t) {
    case 'mission.create': {
      const code = (m.code || genCode()).toUpperCase();
      const prev = missions[code] || {};
      missions[code] = Object.assign(prev, {
        code, name: m.name || 'UNNAMED OP', createdAt: prev.createdAt || Date.now(),
        route: m.route || [], riders: m.riders || [], distance: m.distance || 0,
        sectors: m.sectors || [], startAt: m.startAt || null, targetSec: m.targetSec || prev.targetSec || null,
        autoStarted: prev.autoStarted && m.startAt === prev.startAt
      });
      persist();
      c.send({ t: 'mission.created', mission: missions[code] });
      break;
    }
    case 'mission.update': {
      if (missions[m.code]) {
        Object.assign(missions[m.code], m.patch || {});
        if (m.patch && m.patch.startAt !== undefined) missions[m.code].autoStarted = false;
        persist();
        broadcast(m.code, { t: 'mission', mission: missions[m.code] }, null);
      }
      break;
    }
    case 'mission.clock': {
      const mis = missions[m.code];
      if (!mis) return;
      if (m.action === 'start') { mis.clockStart = Date.now(); mis.clockStop = null; }
      if (m.action === 'stop') { mis.clockStop = Date.now(); }
      if (m.action === 'reset') { mis.clockStart = null; mis.clockStop = null; }
      if (m.targetSec !== undefined) mis.targetSec = m.targetSec;
      persist();
      broadcast(m.code, { t: 'mission.clock', clockStart: mis.clockStart || null, clockStop: mis.clockStop || null, targetSec: mis.targetSec || null }, null);
      break;
    }
    case 'mission.abort': {
      const code = m.code;
      if (!missions[code]) return;
      const reason = m.reason || (m.mode === 'close' ? 'MISSION CLOSED' : 'MISSION ABORTED');
      const payload = { t: 'mission.ended', mode: m.mode === 'close' ? 'close' : 'abort', reason, by: c.callsign || 'ESCORT' };
      peers(code, null).forEach(p => p.send(payload));
      delete missions[code];
      persist();
      peers(code, null).forEach(p => { p.mission = null; });
      break;
    }
    case 'join': {
      const code = (m.code || '').toUpperCase();
      const mis = missions[code];
      if (!mis) return c.send({ t: 'error', code: 'NO_MISSION', msg: 'Mission code not found' });
      c.mission = code; c.role = m.role || 'rider';
      c.callsign = (m.callsign || 'UNKNOWN').toUpperCase();
      c.color = m.color || pickColor(code);
      c.send({ t: 'joined', id: c.id, mission: mis, color: c.color });
      broadcastRoster(code);
      break;
    }
    case 'telemetry': {
      if (!c.mission) return;
      c.telemetry = m.data;
      broadcast(c.mission, { t: 'telemetry', id: c.id, callsign: c.callsign, role: c.role, color: c.color, data: m.data }, c);
      break;
    }
    case 'signal': {           // WebRTC offer/answer/ice — targeted
      const dst = [...clients].find(x => x.id === m.to);
      if (dst) dst.send({ t: 'signal', from: c.id, callsign: c.callsign, data: m.data });
      break;
    }
    case 'ptt': {              // {state:'start'|'end', targets:[ids]|'all'}
      if (!c.mission) return;
      const list = m.targets === 'all' ? peers(c.mission, c) :
        peers(c.mission, c).filter(p => (m.targets || []).includes(p.id));
      list.forEach(p => p.send({ t: 'ptt', from: c.id, callsign: c.callsign, color: c.color, state: m.state }));
      break;
    }
    case 'text': {
      if (!c.mission) return;
      broadcast(c.mission, { t: 'text', from: c.id, callsign: c.callsign, body: m.body, ts: Date.now() }, null);
      c.send({ t: 'text', from: c.id, callsign: c.callsign, body: m.body, ts: Date.now() });
      break;
    }
    case 'ping': c.send({ t: 'pong', ts: m.ts }); break;
  }
}
function handleBinary(c, buf) {   // reserved: audio-clip fallback
  if (!c.mission) return;
  peers(c.mission, c).forEach(p => p.sendBinary(buf));
}

const COLORS = ['#00e5ff', '#ffb000', '#7cff5a', '#ff4d6d', '#b06bff', '#ff8a3d', '#4dffd5', '#ffe14d'];
let colorIdx = 0;
function pickColor() { return COLORS[colorIdx++ % COLORS.length]; }
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

/* scheduled departure: start the mission clock automatically at startAt */
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(missions)) {
    const mis = missions[code];
    if (mis.startAt && !mis.autoStarted && !mis.clockStart && now >= mis.startAt) {
      mis.autoStarted = true; mis.clockStart = now; mis.clockStop = null;
      persist();
      broadcast(code, { t: 'mission.clock', clockStart: mis.clockStart, clockStop: null, targetSec: mis.targetSec || null, auto: true }, null);
    }
  }
}, 500);

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('\n  ULTRALINK relay online');
  console.log('  local:   ' + (USE_TLS ? 'https' : 'http') + '://localhost:' + PORT);
  ips.forEach(ip => console.log('  network: ' + (USE_TLS ? 'https' : 'http') + '://' + ip + ':' + PORT));
  console.log('');
});
