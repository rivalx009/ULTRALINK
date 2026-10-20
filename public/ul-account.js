/* ULTRALINK v1.12 account gate and account-scoped race profile synchronization. */
(function(){
'use strict';const A=UL.Account={user:null,version:0,error:'',conflict:false},$=s=>document.querySelector(s);
const modeFiles={escort:'escort.html',rider:'rider.html',comms:'comms.html'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,method='GET',data){const r=await fetch('/api/account'+path,{method,credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});let j;try{j=await r.json();}catch{throw Error('Account server did not return JSON. Check the deployment.');}if(!r.ok){const e=Error(j.error||'Account request failed.');e.status=r.status;throw e;}return j;}
A.api=api;A.key=()=> 'ulProfiles:account:'+A.user.callsign;A.dirtyKey=()=>A.key()+':dirty';
A.read=()=>{try{return JSON.parse(localStorage[A.key()]||'[]');}catch{return[];}};
A.ready=api('/me').then(j=>{A.user=j.user;A.version=j.version;
  if(localStorage[A.dirtyKey()]!=='1'){localStorage[A.key()]=JSON.stringify(j.profiles);localStorage[A.key()+':version']=j.version;}
  else {A.version=Number(localStorage[A.key()+':version']||0);A.error='UNSYNCED LOCAL CHANGES — RETRY SYNC';}
  return A.user;
}).catch(e=>{A.error=e.message;return null;});
let timer=null,saving=false,rerun=false;
function status(text,bad=false){document.querySelectorAll('[data-account-sync]').forEach(el=>{el.textContent=text;el.style.color=bad?'var(--bad)':'var(--good)';});}
A.save=profiles=>{localStorage[A.key()]=JSON.stringify(profiles);localStorage[A.dirtyKey()]='1';status('LOCAL CHANGES · WAITING TO SYNC');clearTimeout(timer);timer=setTimeout(()=>A.flush(),600);};
A.flush=async()=>{clearTimeout(timer);if(!A.user||localStorage[A.dirtyKey()]!=='1')return true;if(saving){rerun=true;return false;}if(A.conflict){status('SYNC CONFLICT · OPEN ACCOUNT',true);return false;}
  saving=true;const snapshot=localStorage[A.key()]||'[]';status('SYNCING ACCOUNT…');
  try{const j=await api('/profiles','PUT',{version:A.version,profiles:JSON.parse(snapshot)});A.version=j.version;localStorage[A.key()+':version']=j.version;
    if(localStorage[A.key()]===snapshot)localStorage[A.dirtyKey()]='0';else rerun=true;
    A.error='';status('ACCOUNT SYNCED');return true;
  }catch(e){A.error=e.message;A.conflict=e.status===409;status((A.conflict?'SYNC CONFLICT':'NOT SYNCED')+' · OPEN ACCOUNT',true);return false;}
  finally{saving=false;if(rerun&&!A.error){rerun=false;setTimeout(()=>A.flush(),0);}}
};
addEventListener('online',()=>A.flush());addEventListener('beforeunload',e=>{if(A.user&&localStorage[A.dirtyKey()]==='1'){e.preventDefault();e.returnValue='Unsynced profiles remain on this device.';}});
addEventListener('storage',e=>{if(A.user&&e.key===A.key()){A.conflict=true;A.error='Profiles changed in another tab. Export this copy, then reload the account copy.';status('ANOTHER TAB CHANGED PROFILES · OPEN ACCOUNT',true);}});
function exportLocal(){const b=new Blob([JSON.stringify(A.read(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='ultralink-'+A.user.callsign+'-profiles.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
A.open=async()=>{await A.ready;if(!A.user)return location.assign('/?mode='+currentMode());
  const dlg=document.createElement('dialog');dlg.className='account-dialog';dlg.innerHTML=`<div class="account-content"><h2>ACCOUNT · ${escape(A.user.callsign)}</h2><p data-account-sync></p><p id="acDetail" class="account-note"></p><label>RIDER NAME<input id="acName" maxlength="80" autocomplete="name" value="${escape(A.user.riderName)}"></label><label>WEIGHT (KG)<input id="acWeight" type="number" min="10" max="350" step="0.1" value="${A.user.weightKg||''}"></label><div class="account-actions"><button id="acSave">SAVE RIDER DETAILS</button><button id="acRetry">RETRY SYNC</button><button id="acExport">EXPORT LOCAL PROFILES</button><button id="acReload">RELOAD ACCOUNT COPY</button><button id="acOut" class="danger">SIGN OUT</button><button id="acClose">CLOSE</button></div><p id="acErr" role="status"></p></div>`;
  document.body.append(dlg);dlg.showModal();dlg.querySelector('#acDetail').textContent=A.error||'Race and training profiles sync to this account. Microphone selection and hardware PTT bindings stay device-local.';
  status(localStorage[A.dirtyKey()]==='1'?'LOCAL CHANGES NOT SYNCED':'ACCOUNT SYNCED',localStorage[A.dirtyKey()]==='1');
  const err=t=>dlg.querySelector('#acErr').textContent=t;
  dlg.querySelector('#acClose').onclick=()=>dlg.close();dlg.addEventListener('close',()=>dlg.remove());
  dlg.querySelector('#acSave').onclick=async()=>{try{const j=await api('/rider','PUT',{riderName:dlg.querySelector('#acName').value,weightKg:Number(dlg.querySelector('#acWeight').value)});A.user=j.user;err('Rider details saved. Rejoin a mission to update its roster.');}catch(e){err(e.message);}};
  dlg.querySelector('#acRetry').onclick=async()=>{await A.flush();err(A.error||'Account synced.');};
  dlg.querySelector('#acExport').onclick=exportLocal;
  dlg.querySelector('#acReload').onclick=async()=>{if(localStorage[A.dirtyKey()]==='1'&&!confirm('Discard unsynced local edits and load the account copy? Export your local profiles first if needed.'))return;try{const j=await api('/me');localStorage[A.key()]=JSON.stringify(j.profiles);localStorage[A.dirtyKey()]='0';localStorage[A.key()+':version']=j.version;location.reload();}catch(e){err(e.message);}};
  dlg.querySelector('#acOut').onclick=async()=>{if(localStorage[A.dirtyKey()]==='1'){await A.flush();if(localStorage[A.dirtyKey()]==='1'){err('Sign-out paused: export or sync your unsaved profiles first.');return;}}
    try{await api('/signout','POST',{});location.assign('/');}catch(e){err(e.message);}};
};
function currentMode(){return location.pathname.includes('escort')?'escort':location.pathname.includes('rider')?'rider':'comms';}
A.mount=()=>{if($('#accountBar'))return;
  function make(id){const bar=document.createElement('div');bar.id=id;bar.className='account-strip';bar.innerHTML='<button type="button" data-account-open></button><span data-account-sync></span>';bar.querySelector('button').textContent=A.user.callsign+' · ACCOUNT';bar.querySelector('button').onclick=A.open;return bar;}
  const bar=make('accountBar');
  if($('#profPanel')){$('#profPanel').append(bar);const ops=make('accountOpsBar');$('#top').insertAdjacentElement('afterend',ops);}
  else document.body.prepend(bar);
  status(A.error?'NOT SYNCED · OPEN ACCOUNT':'ACCOUNT SYNCED',!!A.error);
};
A.launch=async(mode,scripts)=>{const user=await A.ready;if(!user)return location.replace('/?mode='+mode);if(mode==='rider'&&(!user.riderName||!user.weightKg))return location.replace('/?mode=rider');
  localStorage.ulCallsign=user.callsign;localStorage.ulEscortCall=user.callsign;
  A.mount();for(const src of scripts){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Cannot load '+src));document.body.append(script);});}
  if(localStorage[A.dirtyKey()]==='1')A.flush();
};
A.choose=async mode=>{
  const dlg=document.createElement('dialog');dlg.className='account-dialog';dlg.innerHTML=`<form class="account-content" id="accountForm"><div class="account-kicker">${escape(mode.toUpperCase())} MODE</div><h2>ACCOUNT ACCESS</h2><p class="account-note">Use the same callsign and password on another device to retrieve your saved profiles.</p><label for="accountCall">CALLSIGN</label><input id="accountCall" name="username" autocomplete="username" autocapitalize="characters" spellcheck="false" minlength="3" maxlength="24" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,23}"><p class="account-note">3–24 letters, numbers, hyphens or underscores. Callsigns are not case-sensitive.</p><label for="accountPassword">PASSWORD</label><input id="accountPassword" type="password" autocomplete="current-password" minlength="12" maxlength="128" required><p class="account-note">12–128 characters. Passwords are case-sensitive. Keep it safe: password recovery is not included in this release.</p><div id="accountRider" ${mode==='rider'?'':'hidden'}><label for="accountRiderName">RIDER NAME</label><input id="accountRiderName" maxlength="80" autocomplete="name"><label for="accountWeight">WEIGHT (KG)</label><input id="accountWeight" type="number" min="10" max="350" step="0.1"><p class="account-note">Required when first using Rider Mode. These details are saved to your account and included in the mission roster.</p></div><p id="accountMessage" role="status" aria-live="polite">Enter a callsign to check for an account.</p><div class="account-actions"><button class="primary" id="accountSubmit" disabled>CHECKING ACCOUNT</button><button type="button" id="accountCancel">CANCEL</button></div><button type="button" id="accountContinue" hidden></button></form>`;
  document.body.append(dlg);dlg.showModal();let exists=null,seq=0,lookupTimer,busy=false,detailsOnly=false;
  const el=id=>dlg.querySelector('#'+id),message=t=>el('accountMessage').textContent=t;
  el('accountCancel').onclick=()=>dlg.close();dlg.addEventListener('close',()=>{clearTimeout(lookupTimer);seq++;dlg.remove();});
  async function go(){if(mode==='rider'&&(!A.user.riderName||!A.user.weightKg)){detailsOnly=true;el('accountContinue').hidden=true;el('accountPassword').hidden=true;dlg.querySelector('label[for=accountPassword]').hidden=true;el('accountPassword').nextElementSibling.hidden=true;el('accountCall').value=A.user.callsign;el('accountCall').disabled=true;el('accountPassword').required=false;el('accountPassword').disabled=true;el('accountRiderName').value=A.user.riderName;el('accountWeight').value=A.user.weightKg||'';el('accountRiderName').required=el('accountWeight').required=true;el('accountSubmit').disabled=false;el('accountSubmit').textContent='SAVE & CONTINUE';message('Complete your rider name and weight to continue.');return;}location.assign(modeFiles[mode]);}
  await A.ready;if(!dlg.isConnected)return;
  if(A.user){const b=el('accountContinue');b.hidden=false;b.textContent='CONTINUE AS '+A.user.callsign;b.onclick=go;el('accountCall').value=A.user.callsign;}
  async function lookup(){const my=++seq,c=el('accountCall').value.trim().toUpperCase();exists=null;el('accountSubmit').disabled=true;
    if(!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(c)){message('Enter a valid callsign.');return;}
    message('Checking callsign…');try{const j=await api('/exists?callsign='+encodeURIComponent(c));if(my!==seq||!dlg.isConnected)return;exists=j.exists;el('accountSubmit').disabled=false;el('accountSubmit').textContent=exists?'SIGN IN':'SIGN UP';el('accountPassword').autocomplete=exists?'current-password':'new-password';el('accountRiderName').required=el('accountWeight').required=mode==='rider'&&!exists;message(exists?'Existing account — enter its password.':'New callsign — SIGN UP creates your account.');}catch(e){if(my===seq)message(e.message);}}
  el('accountCall').oninput=()=>{seq++;clearTimeout(lookupTimer);exists=null;el('accountSubmit').disabled=true;lookupTimer=setTimeout(lookup,350);};if(el('accountCall').value)lookup();
  el('accountForm').onsubmit=async e=>{e.preventDefault();if(busy||(!detailsOnly&&exists===null))return;busy=true;el('accountSubmit').disabled=true;
    try{if(detailsOnly){const j=await api('/rider','PUT',{riderName:el('accountRiderName').value,weightKg:Number(el('accountWeight').value)});A.user=j.user;await go();}
      else{if(A.user&&localStorage[A.dirtyKey()]==='1'){message('Unsynced profiles exist for the current account. Continue as that account and sync or export them first.');return;}
        const j=await api(exists?'/signin':'/signup','POST',{callsign:el('accountCall').value,password:el('accountPassword').value,mode,riderName:mode==='rider'?el('accountRiderName').value:'',weightKg:mode==='rider'?Number(el('accountWeight').value):null});A.user=j.user;el('accountPassword').value='';await go();}}
    catch(e){message(e.message);if(e.status===409)lookup();}finally{busy=false;el('accountSubmit').disabled=false;}
  };
};
if(location.pathname==='/'||location.pathname.endsWith('/index.html')){
  document.querySelectorAll('a[href="escort.html"],a[href="rider.html"],a[href="comms.html"]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();A.choose(a.getAttribute('href').split('.')[0]);}));
  const mode=new URLSearchParams(location.search).get('mode');if(modeFiles[mode]){const show=()=>A.choose(mode);if(document.getElementById('boot')){const t=setInterval(()=>{if(!document.getElementById('boot')){clearInterval(t);show();}},100);}else show();}
}
})();
