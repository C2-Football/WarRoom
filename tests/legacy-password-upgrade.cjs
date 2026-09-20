'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const load = require('./helpers/security-ts-loader.cjs');
const legacyHash = createHash('sha256').update('fixture-old-password').digest('hex');

(async () => {
  let stored = legacyHash, concurrent = false, signed = 0, updates = 0;
  const db = { from(table) { assert.equal(table,'users');const filters={};let write;return {
    select() { return this; },eq(key,value) { filters[key]=value;return this; },update(value) { write=value;return this; },
    async maybeSingle() {
      assert.equal(filters.sleeper_username,'fixture-user');
      if (!write) return { data:{ password_hash:stored,is_gifted:true } };
      updates++;
      if (filters.password_hash !== undefined && stored !== filters.password_hash) return { data:null };
      stored=write.password_hash;return { data:{sleeper_username:'fixture-user'} };
    },
    then(resolve,reject) { return this.maybeSingle().then(resolve,reject); },
  }; } };
  class JWT { constructor() {} setProtectedHeader() { return this; } async sign() { signed++;return 'fixture-token'; } }
  const handler = load(process.env.LEGACY_ENDPOINT_PATH || 'supabase/functions/get-session-token/index.ts', {
    createClient:()=>db,jose:{SignJWT:JWT},
    bcrypt:{hash:async()=>{if(concurrent)stored='newer-password-hash';return 'upgraded-old-password-hash';},compare:async()=>true},
    handleOptions:()=>null,clientIp:()=> 'fixture-ip',checkRateLimit:async()=>({allowed:true}),clearRateLimit:async()=>{},auditEvent:async()=>{},
    json:(_req,body,status=200)=>({body,status}),
  }).handler;
  const request=()=>handler({json:async()=>({username:'fixture-user',password:'fixture-old-password'})});
  const ok=await request();assert.equal(ok.status,200);assert.equal(ok.body.token,'fixture-token');assert.equal(stored,'upgraded-old-password-hash');assert.equal(updates,1);
  stored=legacyHash;concurrent=true;
  const stale=await request();assert.equal(stale.status,401);assert.match(stale.body.error,/account changed/);assert.equal(stored,'newer-password-hash');assert.equal(signed,1,'A stale upgrade cannot mint a token or overwrite the new password');
  console.log('PASS actual legacy sign-in upgrades the verified hash once and preserves a concurrent newer password without minting a stale token');
})().catch(error=>{console.error(error);process.exitCode=1;});
