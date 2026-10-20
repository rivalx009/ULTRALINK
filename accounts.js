/* ULTRALINK accounts: durable PostgreSQL accounts, profiles and sessions. */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {promisify}=require('util');const scrypt=promisify(crypto.scrypt);
module.exports=function accounts(){
  const store=require('./postgres-store')();
  const cache=new Map();let hashing=0;
  const dir=process.env.UL_DATA_DIR||path.join(__dirname,'data'); // live mission snapshots only; NOT account storage
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  store.init().catch(store.logError);
  const normalize=v=>String(v||'').trim().toUpperCase();
  const validCall=c=>/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(c);
  const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
  const token=req=>{const m=String(req.headers.cookie||'').match(/(?:^|;\s*)ul_session=([a-f0-9]{64})(?:;|$)/);return m?m[1]:'';};
  // Cached sessions are used only by established WebSockets. HTTP and upgrades always query PostgreSQL.
  function session(req){const s=cache.get(digest(token(req)));return s&&s.expires>Date.now()?s:null;}
  async function authenticate(req){
    const t=token(req);if(!t)return null;
    const key=digest(t),s=await store.getSession(key);
    if(s){if(cache.size>=10000){for(const[k,v]of cache)if(v.expires<=Date.now())cache.delete(k);if(cache.size>=10000)cache.delete(cache.keys().next().value);}cache.set(key,s);}else cache.delete(key);
    return s;
  }
  function safe(u){return{callsign:u.callsign,riderName:u.riderName||'',weightKg:u.weightKg||null};}
  function send(res,status,value,extra={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(value));}
  function fail(status,message){const e=new Error(message);e.status=status;throw e;}
  async function body(req){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>16*1024*1024)fail(413,'Request too large (16 MB limit).');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail(400,'Invalid JSON.');}}
  function originOK(req){const o=req.headers.origin;if(!o)return false;try{const u=new URL(o);return u.host===req.headers.host&&['http:','https:'].includes(u.protocol);}catch{return false;}}
  function secure(req){return !!req.socket.encrypted||(process.env.RENDER&&req.headers['x-forwarded-proto']==='https');}
  function cookie(req,value,age){return `ul_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure(req)?'; Secure':''}`;}
  const limits=new Map();function limited(key,max,window=600000){const now=Date.now();if(limits.size>5000)for(const[k,v]of limits)if(v.until<now)limits.delete(k);
    let v=limits.get(key);if(!v||v.until<now){v={n:0,until:now+window};limits.set(key,v);}if(++v.n>max)fail(429,'Too many attempts. Wait ten minutes before retrying.');}
  async function hash(password,salt){if(hashing>=4)fail(503,'Sign-in service busy. Try again shortly.');hashing++;try{return await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});}finally{hashing--;}}
  function rider(b,required){if(!required&&!b.riderName&&!b.weightKg)return{riderName:'',weightKg:null};
    const riderName=String(b.riderName||'').trim(),weightKg=Number(b.weightKg);
    if(!riderName||riderName.length>80||!Number.isFinite(weightKg)||weightKg<10||weightKg>350)fail(400,'Rider name and weight between 10 and 350 kg are required.');
    return{riderName,weightKg};}
  async function route(req,res){
    const u=new URL(req.url,'http://local');if(!u.pathname.startsWith('/api/account'))return false;
    try{
      if(!store.configured)fail(503,'Account storage is not configured. Set DATABASE_URL on the server.');
      await store.init();
      const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      if(!secure(req)&&!loopback)fail(426,'HTTPS is required for accounts. Open ULTRALINK using its HTTPS address.');
      const endpoint=u.pathname.slice('/api/account'.length),method=req.method;
      if(!['GET','POST','PUT'].includes(method))fail(405,'Method not allowed.');
      if(method!=='GET'&&!originOK(req))fail(403,'Request origin rejected. Reload ULTRALINK on its own server address.');
      const ip=process.env.RENDER?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0]:req.socket.remoteAddress;
      if(endpoint==='/exists'&&method==='GET'){
        limited('lookup:'+ip,120);const callsign=normalize(u.searchParams.get('callsign'));if(!validCall(callsign))fail(400,'Use 3–24 letters, numbers, hyphens or underscores.');
        send(res,200,{exists:!!(await store.getUser(callsign))});return true;
      }
      if((endpoint==='/signup'||endpoint==='/signin')&&method==='POST'){
        limited('auth:'+ip,30);const b=await body(req),callsign=normalize(b.callsign),password=b.password;
        if(!validCall(callsign)||typeof password!=='string'||password.length<12||password.length>128)fail(400,'Use a valid callsign and a password of 12–128 characters.');
        limited('call:'+callsign,15);let user=await store.getUser(callsign);const signup=endpoint==='/signup';
        if(signup){if(user)fail(409,'Callsign already exists. Choose SIGN IN.');const details=rider(b,b.mode==='rider');
          const salt=crypto.randomBytes(16).toString('hex'),passwordHash=(await hash(password,salt)).toString('hex');
          user={callsign,salt,passwordHash,...details,profiles:[],version:0,createdAt:Date.now()};
        }else{const salt=user?.salt||'00000000000000000000000000000000',actual=await hash(password,salt);
          if(!user||!crypto.timingSafeEqual(actual,Buffer.from(user.passwordHash,'hex')))fail(401,'Callsign or password is incorrect.');}
        const t=crypto.randomBytes(32).toString('hex'),key=digest(t),expires=Date.now()+30*86400000;
        try{await store.login(user,signup,key,expires);}catch(e){if(e.code==='23505'&&signup)fail(409,'Callsign already exists. Choose SIGN IN.');throw e;}
        send(res,200,{user:safe(user)},{'Set-Cookie':cookie(req,t,30*86400)});return true;
      }
      const s=await authenticate(req);if(!s)fail(401,'Sign in to continue.');
      if(endpoint==='/me'&&method==='GET'){const user=await store.getUser(s.callsign);send(res,200,{user:safe(user),profiles:user.profiles,version:user.version});return true;}
      if(endpoint==='/rider'&&method==='PUT'){const b=await body(req),details=rider(b,true);const updated=await store.updateRider(s.callsign,details);for(const v of cache.values())if(v.callsign===s.callsign)v.user=updated;send(res,200,{user:safe(updated)});return true;}
      if(endpoint==='/profiles'&&method==='PUT'){
        const b=await body(req);if(!Array.isArray(b.profiles)||b.profiles.length>100||!Number.isInteger(b.version))fail(400,'Invalid profile collection (maximum 100 profiles).');
        if(b.profiles.some(p=>!p||typeof p!=='object'||typeof p.id!=='string'||p.id.length>100))fail(400,'Each profile must have an ID.');
        const version=await store.profiles(s.callsign,b.version,b.profiles);
        if(version===undefined)fail(409,'Profiles changed on another device. Export your local copy, then reload the account copy.');
        send(res,200,{version});return true;
      }
      if(endpoint==='/signout'&&method==='POST'){await store.logout(s.key);cache.delete(s.key);send(res,200,{ok:true},{'Set-Cookie':cookie(req,'',0)});return true;}
      fail(404,'Account endpoint not found.');
    }catch(e){if(!e.status)store.logError(e);send(res,e.status||503,{error:e.status?e.message:'Account storage is temporarily unavailable. Changes were not confirmed; reconnect and check the account copy before retrying.'});}
    return true;
  }
  return{route,session,authenticate,get available(){return store.ready;},dataDir:dir};
};
