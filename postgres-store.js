/* Server-only PostgreSQL account storage. Never copy credentials into public/. */
'use strict';
const {Pool}=require('pg');
module.exports=function postgresStore(){
  const uri=process.env.DATABASE_URL;
  let ready=false,initializing=null;
  let config;
  if(uri){
    let u;try{u=new URL(uri);}catch{throw Error('DATABASE_URL is not a valid PostgreSQL URI.');}
    if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('DATABASE_URL must be a PostgreSQL URI.');
    const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
    // Verify the server certificate even when a copied URL says sslmode=require.
    // Preserve other URL options, and retain SCRAM channel binding when requested.
    const binding=u.searchParams.get('channel_binding');
    for(const k of ['sslmode','sslcert','sslkey','sslrootcert','channel_binding'])u.searchParams.delete(k);
    config={connectionString:u.toString(),ssl:local?false:{rejectUnauthorized:true},enableChannelBinding:binding==='require',max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:15000,statement_timeout:20000,query_timeout:22000,application_name:'ultralink-v1.12.3'};
  }
  const pool=config?new Pool(config):null;
  const logError=e=>console.error('POSTGRES ACCOUNT STORAGE ERROR', /^[A-Z0-9_]{1,40}$/.test(e?.code||'')?e.code:'CONNECTION_OR_QUERY_FAILED');
  if(pool)pool.on('error',logError);
  async function init(){
    if(ready)return;
    if(!pool)throw Error('DATABASE_URL is not configured.');
    if(initializing)return initializing;
    initializing=(async()=>{
      const c=await pool.connect();
      try{
        await c.query('BEGIN');
        // Transaction-scoped lock makes simultaneous first starts safe, including pooled Neon connections.
        await c.query('SELECT pg_advisory_xact_lock(858722114)');
        await c.query(`CREATE TABLE IF NOT EXISTS ultralink_accounts (
          callsign text PRIMARY KEY, salt text NOT NULL, password_hash text NOT NULL,
          rider_name text NOT NULL DEFAULT '', weight_kg double precision,
          profiles jsonb NOT NULL DEFAULT '[]'::jsonb, version integer NOT NULL DEFAULT 0,
          created_at bigint NOT NULL,
          CHECK(jsonb_typeof(profiles)='array'), CHECK(version>=0)
        )`);
        await c.query(`CREATE TABLE IF NOT EXISTS ultralink_sessions (
          token_hash text PRIMARY KEY, callsign text NOT NULL REFERENCES ultralink_accounts(callsign) ON DELETE CASCADE,
          expires bigint NOT NULL
        )`);
        await c.query('CREATE INDEX IF NOT EXISTS ultralink_sessions_callsign_idx ON ultralink_sessions(callsign)');
        await c.query('CREATE INDEX IF NOT EXISTS ultralink_sessions_expires_idx ON ultralink_sessions(expires)');
        await c.query(`CREATE TABLE IF NOT EXISTS ultralink_live_state (
          id smallint PRIMARY KEY CHECK(id=1), snapshot jsonb NOT NULL,
          version bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL
        )`);
        await c.query('COMMIT');ready=true;
        console.log('POSTGRES ACCOUNT STORAGE READY (accounts + profiles + sessions)');
      }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
    })();
    try{await initializing;}finally{initializing=null;}
  }
  const user=r=>r?{callsign:r.callsign,salt:r.salt,passwordHash:r.password_hash,riderName:r.rider_name,weightKg:r.weight_kg,profiles:r.profiles,version:r.version,createdAt:Number(r.created_at)}:null;
  async function query(text,values){await init();return pool.query(text,values);}
  async function getUser(callsign){return user((await query('SELECT * FROM ultralink_accounts WHERE callsign=$1',[callsign])).rows[0]);}
  async function login(u,signup,key,expires){
    await init();const c=await pool.connect();
    try{
      await c.query('BEGIN');
      if(signup)await c.query('INSERT INTO ultralink_accounts(callsign,salt,password_hash,rider_name,weight_kg,profiles,version,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',[u.callsign,u.salt,u.passwordHash,u.riderName,u.weightKg,JSON.stringify(u.profiles),u.version,u.createdAt]);
      await c.query('SELECT callsign FROM ultralink_accounts WHERE callsign=$1 FOR UPDATE',[u.callsign]);
      await c.query('DELETE FROM ultralink_sessions WHERE expires<=$1',[Date.now()]);
      await c.query('DELETE FROM ultralink_sessions WHERE token_hash IN (SELECT token_hash FROM ultralink_sessions WHERE callsign=$1 ORDER BY expires DESC OFFSET 9)',[u.callsign]);
      await c.query('INSERT INTO ultralink_sessions(token_hash,callsign,expires) VALUES($1,$2,$3)',[key,u.callsign,expires]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  async function getSession(key){const r=(await query('SELECT a.callsign,a.rider_name,a.weight_kg,s.expires FROM ultralink_sessions s JOIN ultralink_accounts a USING(callsign) WHERE s.token_hash=$1 AND s.expires>$2',[key,Date.now()])).rows[0];return r?{key,callsign:r.callsign,expires:Number(r.expires),user:{callsign:r.callsign,riderName:r.rider_name,weightKg:r.weight_kg}}:null;}
  async function updateRider(callsign,d){return user((await query('UPDATE ultralink_accounts SET rider_name=$2,weight_kg=$3 WHERE callsign=$1 RETURNING *',[callsign,d.riderName,d.weightKg])).rows[0]);}
  async function profiles(callsign,version,items){const r=await query('UPDATE ultralink_accounts SET profiles=$3::jsonb,version=version+1 WHERE callsign=$1 AND version=$2 RETURNING version',[callsign,version,JSON.stringify(items)]);return r.rows[0]?.version;}
  async function logout(key){await query('DELETE FROM ultralink_sessions WHERE token_hash=$1',[key]);}
  async function importUsers(users){
    await init();const c=await pool.connect();
    try{await c.query('BEGIN');
      for(const u of users)await c.query('INSERT INTO ultralink_accounts(callsign,salt,password_hash,rider_name,weight_kg,profiles,version,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',[u.callsign,u.salt,u.passwordHash,u.riderName||'',u.weightKg||null,JSON.stringify(u.profiles),u.version,u.createdAt]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  async function loadLiveState(initial){
    await query('INSERT INTO ultralink_live_state(id,snapshot,version,updated_at) VALUES(1,$1::jsonb,0,$2) ON CONFLICT(id) DO NOTHING',[JSON.stringify(initial),Date.now()]);
    const r=(await query('SELECT snapshot,version FROM ultralink_live_state WHERE id=1')).rows[0];return{snapshot:r.snapshot,version:Number(r.version)};
  }
  async function saveLiveState(snapshot,version){
    const r=await query('UPDATE ultralink_live_state SET snapshot=$1::jsonb,version=version+1,updated_at=$2 WHERE id=1 AND version=$3 RETURNING version',[JSON.stringify(snapshot),Date.now(),version]);
    if(!r.rows.length){const e=Error('Live mission writer conflict');e.code='MISSION_WRITER_CONFLICT';throw e;}return Number(r.rows[0].version);
  }
  async function close(){if(pool)await pool.end();}
  return{loadLiveState,saveLiveState,init,getUser,login,getSession,updateRider,profiles,logout,importUsers,close,logError,get configured(){return !!pool;},get ready(){return ready;}};
};
