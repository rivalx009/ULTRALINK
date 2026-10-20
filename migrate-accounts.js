/* OPTIONAL v1.12.0 disk -> PostgreSQL migration. Run privately, not in the browser. */
'use strict';
const fs=require('fs');
(async()=>{
  if(!process.env.DATABASE_URL||!process.argv[2])throw Error('Set DATABASE_URL privately, then run: node migrate-accounts.js PATH_TO_OLD_accounts.json');
  const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  if(!source.users||typeof source.users!=='object'||Array.isArray(source.users))throw Error('Invalid legacy account file.');
  const users=Object.values(source.users);
  for(const u of users){
    if(!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(u.callsign)||!/^[a-f0-9]{32}$/.test(u.salt)||!/^[a-f0-9]{128}$/.test(u.passwordHash)||!Array.isArray(u.profiles)||!Number.isInteger(u.version)||u.version<0||!Number.isFinite(u.createdAt))throw Error('Legacy account validation failed; no accounts imported.');
  }
  const store=require('./postgres-store')();
  try{await store.importUsers(users);console.log(`Imported ${users.length} account(s). Existing callsigns were NOT overwritten. Sign in again; old sessions were not imported.`);}
  catch(e){if(e.code==='23505')throw Error('A callsign already exists in PostgreSQL. Entire import rolled back; nothing overwritten.');throw Error('Import failed; transaction rolled back. Check database access privately.');}
  finally{await store.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
