'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('./account-deletion-recovery.cjs');
const app='fixture-app-id',customer='cus_checkout_owner';
const attempt={user_id:app,product_slug:'dhq',attempt_id:'fixture-durable-attempt',created_at:'2026-09-20T00:00:00Z',request:{customer},session_id:'cs_fixture_checkout',lease_token:null,lease_expires_at:null};
const session={id:'cs_fixture_checkout',customer,mode:'subscription',status:'open',metadata:{user_id:app,product_slug:'dhq',dhq_checkout_attempt:attempt.attempt_id}};
const response=(data,ok=true)=>({ok,status:ok?200:503,json:async()=>structuredClone(data)});
function setup(extra={}){
 const sessions=new Map((extra.sessions||[session]).map(s=>[s.id,structuredClone(s)]));
 const options={subscriptions:[],customerId:customer,checkoutAttempts:[structuredClone(attempt)],...extra};
 options.checkoutFetch=async(url,init,state)=>{
  const parsed=new URL(url),parts=parsed.pathname.split('/'),id=parts.at(-1)==='expire'?parts.at(-2):parts.at(-1);
  if(parts.at(-1)==='sessions'){
   if(options.listFailure)return response({},false);
   const values=[...sessions.values()];
   if(options.morePage&&!parsed.searchParams.has('starting_after'))return response({data:values.slice(0,1),has_more:true});
   return response({data:options.morePage?values.slice(1):values,has_more:false});
  }
  if(!sessions.has(id))return response({},false);
  const value=sessions.get(id);
  if(init.method==='POST'){
   if(options.expireFailure||options.expireFailureId===id)return response({},false);
   if(options.completeRace){value.status='complete';value.subscription='sub_checkout_race';return response({},false);}
   value.status='expired';
   if(options.lostExpireAck)throw Error('controlled provider acknowledgement lost');
  }
  return response(value);
 };
 return {sessions,options,x:fixture(extra.slug||'fw-delete-account',options)};
}
const tests={
 async expiresBeforeIdentityDeletion(){const {x}=setup();const r=await x.call();assert.equal(r.status,200);assert.equal(r.body.expiredCheckoutSessions,1);assert.equal(x.state.fetches.filter(f=>f.method==='POST').length,1);assert.equal(x.state.sequence.at(-1),'app');assert(x.state.sequence.indexOf('stripe')<x.state.sequence.indexOf('auth'));},
 async sourceSchemaRequired(){const {x}=setup({omitCheckoutInventory:true});assert.equal((await x.call()).status,503);assert.equal(x.state.authDeletes.length,0);assert(x.state.app);},
 async activeLeaseStopsAllWrites(){const {x}=setup({checkoutAttempts:[{...attempt,lease_token:'fixture-lease',lease_expires_at:new Date(Date.now()+60000).toISOString()}]});assert.equal((await x.call()).status,409);assert.equal(x.state.fetches.length,0);assert.equal(x.state.authDeletes.length,0);assert(x.state.app);},
 async unacknowledgedCreateRecoveredReadOnly(){const {x}=setup({checkoutAttempts:[{...attempt,session_id:null}]});assert.equal((await x.call()).status,200);assert(x.state.fetches.filter(f=>f.method==='POST').every(f=>f.url.endsWith('/expire')),'deletion never recreates or replays a checkout create');},
 async unknownAttemptRetainsApp(){const {x}=setup({sessions:[],checkoutAttempts:[{...attempt,session_id:null}]});const r=await x.call();assert.equal(r.status,503);assert.match(r.body.error,/could not be located safely/);assert.equal(x.state.authDeletes.length,0);assert(x.state.app);},
 async duplicateAttemptRetainsApp(){const {x}=setup({sessions:[session,{...session,id:'cs_duplicate'}]});assert.equal((await x.call()).status,503);assert.equal(x.state.fetches.filter(f=>f.method==='POST').length,0);assert(x.state.app);},
 async completeRaceCancelsUnpersistedSubscription(){const {x}=setup({completeRace:true});const r=await x.call();assert.equal(r.status,200);assert.equal(r.body.canceledStripeSubscriptions,1);assert(x.state.fetches.some(f=>f.method==='DELETE'&&f.url.endsWith('/sub_checkout_race')));},
 async completedSubscriptionOwnershipMismatch(){const {x}=setup({sessions:[{...session,status:'complete',subscription:'sub_checkout_complete'}],stripeResponseExtra:{customer:'cus_other'}});assert.equal((await x.call()).status,503);assert.equal(x.state.fetches.filter(f=>f.method==='DELETE').length,0);assert.equal(x.state.authDeletes.length,0);},
 async paginationAlsoRetiresLegacyLinks(){const {x}=setup({sessions:[session,{id:'cs_legacy',customer,mode:'subscription',status:'open',metadata:{}}],morePage:true});const r=await x.call();assert.equal(r.status,200);assert.equal(r.body.expiredCheckoutSessions,2);assert(x.state.fetches.some(f=>f.url.includes('starting_after=')));},
 async failureAndPartialRetryRetainTruth(){const state=setup({expireFailure:true});let r=await state.x.call();assert.equal(r.status,503);assert.equal(r.body.billingMayHaveChanged,true);assert.equal(state.x.state.authDeletes.length,0);assert(state.x.state.app);state.options.expireFailure=false;r=await state.x.call();assert.equal(r.status,200);},
 async partialExpirationPreservesConfirmedCount(){const state=setup({sessions:[session,{...session,id:'cs_second',metadata:{user_id:app}}],expireFailureId:'cs_second'});const r=await state.x.call();assert.equal(r.status,503);assert.equal(r.body.expiredCheckoutSessions,1);assert.equal(r.body.billingMayHaveChanged,true);assert.equal(state.x.state.authDeletes.length,0);assert(state.x.state.app);},
 async completedWithoutSubscriptionKeepsRecovery(){const {x}=setup({sessions:[{...session,status:'complete',subscription:null}]});const r=await x.call();assert.equal(r.status,503);assert.equal(x.state.authDeletes.length,0);assert(x.state.app);},
 async lostExpireAckVerifiedByRead(){const {x}=setup({lostExpireAck:true});assert.equal((await x.call()).status,200);assert.equal(x.state.fetches.filter(f=>f.method==='POST').length,1);},
 async competingAttemptStopsBeforeExpire(){const state=setup({onFetch:async(_state,method)=>{if(method==='GET')state.options.checkoutAttempts[0].session_id='cs_competing';}});assert.equal((await state.x.call()).status,409);assert.equal(state.x.state.fetches.filter(f=>f.method==='POST').length,0);assert(state.x.state.app);},
 async providerOwnershipMismatchAndRecoveryLinks(){for(const other of [{...session,metadata:{...session.metadata,user_id:'other-account'}},{...session,after_expiration:{recovery:{enabled:true}}}]){const {x}=setup({sessions:[other]});assert.equal((await x.call()).status,503);assert.equal(x.state.fetches.filter(f=>f.method==='POST').length,0);assert.equal(x.state.authDeletes.length,0);}},
 async missingSecretOrProviderReadStopsDelete(){for(const extra of [{noStripeSecret:true},{listFailure:true}]){const {x}=setup(extra);assert.equal((await x.call()).status,503);assert.equal(x.state.authDeletes.length,0);assert(x.state.app);}},
 async administratorMustConfirmNewlyDiscoveredBilling(){const {x}=setup({slug:'admin-delete-user'});assert.equal((await x.call({email:'delete-fixture@example.invalid'})).status,409);assert.equal(x.state.fetches.filter(f=>f.method==='POST').length,0);assert(x.state.app);assert.equal((await x.call()).status,200);},
};
(async()=>{let failed=0;for(const [name,test]of Object.entries(tests)){try{await test();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.stack);}}if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
