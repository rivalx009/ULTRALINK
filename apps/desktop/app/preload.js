/* window.UltraApp — the same bridge name the Android app uses, so the web pages work in both apps */
const { contextBridge, ipcRenderer } = require('electron');
let geoOn = false; const posCbs = [], errCbs = [];
ipcRenderer.on('geo:pos', (e, p) => posCbs.forEach(f => { try { f(p); } catch (x) {} }));
ipcRenderer.on('geo:error', (e, m) => errCbs.splice(0).forEach(f => { try { f(m); } catch (x) {} }));
contextBridge.exposeInMainWorld('UltraApp', {
  platform: 'desktop',
  version: ipcRenderer.sendSync('app:version'),
  getServer: () => ipcRenderer.sendSync('cfg:getServer'),
  setServer: u => ipcRenderer.send('cfg:setServer', String(u || '')),
  resetServer: () => ipcRenderer.send('cfg:resetServer'),
  retry: url => ipcRenderer.send('nav:retry', url || ''),
  saveFile: (name, text) => ipcRenderer.invoke('file:save', { name: String(name), text: String(text) }),
  /* native Windows GPS: onPos({lat,lon,acc,alt,spd,hdg,ts}), onErr(message) once if unavailable */
  nativeGeo: (onPos, onErr) => { if (typeof onPos === 'function') posCbs.push(onPos); if (typeof onErr === 'function') errCbs.push(onErr); if (!geoOn) { geoOn = true; ipcRenderer.send('geo:start'); } },
  nativeGeoFresh: () => ipcRenderer.send('geo:fresh')
});
