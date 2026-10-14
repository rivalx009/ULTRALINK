/* ULTRALINK v1.9: rider-reported alerts, distance, focus, audio arbitration,
   mission isolation, acknowledgements, reconnects and mobile layout. */
const fs = require('fs');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/vercel/sandbox/node_modules/playwright'); }
const {chromium} = pw, crypto = require('crypto'), path = require('path');
const QA = process.env.UL_SHOTS || path.join(__dirname, 'shots'); fs.mkdirSync(QA, { recursive: true });
const BASE=process.env.UL_BASE||'http://127.0.0.1:8080/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const check=(name,yes)=>{console.log(`${yes?'PASS':'FAIL'} ${name}`);yes?pass++:fail++;};
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
function client(){const ws=new WebSocket(BASE.replace(/^http/,'ws'));const h={};ws.onmessage=e=>{const m=JSON.parse(e.data);(h[m.t]||[]).forEach(f=>f(m));};return {ws,on:(t,f)=>(h[t]||=[]).push(f),send: m=>ws.send(JSON.stringify(m)),ready:()=>new Promise(r=>ws.addEventListener('open',r,{once:true})),wait:t=>new Promise(r=>(h[t]||=[]).push(r))};}
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM || (fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const errors=[];const contexts=[];
const mk=async(vp,geo={latitude:-20.3484,longitude:57.5522})=>{const c=await browser.newContext({viewport:vp,permissions:['microphone','geolocation'],geolocation:geo});contexts.push(c);await c.route(u=>u.hostname!=='127.0.0.1',r=>/open-meteo/.test(r.request().url())?r.fulfill({status:503,body:''}):r.fulfill({status:200,contentType:'image/png',body:PNG}));return c;};
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));return p;};
const esc=watch(await (await mk({width:1600,height:950})).newPage());
await esc.goto(BASE+'escort.html?noboot=1');await esc.evaluate(()=>{localStorage.ulPlanHelp=1;});await esc.reload();
await esc.waitForSelector('#home',{state:'visible'});await esc.click('#pNew');await esc.fill('#fName','ALERT TEST');await esc.fill('#fEsc','RESCUE-1');await esc.setInputFiles('#fGpx',__dirname+'/demo-route.gpx');await sleep(500);await esc.click('#dGo');await esc.waitForSelector('#shell',{state:'visible'});
const code=(await esc.textContent('#tCode')).replace('CODE ','');
const rider=watch(await (await mk({width:390,height:844},{latitude:-20.3504,longitude:57.5542})).newPage());
await rider.goto(BASE+'rider.html');await rider.fill('#code',code);await rider.fill('#callsign','FALCON-1');await rider.click('#go');await rider.waitForSelector('#app',{state:'visible'});await sleep(1000);
await rider.click('#btnRiderDown');await esc.waitForSelector('.incident.riderDown');await sleep(1500);
check('red RIDER DOWN one-tap button',await rider.evaluate(()=>document.getElementById('btnRiderDown').getAttribute('aria-pressed')==='true'));
check('relay receipt clearly distinguished from escort acknowledgement',/AWAITING ESCORT ACK/.test(await rider.textContent('#riderAlertStatus')));
check('escort widget identifies rider',/FALCON-1/.test(await esc.textContent('.incident.riderDown')));
check('distance in widget is valid straight-line distance',/\d+ M TO RIDER · STRAIGHT-LINE/.test(await esc.textContent('.incident.riderDown')));
check('map instantly focuses at close zoom',await esc.evaluate(()=>{const a=[...__ul.incidents.values()][0];return __map.getZoom()>=16&&__map.distance(__map.getCenter(),[a.data.lat,a.data.lon])<10;}));
check('rider down alarm selected',await esc.evaluate(()=>UL.fx.alarmOn&&UL.fx.alarmKind==='riderDown'));
const decoded=await esc.evaluate(async()=>{const c=new AudioContext();const b=await fetch('rider-down-alert.mp3').then(r=>r.arrayBuffer()).then(x=>c.decodeAudioData(x));await c.close();return b.duration>4;});check('rider down effect + voice clip decodes',decoded);
await rider.click('#btnMechanical');await esc.waitForSelector('.incident.mechanical');check('both warnings remain independently active',await esc.locator('.incident').count()===2);check('rider down takes audio priority without overlapping mechanical voice',await esc.evaluate(()=>UL.fx.alarmKind==='riderDown'));
await rider.click('#btnMechanical');await sleep(400);check('double tap does not create duplicate warning',await esc.locator('.incident.mechanical').count()===1);
// Save visual state as a static HTML snapshot for the required capture helper.
async function snapshot(p,name){const html=await p.evaluate(()=>{const d=document.documentElement.cloneNode(true);d.querySelectorAll('script').forEach(x=>x.remove());const base=document.createElement('base');base.href=location.href;d.querySelector('head').prepend(base);return '<!doctype html>'+d.outerHTML;});fs.writeFileSync(path.join(QA,name+'.html'),html);await p.screenshot({path:path.join(QA,name+'-live.png')});}
await sleep(1500);await snapshot(rider,'rider-alerts');
await rider.setViewportSize({width:390,height:640});await sleep(200);
check('assistance and PTT buttons fit a short phone screen',await rider.evaluate(()=>document.getElementById('ptt').getBoundingClientRect().bottom<=innerHeight));
await snapshot(rider,'rider-alerts-small');await rider.setViewportSize({width:390,height:844});
await snapshot(esc,'escort-alerts');
await esc.locator('.incident.riderDown [data-ack]').click();await esc.waitForSelector('.incident.riderDown',{state:'detached'});check('widget master alert dismisses rider down',await esc.locator('.incident.riderDown').count()===0);check('remaining mechanical warning takes over audio',await esc.evaluate(()=>UL.fx.alarmKind==='mechanical'));
check('rider sees escort acknowledgement',/ACKNOWLEDGED BY/.test(await rider.textContent('#riderAlertStatus')));
check('mechanical clip decodes',await esc.evaluate(async()=>{const c=new AudioContext();const b=await fetch('mechanical-alert.mp3').then(r=>r.arrayBuffer()).then(x=>c.decodeAudioData(x));await c.close();return b.duration>3;}));
await snapshot(esc,'escort-mechanical');
// Second escort sees the outstanding warning after joining.
const esc2=watch(await (await mk({width:1366,height:768})).newPage());await esc2.goto(BASE+'escort.html?noboot=1');await esc2.evaluate(()=>{localStorage.ulPlanHelp=1;});await esc2.reload();await esc2.click('#pJoin');await esc2.fill('#jcode',code);await esc2.fill('#jcall','RESCUE-2');await esc2.click('#jgo');await esc2.waitForSelector('#shell',{state:'visible'});await esc2.waitForSelector('.incident.mechanical');check('late joining escort receives active warning with last known GPS',await esc2.evaluate(()=>__ul.incidents.size===1&&[...__ul.incidents.values()][0].data.lat!=null));
await esc.keyboard.press('m');await esc.waitForSelector('.incident',{state:'detached'});await esc2.waitForSelector('.incident',{state:'detached'});check('M master acknowledgement synchronizes every escort',await esc2.evaluate(()=>!UL.fx.alarmOn));
// Offline click is visibly pending; reconnection delivers it once.
await rider.context().setOffline(true);await rider.evaluate(()=>__rider.voice.link.ws.close());await sleep(500);await rider.click('#btnRiderDown');check('offline alert is not falsely labelled delivered',/NOT SENT/.test(await rider.textContent('#riderAlertStatus')));await rider.context().setOffline(false);await esc.waitForSelector('.incident.riderDown',{timeout:15000});await sleep(700);check('pending alert delivered on reconnection exactly once',await esc.locator('.incident.riderDown').count()===1);
// Rider cannot clear warnings. A separate mission cannot receive or clear them.
const rogue=client();await rogue.ready();let joined=rogue.wait('joined');rogue.send({t:'join',code,role:'rider',callsign:'ROGUE'});await joined;const event=await esc.evaluate(()=>[...__ul.incidents.keys()][0]);rogue.send({t:'rider.alert.ack',eventIds:[event]});await sleep(400);check('riders cannot acknowledge escort warning',await esc.locator('.incident.riderDown').count()===1);
const other=client();await other.ready();let created=other.wait('mission.created');other.send({t:'mission.create',name:'OTHER MISSION'});const otherCode=(await created).mission.code;joined=other.wait('joined');other.send({t:'join',code:otherCode,role:'escort',callsign:'OTHER'});await joined;other.send({t:'rider.alert.ack',eventIds:[event]});await sleep(400);check('acknowledgements are mission-scoped',await esc.locator('.incident.riderDown').count()===1);
// Disconnect rider: alert and last fix must stay visible.
await rider.context().setOffline(true);await rider.evaluate(()=>__rider.voice.link.ws.close());await sleep(600);check('rider link loss does not discard emergency',await esc.locator('.incident.riderDown').count()===1&&/RIDER LINK LOST/.test(await esc.textContent('.incident.riderDown')));
await esc.setViewportSize({width:390,height:844});await sleep(600);await snapshot(esc,'escort-alerts-mobile');check('mobile widget has no horizontal overflow',await esc.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.incident').getBoundingClientRect().width<innerWidth));
await esc.evaluate(()=>__ul.masterAck());await sleep(600);check('master silences confirmed incident',await esc.evaluate(()=>!UL.fx.alarmOn&&__ul.incidents.size===0));
// Missing GPS on a valid manually raised alert must not invent a position or distance.
const noGps=client();await noGps.ready();joined=noGps.wait('joined');noGps.send({t:'join',code,role:'rider',callsign:'NO-GPS'});await joined;noGps.send({t:'rider.alert',kind:'mechanical',eventId:crypto.randomUUID(),data:{lat:999,lon:0}});await esc.waitForSelector('.incident.mechanical');check('missing or invalid rider GPS shown honestly',/POSITION UNAVAILABLE/.test(await esc.textContent('.incident.mechanical'))&&/DISTANCE UNAVAILABLE/.test(await esc.textContent('.incident.mechanical')));
const pendingId=await esc.evaluate(()=>[...__ul.incidents.keys()][0]);noGps.send({t:'telemetry',data:{lat:-20.349,lon:57.553,ts:Date.now(),offRoute:0}});await sleep(700);check('GPS arriving after warning updates focus and distance',await esc.evaluate(()=>__map.getZoom()>=16&&[...__ul.incidents.values()][0].data.lat===-20.349));
const oldDistance = await esc.textContent('.incident-distance');
noGps.send({t:'telemetry',data:{lat:-20.36,lon:57.56,ts:Date.now(),offRoute:0}});await sleep(700);check('distance updates as rider moves', (await esc.textContent('.incident-distance')) !== oldDistance);
await esc.locator('[data-ack]').focus();await sleep(800);check('live widget updates preserve keyboard button focus',await esc.evaluate(()=>document.activeElement.hasAttribute('data-ack')));
await esc.evaluate(()=>__ul.masterAck());await sleep(500);
check('no browser JavaScript errors',errors.length===0);if(errors.length)console.log(errors);
rogue.ws.close();other.ws.close();noGps.ws.close();await browser.close();console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
