/* ULTRALINK desktop app (Windows) — same idea as the Android app:
 * a dedicated window around the ULTRALINK web app on your Render relay, with
 *   • first-run server address screen (pre-filled with the default relay), change it any time (Ctrl+Shift+S)
 *   • mode select → RIDER or ESCORT mode, both available
 *   • native Windows GPS (Windows Location service) fed into the page, browser geolocation as fallback
 *   • microphone / location permissions granted automatically, radio audio plays without a click
 *   • keeps the laptop awake and never throttles telemetry / voice when the window is in the background
 *   • offline screen with automatic retry when the relay is asleep or the network drops
 *   • native "Save as…" for exported mission profiles                                                  */
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');

const DEFAULT_SERVER = 'https://ultralink-1.onrender.com';
const UA_TAG = ' UltralinkDesktop/' + app.getVersion();
const CFG = () => path.join(app.getPath('userData'), 'config.json');
let cfg = {}; let win = null, geo = null, geoSubs = new Set(), blocker = null;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'Translate');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.setAppUserModelId('com.ultralink.desktop');

function loadCfg() { try { cfg = JSON.parse(fs.readFileSync(CFG(), 'utf8')); } catch (e) { cfg = {}; } }
function saveCfg() { try { fs.mkdirSync(path.dirname(CFG()), { recursive: true }); fs.writeFileSync(CFG(), JSON.stringify(cfg, null, 1)); } catch (e) {} }
function normalise(u) {
  u = String(u || '').trim(); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|192\.168\.|10\.)/.test(u) ? 'http://' : 'https://') + u;
  return u.replace(/\/+$/, '');
}
const server = () => cfg.server || '';
const sameOrigin = url => { try { return new URL(url).origin === new URL(server()).origin; } catch (e) { return false; } };

function local(page, q) { win.loadFile(path.join(__dirname, page), { query: q || {} }); }
function openServer(page) {
  if (!server()) return local('setup.html', { server: DEFAULT_SERVER });
  win.loadURL(server() + '/' + (page || ''), { userAgent: win.webContents.getUserAgent() });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 950, minWidth: 980, minHeight: 620, show: false, backgroundColor: '#05080a', title: 'ULTRALINK',
    icon: nativeImage.createFromPath(path.join(__dirname, 'icon.png')), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false }
  });
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '') + UA_TAG);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('page-title-updated', e => { e.preventDefault(); win.setTitle('ULTRALINK'); });
  /* external links open in the normal browser, our own pages stay in the app */
  win.webContents.setWindowOpenHandler(({ url }) => { if (sameOrigin(url)) { win.loadURL(url); } else if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (url.startsWith('file:') || sameOrigin(url)) return; e.preventDefault(); shell.openExternal(url); });
  /* relay asleep / offline → offline screen that retries by itself */
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3 || url.startsWith('file:')) return;            // -3 = aborted (normal navigation)
    local('offline.html', { server: server(), url, err: desc || String(code) });
  });
  win.webContents.on('render-process-gone', () => setTimeout(() => openServer(), 800));
  openServer();
}

/* permissions: microphone (PTT radio), location (GPS), notifications, fullscreen — only for our relay + local pages */
function permissions() {
  const ok = new Set(['media', 'geolocation', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'audioCapture', 'speaker-selection']);
  const trusted = url => !url || url.startsWith('file:') || sameOrigin(url);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(ok.has(perm) && trusted(details.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => ok.has(perm) && trusted(origin));
  session.defaultSession.setDevicePermissionHandler(() => true);
}

/* ------------------------------------------------ native Windows GPS (Windows Location service) */
function startGeo() {
  if (geo || process.platform !== 'win32') { if (process.platform !== 'win32') broadcastGeo('geo:error', 'native GPS only on Windows'); return; }
  const script = path.join(__dirname, 'geo.ps1').replace('app.asar', 'app.asar.unpacked');
  try {
    geo = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  } catch (e) { geo = null; return broadcastGeo('geo:error', e.message); }
  let buf = '', got = false;
  geo.stdout.on('data', d => {
    buf += d.toString();
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      try { const m = JSON.parse(line); if (m.err) { if (!got) broadcastGeo('geo:error', m.err); } else if (m.lat != null) { got = true; broadcastGeo('geo:pos', m); } } catch (e) {}
    }
  });
  geo.on('exit', () => { const was = geo; geo = null; if (!got && was) broadcastGeo('geo:error', 'Windows location service unavailable'); else if (geoSubs.size) setTimeout(startGeo, 3000); });
  geo.on('error', e => { geo = null; broadcastGeo('geo:error', e.message); });
}
function broadcastGeo(ch, v) { geoSubs.forEach(wc => { if (!wc.isDestroyed()) wc.send(ch, v); else geoSubs.delete(wc); }); }

/* --------------------------------------------------------------------------- IPC bridge */
ipcMain.on('cfg:getServer', e => { e.returnValue = server(); });
ipcMain.on('cfg:setServer', (e, u) => { cfg.server = normalise(u); saveCfg(); openServer(); });
ipcMain.on('cfg:resetServer', () => local('setup.html', { server: server() || DEFAULT_SERVER }));
ipcMain.on('nav:retry', (e, url) => { if (url && sameOrigin(url)) win.loadURL(url); else openServer(); });
ipcMain.on('geo:start', e => { geoSubs.add(e.sender); startGeo(); });
ipcMain.on('geo:fresh', () => { if (geo) { try { geo.kill(); } catch (x) {} } else startGeo(); });
ipcMain.handle('file:save', async (e, { name, text }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name || 'ultralink.json') });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, text, 'utf8'); return true;
});
ipcMain.on('app:version', e => { e.returnValue = app.getVersion(); });

function menu() {
  const t = [{ label: 'ULTRALINK', submenu: [
    { label: 'Mode select', accelerator: 'CmdOrCtrl+Home', click: () => openServer() },
    { label: 'Escort mode', accelerator: 'CmdOrCtrl+E', click: () => openServer('escort.html') },
    { label: 'Rider mode', accelerator: 'CmdOrCtrl+Shift+R', click: () => openServer('rider.html') },
    { type: 'separator' },
    { label: 'Change server address…', accelerator: 'CmdOrCtrl+Shift+S', click: () => local('setup.html', { server: server() || DEFAULT_SERVER }) },
    { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
    { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.whenReady().then(() => {
  loadCfg(); permissions(); menu(); createWindow();
  blocker = powerSaveBlocker.start('prevent-display-sleep');
});
app.on('window-all-closed', () => { if (geo) try { geo.kill(); } catch (e) {} if (blocker != null) powerSaveBlocker.stop(blocker); app.quit(); });
