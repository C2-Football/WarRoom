'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const load=require('./helpers/security-ts-loader.cjs');
const helper=load('supabase/functions/_shared/billing-checkout.ts').context;
const db=new PGlite();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const request={customer:'cus_fixture',price:'price_monthly',billing:'monthly',price_products:{price_monthly:'dhq',price_annual:'dhq',price_other:'bundle'},success_url:'https://dhqfootball.com/upgrade.html?payment=success',cancel_url:'https://dhqfootball.com/upgrade.html?payment=cancel'};
let user,writeFailure=false,loseResponse=false,pauseCreate=null,createCalls=0,expireCalls=0;
let pauseList=null;
const sessions=new Map(),keys=new Map(),subscriptions=new Map();
const stripe={
  subscriptions:{list:async()=>({data:[...subscriptions.values()],has_more:false}),retrieve:async id=>subscriptions.get(id)},
  checkout:{sessions:{
    create:async(args,options)=>{
      createCalls++;
      let session=keys.get(options.idempotencyKey);
      if(!session){session={id:'cs_'+(sessions.size+1),...args,status:'open',url:'https://checkout.stripe.com/c/pay/fixture'+sessions.size};keys.set(options.idempotencyKey,structuredClone(session));sessions.set(session.id,session);}
      if(pauseCreate) await pauseCreate;
      if(loseResponse){loseResponse=false;throw Error('isolated response loss after provider creation');}
      return session;
    },
    retrieve:async id=>sessions.get(id),
    list:async args=>{if(pauseList){const pending=pauseList;pauseList=null;pending.started();await pending.promise;}return{data:[...sessions.values()].filter(s=>!args.status||s.status===args.status),has_more:false};},
    listLineItems:async id=>({data:sessions.get(id).line_items.map((item,i)=>({id:'li_'+i,price:{id:item.price}})),has_more:false}),
    expire:async id=>{expireCalls++;const s=sessions.get(id);if(s.status!=='open')throw Error('session no longer open');s.status='expired';return s;},
  }},
};
const admin={rpc:async(name,args)=>{
  try{
    if(name==='claim_billing_checkout')return{data:(await q('select claim_billing_checkout($1,$2,$3::jsonb) r',[args.p_user_id,args.p_product_slug,JSON.stringify(args.p_request)]))[0].r};
    if(name==='checkpoint_billing_checkout'){
      if(writeFailure)return{error:Error('isolated checkpoint rejection')};
      return{data:(await q('select checkpoint_billing_checkout($1,$2,$3,$4,$5::jsonb) r',[args.p_user_id,args.p_product_slug,args.p_lease_token,args.p_session_id,args.p_next_request?JSON.stringify(args.p_next_request):null]))[0].r};
    }
    assert.equal(name,'release_billing_checkout');
    await q('select release_billing_checkout($1,$2,$3)',[args.p_user_id,args.p_product_slug,args.p_lease_token]);return{data:null};
  }catch(error){return{error};}
}};
const checkout=(params=request)=>helper.recoverCheckout(admin,stripe,user,'dhq',params);
async function fresh(){
  user=(await q("insert into app_users(email,password_hash) values($1,'x') returning id",['billing-'+crypto.randomUUID()+'@example.invalid']))[0].id;
  sessions.clear();keys.clear();subscriptions.clear();createCalls=0;expireCalls=0;
}
(async()=>{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;");
  for(const name of ['20260317000000_app_users_and_subscriptions.sql','20260710000000_dhq_pro_billing.sql','20260724000000_gift_grants.sql','20260920010000_billing_event_recovery.sql','20260920050000_billing_checkout_recovery.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  await fresh();
  await assert.rejects(checkout(),/temporarily unavailable/);assert.equal(createCalls,0);
  const manifest=Object.fromEntries(['fw-stripe-webhook','fw-revenuecat-webhook','fw-create-checkout','_shared/billing-events.ts'].map(k=>[k,'a'.repeat(64)]));
  await assert.rejects(q('select stage_billing_event_cutover($1::jsonb)',[JSON.stringify(manifest)]),/manifest/,'new checkout helper must be included in verified writer hashes');
  manifest['_shared/billing-checkout.ts']='b'.repeat(64);
  await q('select stage_billing_event_cutover($1::jsonb)',[JSON.stringify(manifest)]);
  await assert.rejects(q('select activate_billing_event_processing()'),/drain/);
  await q("update billing_event_control set activate_after=clock_timestamp()-interval '1 second'");
  await q('select activate_billing_event_processing()');
  let release;pauseCreate=new Promise(r=>release=r);
  const first=checkout();
  while(!createCalls)await new Promise(r=>setTimeout(r,1));
  await assert.rejects(checkout(),/being prepared/);assert.equal(createCalls,1,'competing request must not create another session');
  release();await first;pauseCreate=null;
  const one=await checkout();assert.equal(createCalls,1);assert.equal(sessions.size,1);
  await db.exec(fs.readFileSync('supabase/migrations/20260920050000_billing_checkout_recovery.sql','utf8'));
  assert.equal((await checkout()).id,one.id,'migration replay preserves recoverable checkout');
  assert.equal(one.subscription_data.trial_period_days,7);assert.equal(one.line_items[0].price,'price_monthly');
  console.log('PASS actual helper + SQL: paused gate, competing requests, repeat clicks, reload/replay preserve one checkout and existing trial/price');

  await fresh();let resumeList,startedList;
  const listing=new Promise(r=>startedList=r);
  pauseList={promise:new Promise(r=>resumeList=r),started:startedList};
  const slowCheckout=checkout();await listing;
  // Simulate the point that let a second worker replace a 60-second lease.
  await q("update billing_checkout_attempts set lease_expires_at=lease_expires_at-interval '61 seconds' where user_id=$1",[user]);
  let competingError;
  try{await checkout({...request,billing:'annual',price:'price_annual'});}catch(error){competingError=error;}
  resumeList();await slowCheckout.catch(()=>{});
  assert.match(competingError?.message||'',/being prepared/,'an older live worker must not be replaced at 61 seconds and expire the newer worker checkout');
  assert.equal(sessions.size,1);assert.equal(expireCalls,0);
  console.log('PASS delayed live worker cannot lose its lease at 61 seconds, rotate competing plans, or expire another worker checkout');

  await fresh();
  sessions.set('legacy',{id:'legacy',customer:request.customer,mode:'subscription',status:'open',line_items:[{price:'price_monthly'}]});
  await checkout();assert.equal(sessions.get('legacy').status,'expired');assert.equal([...sessions.values()].filter(s=>s.status==='open').length,1,'legacy duplicate link is closed before new checkout');
  await fresh();
  sessions.set('unknown',{id:'unknown',customer:request.customer,mode:'subscription',status:'open',line_items:[{price:'unmapped_price'}]});
  await assert.rejects(checkout(),/support review/);assert.equal(createCalls,0);assert.equal(sessions.get('unknown').status,'open','unknown product must not be changed or ignored');
  console.log('PASS existing legacy open link is identified and expired; ambiguous historical prices block safely');

  await fresh();loseResponse=true;
  await assert.rejects(checkout(),/response loss/);assert.equal(sessions.size,1);
  const recovered=await checkout();assert.equal(recovered.id,[...sessions.keys()][0]);assert.equal(sessions.size,1);assert.equal(keys.size,1);
  await fresh();writeFailure=true;
  await assert.rejects(checkout(),/could not be saved/);assert.equal(sessions.size,1);
  writeFailure=false;await checkout();assert.equal(sessions.size,1);assert.equal(keys.size,1);
  console.log('PASS provider success with response loss or database checkpoint failure recovers the same exact provider idempotency key');

  await fresh();writeFailure=true;await assert.rejects(checkout());writeFailure=false;
  [...sessions.values()][0].status='expired';await checkout();
  assert.equal(sessions.size,2,'cached idempotent open response must be replaced by current expired state before deciding to reuse');
  console.log('PASS idempotent create replay does not revive an expired checkout link');

  const old=[...sessions.values()].find(s=>s.status==='open');
  const annual=await checkout({...request,price:'price_annual',billing:'annual'});
  assert.notEqual(old.id,annual.id);assert.equal(old.status,'expired');assert.equal(expireCalls,1);assert.equal(annual.line_items[0].price,'price_annual');
  annual.status='complete';annual.subscription='sub_complete';subscriptions.set('sub_complete',{id:'sub_complete',status:'trialing',metadata:{product_slug:'dhq'}});
  await assert.rejects(checkout(),e=>e.status===409 && e.code==='checkout_complete');assert.equal([...sessions.values()].filter(s=>s.status==='open').length,0);
  subscriptions.get('sub_complete').status='canceled';
  const countBeforeRestart=sessions.size;await checkout();assert.equal(sessions.size,countBeforeRestart+1,'confirmed canceled subscription permits a fresh checkout');
  await fresh();subscriptions.set('existing',{id:'existing',status:'active',metadata:{product_slug:'dhq'}});
  await assert.rejects(checkout(),e=>e.status===409&&e.code==='subscription_exists');assert.equal(sessions.size,0);
  subscriptions.set('existing',{id:'existing',status:'active',items:{data:[{price:{id:'price_monthly'}}],has_more:false}});
  await assert.rejects(checkout(),e=>e.status===409&&e.code==='subscription_exists');assert.equal(sessions.size,0,'legacy subscription price proves existing product even without metadata');
  subscriptions.set('existing',{id:'existing',status:'active',items:{data:[{price:{id:'unknown_price'}}],has_more:false}});
  await assert.rejects(checkout(),/support review/);assert.equal(sessions.size,0,'unknown legacy subscription cannot be treated as no subscription');
  subscriptions.set('existing',{id:'existing',status:'active',items:{data:[{price:{id:'price_other'}}],has_more:true}});
  await assert.rejects(checkout(),/support review/);assert.equal(sessions.size,0,'an unseen subscription item may be this product: a partial other-product page cannot permit another charge');
  delete subscriptions.get('existing').items.has_more;
  await assert.rejects(checkout(),/support review/);assert.equal(sessions.size,0,'missing pagination evidence cannot establish complete subscription items');
  subscriptions.get('existing').items.has_more=false;
  await checkout();assert.equal(sessions.size,1,'verified different existing product does not block this product');
  console.log('PASS plan switch expires old link first; completed or existing subscription cannot produce another charge; canceled subscription can restart');

  await fresh();loseResponse=true;await assert.rejects(checkout());
  await q("update billing_checkout_attempts set created_at=clock_timestamp()-interval '2 days' where user_id=$1",[user]);
  await checkout();assert.equal(createCalls,1,'provider idempotency expiry recovers through exact attempt metadata, not another create');
  await fresh();const claimed=await admin.rpc('claim_billing_checkout',{p_user_id:user,p_product_slug:'dhq',p_request:request});
  await q("update billing_checkout_attempts set lease_expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 days' where user_id=$1",[user]);
  await assert.rejects(checkout(),/could not be located safely/);assert.equal(createCalls,0,'missing old provider evidence must fail closed');
  const stale=await admin.rpc('checkpoint_billing_checkout',{p_user_id:user,p_product_slug:'dhq',p_lease_token:claimed.data.lease_token,p_session_id:'foreign'});
  assert(stale.error,'old worker may not publish into new lease');
  console.log('PASS expired provider key uses exact provider history; missing history and stale lease cannot silently create or publish');

  await q('delete from app_users where id=$1',[user]);await assert.rejects(checkout());assert.equal((await q('select * from billing_checkout_attempts where user_id=$1',[user])).length,0);
  await db.exec('set role anon');await assert.rejects(q('select * from billing_checkout_attempts'),/permission denied/);await assert.rejects(q('select claim_billing_checkout($1,$2,$3)',[user,'dhq',JSON.stringify(request)]),/permission denied/);
  await db.exec('reset role');await db.close();
  assert.equal(typeof vm.runInContext('CheckoutRecoveryError',helper),'function');
  console.log('PASS browser role denied private checkout state/RPC; deleted account cannot be recreated by a checkout retry');
})().catch(e=>{console.error(e);process.exitCode=1;});
