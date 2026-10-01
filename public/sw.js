const C='ultralink-v4';
const A=['./','index.html','rider.html','escort.html','sim.html','ul.css','ul.js','ul-fx.js','ul-ui.js','ul-sectors.js','ul-settings.js','ul-boot.js','ul-wind.js','ul-map.js','rider.js','escort.js','escort-plan.js','leaflet.js','leaflet.css','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
/* network first (always the newest app when online), cache as fallback when offline. Map tiles, /health, /ice are never cached. */
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin||e.request.method!=='GET'||/\/(health|ice)$|\.apk$/.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r}).catch(()=>caches.match(e.request)));
});
